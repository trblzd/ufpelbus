// hooks/useRastreamento.js
// HOOK DE RASTREAMENTO - Gerencia envio de posição GPS e promoção de rastreador

import { useEffect, useRef, useCallback } from "react";
import { db, auth } from "../services/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";
import {
  salvarTempoTrecho,
  verificarEAtualizarParadaAutomatica,
} from "../services/transporteService";

// ========== CONFIGURAÇÕES ==========
const VEL_MIN_KMH = 0; // 0 = sempre salva, mesmo parado
const VEL_MAX_KMH = 70;
const DESVIO_MAX_METROS = 150;
const TEMPO_DESVIO_EXPULSAR = 120000; // 2 minutos
const DIST_CHEGADA_METROS = 50;
const THROTTLE_SAVE_MS = 3000; // 3 segundos
const DESVIO_CHECK_INTERVAL = 5;

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

export const useRastreamento = ({
  ativo,
  isRastreador,
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

  const viagemId = `${itinerario?.id?.toLowerCase()?.trim()}_${horario?.replace(":", "")}`;

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

  const detectarTrechoAtual = useCallback(
    (lat, lng, viagemAtiva) => {
      if (!itinerario || !itinerario.paradas || itinerario.paradas.length < 2)
        return null;

      const paradas = itinerario.paradas.map((p) => {
        const nomeBruto = typeof p === "object" ? p.nome : p;
        return nomeBruto.toLowerCase().trim().replace(/\s+/g, " ");
      });

      const idxOrigem = paradas.indexOf(
        paradaOrigem.toLowerCase().trim().replace(/\s+/g, " "),
      );
      const idxDestino = paradas.indexOf(
        paradaDestino.toLowerCase().trim().replace(/\s+/g, " "),
      );

      if (idxOrigem === -1 || idxDestino === -1 || idxOrigem >= idxDestino)
        return null;

      let menorDistanciaSegmento = Infinity;
      let melhorChaveTrecho = null;

      const indiceAtualViagem = viagemAtiva?.indiceParada ?? idxOrigem;
      const limiteBusca = Math.min(indiceAtualViagem + 1, idxDestino - 1);

      for (let i = indiceAtualViagem; i <= limiteBusca; i++) {
        if (!paradas[i] || !paradas[i + 1]) continue;

        const pA = paradasData[paradas[i]];
        const pB = paradasData[paradas[i + 1]];

        if (!pA?.location || !pB?.location) continue;

        const aLat = Number(pA.location.latitude || pA.location._lat);
        const aLng = Number(pA.location.longitude || pA.location._long);
        const bLat = Number(pB.location.latitude || pB.location._lat);
        const bLng = Number(pB.location.longitude || pB.location._long);

        const distAoSegmento = distanciaAteSegmento(
          lat,
          lng,
          aLat,
          aLng,
          bLat,
          bLng,
        );

        if (distAoSegmento < menorDistanciaSegmento) {
          menorDistanciaSegmento = distAoSegmento;

          const idParadaA = paradas[i].replace(/\s+/g, "-");
          const idParadaB = paradas[i + 1].replace(/\s+/g, "-");

          melhorChaveTrecho = `${itinerario.id}_${idParadaA}-${idParadaB}`;
        }
      }

      return menorDistanciaSegmento <= DESVIO_MAX_METROS
        ? melhorChaveTrecho
        : null;
    },
    [itinerario, paradaOrigem, paradaDestino, paradasData],
  );

  const promoverProximoRastreador = useCallback(async (viagemRef) => {
    try {
      const snap = await getDoc(viagemRef);
      if (!snap.exists()) return;
      const dados = snap.data();

      console.log("[Promoção] Dados atuais:", dados);
      console.log("[Promoção] Próximo rastreador:", dados.proximoRastreador);

      if (dados.proximoRastreador) {
        await updateDoc(viagemRef, {
          rastreadorAtual: dados.proximoRastreador,
          proximoRastreador: null,
          atualizadoEm: serverTimestamp(),
        });
        console.log(
          "[Promoção] ✅ Rastreador promovido:",
          dados.proximoRastreador.nome,
        );
      } else {
        await updateDoc(viagemRef, {
          rastreadorAtual: null,
          atualizadoEm: serverTimestamp(),
        });
        console.log("[Promoção] ⚠️ Nenhum próximo rastreador - removido");
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

      // Se for rastreador e perdeu o posto, expulsa
      if (isRastreador && viagemAtivaDados.rastreadorAtual?.uid !== uid) {
        if (viagemAtivaDados.proximoRastreador?.uid !== uid) {
          onExpulsar("rebaixado");
        }
        return;
      }

      // Para passageiros, reativa GPS quando próximo do destino
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

      // Atualiza parada automática (só rastreador)
      if (isRastreador) {
        await verificarEAtualizarParadaAutomatica(
          viagemId,
          pos.lat,
          pos.lng,
          itinerario,
          paradasData,
        );
      }

      const chaveTrechoAtual = detectarTrechoAtual(
        pos.lat,
        pos.lng,
        viagemAtivaDados,
      );

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

      // Monitoramento de desvio (só rastreador)
      if (isRastreador) {
        contadorDesvioRef.current += 1;
        if (contadorDesvioRef.current >= DESVIO_CHECK_INTERVAL) {
          contadorDesvioRef.current = 0;

          if (!chaveTrechoAtual) {
            if (!iniciouDesvioRef.current) {
              iniciouDesvioRef.current = agora;
            } else if (
              agora - iniciouDesvioRef.current >=
              TEMPO_DESVIO_EXPULSAR
            ) {
              await promoverProximoRastreador(viagemRef);
              await liberarUsuario(uid);
              onExpulsar("desvio");
              return;
            }
          } else {
            iniciouDesvioRef.current = null;
          }
        }
      }

      // Verifica chegada ao destino
      const coordsDestino = obterCoordsParada(paradaDestino);
      if (coordsDestino) {
        const distAteDestino = calculateDistance(
          pos.lat,
          pos.lng,
          coordsDestino.lat,
          coordsDestino.lng,
        );
        if (distAteDestino <= DIST_CHEGADA_METROS) {
          if (isRastreador) await promoverProximoRastreador(viagemRef);
          await liberarUsuario(uid);
          onExpulsar("destino");
          return;
        }
      }

      // ========== SALVAMENTO DE TELEMETRIA ==========
      if (
        isRastreador &&
        agora - ultimoSaveGeometricoRef.current >= THROTTLE_SAVE_MS
      ) {
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

        ultimaPosRef.current = pos;
        ultimoTempoRef.current = agora;
        ultimoSaveGeometricoRef.current = agora;

        // 🔧 SALVA SEMPRE - sem filtros de velocidade mínima
        try {
          await updateDoc(viagemRef, {
            lat: pos.lat,
            lng: pos.lng,
            velocidade: Math.round(velKmh),
            atualizadoEm: serverTimestamp(),
          });
          console.log(
            `[Rastreamento] Posição salva: ${pos.lat.toFixed(6)}, ${pos.lng.toFixed(6)} (${Math.round(velKmh)} km/h)`,
          );
        } catch (err) {
          console.error("[Rastreamento] Erro ao salvar posição:", err);
        }
      }
    },
    [
      viagemId,
      paradaOrigem,
      obterCoordsParada,
      detectarTrechoAtual,
      paradaDestino,
      isRastreador,
      itinerario,
      horario,
      promoverProximoRastreador,
      liberarUsuario,
      onExpulsar,
      onReativarGpsPassageiro,
      paradasData,
    ],
  );

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
        console.log("[GPS] Posição capturada:", position);
        tick(position, uid);
      },
      (err) => console.warn("[Watch GPS] Erro:", err.message),
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 5000,
      },
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
