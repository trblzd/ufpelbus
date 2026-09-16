// hooks/useRastreamento.js
import { useEffect, useRef, useCallback, useState } from "react";
import { db, auth } from "../services/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";
import {
  salvarTempoTrecho,
  verificarEAtualizarParadaAutomatica,
} from "../services/transporteService";

// ========== CONFIGURAÇÕES ==========
const DESVIO_MAX_METROS = 50;
const TEMPO_DESVIO_EXPULSAR = 300000; // 5 min
const DIST_CHEGADA_METROS = 30;
const THROTTLE_RASTREADOR_MS = 5000;
const THROTTLE_PASSAGEIRO_MS = 15000;
const DESVIO_CHECK_INTERVAL = 5;

// ========== AUXILIARES ==========
const calcularVelocidadeKmh = (lat1, lng1, lat2, lng2, deltaMs) => {
  if (deltaMs <= 0) return 0;
  const distMetros = calculateDistance(lat1, lng1, lat2, lng2);
  const distKm = distMetros / 1000;
  const tempoHoras = deltaMs / 3600000;
  return distKm / tempoHoras;
};

const distanciaAteSegmento = (pLat, pLng, aLat, aLng, bLat, bLng) => {
  const dy = bLat - aLat;
  const dx = bLng - aLng;
  if (dx === 0 && dy === 0) return calculateDistance(pLat, pLng, aLat, aLng);
  let t = ((pLat - aLat) * dy + (pLng - aLng) * dx) / (dy * dy + dx * dx);
  t = Math.max(0, Math.min(1, t));
  const projLat = aLat + t * dy;
  const projLng = aLng + t * dx;
  return calculateDistance(pLat, pLng, projLat, projLng);
};

const distanciaPontoPolilinha = (p, polilinha) => {
  if (!polilinha || polilinha.length < 2) return Infinity;
  let minDist = Infinity;
  for (let i = 0; i < polilinha.length - 1; i++) {
    const a = polilinha[i];
    const b = polilinha[i + 1];
    const dist = distanciaAteSegmento(p.lat, p.lng, a.lat, a.lng, b.lat, b.lng);
    if (dist < minDist) minDist = dist;
  }
  return minDist;
};

const encontrarMelhorIndiceDestino = (paradasLista, destino, indiceAtual) => {
  const indices = [];
  paradasLista.forEach((p, i) => {
    if (p === destino) indices.push(i);
  });
  if (indices.length === 0) return -1;
  if (indices.length === 1) return indices[0];
  for (const idx of indices) {
    if (idx > indiceAtual) return idx;
  }
  return indices[indices.length - 1];
};

export const useRastreamento = ({
  ativo,
  isRastreador,
  viagemId,
  itinerario,
  horario,
  paradaOrigem,
  paradaDestino,
  paradasData,
  rotasAprendidas,
  onExpulsar,
  onReativarGpsPassageiro,
}) => {
  const watchIdRef = useRef(null);
  const ultimaPosRef = useRef(null);
  const ultimoTempoRef = useRef(null);
  const iniciouDesvioRef = useRef(null);
  const ultimoTrechoRef = useRef(null);
  const tempoInicioTrechoRef = useRef(null);
  const ultimoSaveGeometricoRef = useRef(0);
  const contadorDesvioRef = useRef(0);
  const jaReativouGpsPassageiroRef = useRef(false);
  const [geometriaRotas, setGeometriaRotas] = useState({});

  // Carregar geometrias
  useEffect(() => {
    const carregarGeometrias = async () => {
      if (!itinerario?.id || !paradasData) return;
      const paradasLista = itinerario.paradas.map((p) =>
        (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
      );
      const geometrias = {};
      for (let i = 0; i < paradasLista.length - 1; i++) {
        const docId = `${itinerario.id}_${paradasLista[i]}-${paradasLista[i + 1]}`;
        try {
          const docSnap = await getDoc(doc(db, "rotas_geometricas", docId));
          if (docSnap.exists()) {
            const geo = docSnap.data().geometria;
            if (geo && geo.length >= 2) geometrias[docId] = geo;
          }
        } catch (err) {
          console.warn(`Erro ao carregar geometria ${docId}:`, err);
        }
      }
      setGeometriaRotas(geometrias);
    };
    if (itinerario && ativo) carregarGeometrias();
  }, [itinerario, paradasData, ativo]);

  const promoverProximoRastreador = useCallback(async (viagemRef) => {
    try {
      const snap = await getDoc(viagemRef);
      if (!snap.exists()) return;
      const dados = snap.data();
      if (dados.proximoRastreador) {
        await updateDoc(viagemRef, {
          rastreadorAtual: dados.proximoRastreador,
          proximoRastreador: null,
          atualizadoEm: serverTimestamp(),
        });
      } else {
        await updateDoc(viagemRef, {
          rastreadorAtual: null,
          atualizadoEm: serverTimestamp(),
        });
      }
    } catch (e) {
      console.error("Erro ao promover próximo rastreador:", e);
    }
  }, []);

  const liberarUsuario = useCallback(async (uid) => {
    try {
      await updateDoc(doc(db, "usuarios", uid), { viagemAtualId: null });
    } catch (e) {
      console.error("Erro ao limpar flag de viagem do usuário:", e);
    }
  }, []);

  const obterCoordsParada = useCallback(
    (nomeParada) => {
      if (!nomeParada || !paradasData) return null;
      const dados = paradasData[nomeParada.toLowerCase().trim()];
      if (!dados?.location) return null;
      return {
        lat: Number(dados.location.latitude || dados.location._lat),
        lng: Number(dados.location.longitude || dados.location._long),
      };
    },
    [paradasData],
  );

  // ✅ NOVO: expulsão centralizada — promove/remove rastreador e limpa user
  const expulsarUsuario = useCallback(
    async (viagemRef, uid, viagemAtivaDados, motivo) => {
      try {
        // Se era o rastreador atual → promove o próximo
        if (viagemAtivaDados.rastreadorAtual?.uid === uid) {
          await promoverProximoRastreador(viagemRef);
        }
        // Se era o próximo rastreador → remove marcação (evita "fantasma")
        else if (viagemAtivaDados.proximoRastreador?.uid === uid) {
          await updateDoc(viagemRef, {
            proximoRastreador: null,
            atualizadoEm: serverTimestamp(),
          });
        }
      } catch (e) {
        console.error("[Rastreamento] Erro ao limpar rastreamento:", e);
      }
      await liberarUsuario(uid);
      onExpulsar(motivo);
    },
    [promoverProximoRastreador, liberarUsuario, onExpulsar],
  );

  const tick = useCallback(
    async (pos, uid) => {
      if (!uid || !viagemId) return;

      const agora = Date.now();
      const viagemRef = doc(db, "viagens_ativas", viagemId);
      const viagemSnap = await getDoc(viagemRef);

      if (!viagemSnap.exists()) {
        onExpulsar("cancelada");
        await liberarUsuario(uid);
        return;
      }

      const viagemAtivaDados = viagemSnap.data();

      // ========== FLAG DE FIM DE VIAGEM ==========
      if (viagemAtivaDados.chegouAoDestino) {
        await expulsarUsuario(viagemRef, uid, viagemAtivaDados, "destino");
        return;
      }

      if (isRastreador && viagemAtivaDados.rastreadorAtual?.uid !== uid) {
        if (viagemAtivaDados.proximoRastreador?.uid !== uid) {
          onExpulsar("rebaixado");
        }
        return;
      }

      if (
        !isRastreador &&
        onReativarGpsPassageiro &&
        !jaReativouGpsPassageiroRef.current
      ) {
        const paradasLista = itinerario.paradas.map((p) =>
          (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
        );
        const idxDestino = paradasLista.indexOf(
          paradaDestino.toLowerCase().trim(),
        );
        const idxParadaAnterior = idxDestino - 1;
        const indiceAtual = viagemAtivaDados.indiceParada ?? 0;
        if (
          idxParadaAnterior >= 0 &&
          indiceAtual >= idxParadaAnterior &&
          indiceAtual < idxDestino
        ) {
          jaReativouGpsPassageiroRef.current = true;
          onReativarGpsPassageiro();
        }
      }

      let velKmh = 0;
      if (ultimaPosRef.current && ultimoTempoRef.current) {
        const deltaT = agora - ultimoTempoRef.current;
        if (deltaT > 0) {
          velKmh = calcularVelocidadeKmh(
            ultimaPosRef.current.lat,
            ultimaPosRef.current.lng,
            pos.lat,
            pos.lng,
            deltaT,
          );
        }
      }

      const paradasLista = itinerario.paradas.map((p) =>
        (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
      );

      // ============================================================
      // ✅ CORREÇÃO PRINCIPAL: EXPULSÃO DO PASSAGEIRO NO DESTINO
      // ============================================================
      // O passageiro está DENTRO do ônibus, então NÃO exigimos distância
      // nem velocidade. Usamos o índice de parada já confirmado pelo
      // rastreador: se indiceParada >= índice do destino do passageiro,
      // ele já chegou (ou passou) do seu destino → expulsa.
      const idxDestinoUsuario = encontrarMelhorIndiceDestino(
        paradasLista,
        paradaDestino.toLowerCase().trim(),
        viagemAtivaDados.indiceParada ?? 0,
      );

      if (
        idxDestinoUsuario !== -1 &&
        (viagemAtivaDados.indiceParada ?? 0) >= idxDestinoUsuario
      ) {
        await expulsarUsuario(viagemRef, uid, viagemAtivaDados, "destino");
        return;
      }

      // ========== DETECÇÃO AUTOMÁTICA DE PARADA (rastreador) ==========
      if (isRastreador) {
        const resultadoParada = await verificarEAtualizarParadaAutomatica(
          viagemId,
          pos.lat,
          pos.lng,
          itinerario,
          paradasData,
          true,
          velKmh,
        );

        if (resultadoParada) {
          // Atualiza em memória para refletir a nova posição antes de checar
          viagemAtivaDados.indiceParada = resultadoParada.indiceDetectado;

          // Recalcula índice de destino do usuário com o novo índice
          const idxDestinoAtualizado = encontrarMelhorIndiceDestino(
            paradasLista,
            paradaDestino.toLowerCase().trim(),
            resultadoParada.indiceDetectado,
          );

          if (
            resultadoParada.fimDoItinerario ||
            (idxDestinoAtualizado !== -1 &&
              resultadoParada.indiceDetectado >= idxDestinoAtualizado)
          ) {
            await expulsarUsuario(viagemRef, uid, viagemAtivaDados, "destino");
            return;
          }
        }
      }

      // ========== VERIFICAÇÃO DE DESTINO POR DISTÂNCIA (FALLBACK) ==========
      // Só executa se ainda não foi expulso pelas checagens acima.
      // Usado como segurança quando o índice por algum motivo não avançou.
      const coordsDestino = obterCoordsParada(paradaDestino);
      if (
        coordsDestino &&
        viagemAtivaDados.indiceParada >= idxDestinoUsuario &&
        idxDestinoUsuario !== -1
      ) {
        const distAteDestino = calculateDistance(
          pos.lat,
          pos.lng,
          coordsDestino.lat,
          coordsDestino.lng,
        );
        if (distAteDestino <= DIST_CHEGADA_METROS) {
          await updateDoc(viagemRef, {
            chegouAoDestino: true,
            atualizadoEm: serverTimestamp(),
          }).catch(() => {});
          await expulsarUsuario(viagemRef, uid, viagemAtivaDados, "destino");
          return;
        }
      }

      // ========== DETECÇÃO DE TRECHO E DESVIO COM GEOMETRIA ==========
      let chaveTrechoAtual = null;
      let distanciaDaRota = Infinity;

      const indiceAtualViagem = viagemAtivaDados.indiceParada ?? 0;
      const limiteBusca = Math.min(
        indiceAtualViagem + 2,
        paradasLista.length - 1,
      );

      let melhorDist = Infinity;
      let melhorChave = null;

      for (
        let i = indiceAtualViagem;
        i <= limiteBusca && i < paradasLista.length - 1;
        i++
      ) {
        if (!paradasLista[i] || !paradasLista[i + 1]) continue;
        const chave = `${itinerario.id}_${paradasLista[i]}-${paradasLista[i + 1]}`;
        const geometria = geometriaRotas[chave];

        if (geometria && geometria.length >= 2) {
          const dist = distanciaPontoPolilinha(pos, geometria);
          if (dist < melhorDist) {
            melhorDist = dist;
            melhorChave = chave;
          }
        } else {
          const coordsA = paradasData[paradasLista[i]]?.location;
          const coordsB = paradasData[paradasLista[i + 1]]?.location;
          if (coordsA && coordsB) {
            const aLat = Number(coordsA.latitude || coordsA._lat);
            const aLng = Number(coordsA.longitude || coordsA._long);
            const bLat = Number(coordsB.latitude || coordsB._lat);
            const bLng = Number(coordsB.longitude || coordsB._long);
            const dist = distanciaAteSegmento(
              pos.lat,
              pos.lng,
              aLat,
              aLng,
              bLat,
              bLng,
            );
            if (dist < melhorDist) {
              melhorDist = dist;
              melhorChave = chave;
            }
          }
        }
      }

      if (!melhorChave) {
        const limiteBuscaExtendido = Math.min(
          indiceAtualViagem + 3,
          paradasLista.length - 1,
        );
        for (
          let i = indiceAtualViagem + 1;
          i <= limiteBuscaExtendido && i < paradasLista.length - 1;
          i++
        ) {
          if (!paradasLista[i] || !paradasLista[i + 1]) continue;
          const chave = `${itinerario.id}_${paradasLista[i]}-${paradasLista[i + 1]}`;
          const geometria = geometriaRotas[chave];
          if (geometria && geometria.length >= 2) {
            const dist = distanciaPontoPolilinha(pos, geometria);
            if (dist < melhorDist) {
              melhorDist = dist;
              melhorChave = chave;
            }
          }
        }
      }

      if (melhorDist < DESVIO_MAX_METROS * 1.5) {
        chaveTrechoAtual = melhorChave;
        distanciaDaRota = melhorDist;
      }

      // ========== GERENCIAMENTO DE DESVIO ==========
      if (isRastreador) {
        contadorDesvioRef.current += 1;
        if (contadorDesvioRef.current >= DESVIO_CHECK_INTERVAL) {
          contadorDesvioRef.current = 0;
          if (!chaveTrechoAtual || distanciaDaRota > DESVIO_MAX_METROS) {
            if (!iniciouDesvioRef.current) {
              iniciouDesvioRef.current = agora;
            } else if (
              agora - iniciouDesvioRef.current >=
              TEMPO_DESVIO_EXPULSAR
            ) {
              await expulsarUsuario(viagemRef, uid, viagemAtivaDados, "desvio");
              return;
            }
          } else {
            iniciouDesvioRef.current = null;
          }
        }
      }

      // ========== APRENDIZADO DE TEMPOS ==========
      if (chaveTrechoAtual) {
        if (
          ultimoTrechoRef.current &&
          ultimoTrechoRef.current !== chaveTrechoAtual
        ) {
          const tempoGastoMS = agora - tempoInicioTrechoRef.current;
          const tempoGastoSegundos = Math.round(tempoGastoMS / 1000);
          if (tempoGastoSegundos > 10) {
            const underscoreIndex = ultimoTrechoRef.current.indexOf("_");
            if (underscoreIndex !== -1) {
              const itinerarioId = ultimoTrechoRef.current.substring(
                0,
                underscoreIndex,
              );
              const paradasPart = ultimoTrechoRef.current.substring(
                underscoreIndex + 1,
              );
              const hyphenIndex = paradasPart.lastIndexOf("-");
              if (hyphenIndex !== -1) {
                const paradaA = paradasPart.substring(0, hyphenIndex);
                const paradaB = paradasPart.substring(hyphenIndex + 1);
                await salvarTempoTrecho({
                  itinerarioId,
                  paradaA,
                  paradaB,
                  tempoGastoSegundos,
                  horarioSaida: horario,
                });
              }
            }
          }
          tempoInicioTrechoRef.current = agora;
        } else if (!ultimoTrechoRef.current) {
          tempoInicioTrechoRef.current = agora;
        }
        ultimoTrechoRef.current = chaveTrechoAtual;
      }

      // ========== TELEMETRIA ==========
      const throttleTime = isRastreador
        ? THROTTLE_RASTREADOR_MS
        : THROTTLE_PASSAGEIRO_MS;
      if (agora - ultimoSaveGeometricoRef.current >= throttleTime) {
        ultimaPosRef.current = pos;
        ultimoTempoRef.current = agora;
        ultimoSaveGeometricoRef.current = agora;
        try {
          await updateDoc(viagemRef, {
            lat: pos.lat,
            lng: pos.lng,
            velocidade: Math.round(velKmh),
            atualizadoEm: serverTimestamp(),
          });
        } catch (err) {
          console.error("[Rastreamento] Erro ao salvar posição:", err);
        }
      }
    },
    [
      viagemId,
      itinerario,
      horario,
      paradaOrigem,
      paradaDestino,
      paradasData,
      geometriaRotas,
      isRastreador,
      onExpulsar,
      onReativarGpsPassageiro,
      liberarUsuario,
      promoverProximoRastreador,
      obterCoordsParada,
      expulsarUsuario,
    ],
  );

  // WATCHER DE GPS
  useEffect(() => {
    if (!ativo) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      ultimaPosRef.current = null;
      ultimoTempoRef.current = null;
      iniciouDesvioRef.current = null;
      ultimoTrechoRef.current = null;
      tempoInicioTrechoRef.current = null;
      ultimoSaveGeometricoRef.current = 0;
      contadorDesvioRef.current = 0;
      jaReativouGpsPassageiroRef.current = false;
      return;
    }

    if (watchIdRef.current !== null) return;
    if (!navigator.geolocation) return;

    console.log("[useRastreamento] Iniciando watcher de GPS");

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const uid = auth.currentUser?.uid || null;
        const position = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        };
        tick(position, uid);
      },
      (err) => console.warn("[Watch GPS] Erro:", err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [ativo, tick]);

  return null;
};
