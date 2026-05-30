// hooks/useRastreamento.js
import { useEffect, useRef, useCallback } from "react";
import { db } from "../services/firebase";
import {
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
  runTransaction, // Importado para resolver o Problema 2
} from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";
import { salvarPontoRastreamento } from "../services/transporteService";

// ─── Constantes de validação ────────────────────────────────────────────────
const VEL_MIN_KMH = 3;
const VEL_MAX_KMH = 70;
const DESVIO_MAX_METROS = 150;
const TEMPO_DESVIO_EXPULSAR = 120000;
const DIST_CHEGADA_METROS = 50;

// ─── Helpers Geométricos ────────────────────────────────────────────────────
const calcularVelocidadeKmh = (lat1, lng1, lat2, lng2, deltaMs) => {
  if (deltaMs <= 0) return 0;
  const distMetros = calculateDistance(lat1, lng1, lat2, lng2);
  const distKm = distMetros / 1000;
  const tempoHoras = deltaMs / 3600000;
  return distKm / tempoHoras;
};

const distanciaAteSegmento = (pLat, pLng, aLat, aLng, bLat, bLng) => {
  const toXY = (lat, lng) => ({
    x: (lng - aLng) * 111320 * Math.cos((aLat * Math.PI) / 180),
    y: (lat - aLat) * 110540,
  });
  const p = toXY(pLat, pLng);
  const a = { x: 0, y: 0 };
  const b = toXY(bLat, bLng);
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const lenSq = ab.x * ab.x + ab.y * ab.y;
  if (lenSq === 0) return Math.sqrt(ap.x * ap.x + ap.y * ap.y);
  const t = Math.max(0, Math.min(1, (ap.x * ab.x + ap.y * ab.y) / lenSq));
  const proj = { x: a.x + t * ab.x, y: a.y + t * ab.y };
  return Math.sqrt((p.x - proj.x) ** 2 + (p.y - proj.y) ** 2);
};

const desvioMinimoNaRota = (lat, lng, pontosRota) => {
  if (!pontosRota || pontosRota.length < 2) return 0;
  let minDist = Infinity;
  for (let i = 0; i < pontosRota.length - 1; i++) {
    const d = distanciaAteSegmento(
      lat,
      lng,
      pontosRota[i][0],
      pontosRota[i][1],
      pontosRota[i + 1][0],
      pontosRota[i + 1][1],
    );
    if (d < minDist) minDist = d;
  }
  return minDist;
};

// ─── Hook Principal ──────────────────────────────────────────────────────────
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
}) => {
  const ultimaPosRef = useRef(null);
  const ultimoTempoRef = useRef(null);
  const iniciouDesvioRef = useRef(null);
  const watchIdRef = useRef(null); // Alterado para armazenar a referência do watchPosition
  const ultimoIndiceRef = useRef(null);

  const getCoordsParada = useCallback(
    (idRaw) => {
      if (!idRaw) return null;
      const id = (typeof idRaw === "object" ? idRaw.nome : idRaw)
        .toString()
        .toLowerCase()
        .trim();
      const info = paradasData[id];
      if (!info?.location) return null;
      let lat = Number(info.location.latitude || info.location._lat);
      let lng = Number(info.location.longitude || info.location._long);
      return [lat > 0 ? lat * -1 : lat, lng > 0 ? lng * -1 : lng];
    },
    [paradasData],
  );

  const detectarTrechoAtual = useCallback(
    (lat, lng) => {
      const paradas = itinerario.paradas.map((p) =>
        (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
      );
      const idxOrigem = paradas.indexOf(paradaOrigem.toLowerCase().trim());
      const idxDestino = paradas.indexOf(
        paradaDestino.toLowerCase().trim(),
        idxOrigem,
      );

      if (idxOrigem === -1 || idxDestino === -1) return null;

      let menorDist = Infinity;
      let trechoIdx = idxOrigem;

      for (let i = idxOrigem; i < idxDestino; i++) {
        const c1 = getCoordsParada(paradas[i]);
        const c2 = getCoordsParada(paradas[i + 1]);
        if (!c1 || !c2) continue;
        const d = distanciaAteSegmento(lat, lng, c1[0], c1[1], c2[0], c2[1]);
        if (d < menorDist) {
          menorDist = d;
          trechoIdx = i;
        }
      }

      return {
        idxAtual: trechoIdx,
        idParadaA: paradas[trechoIdx],
        idParadaB: paradas[trechoIdx + 1] || null,
        coordsA: getCoordsParada(paradas[trechoIdx]),
        coordsB: getCoordsParada(paradas[trechoIdx + 1]),
      };
    },
    [itinerario, paradaOrigem, paradaDestino, getCoordsParada],
  );

  const promoverProximoRastreador = useCallback(async () => {
    const tripId = `${itinerario.id}_${horario.replace(":", "")}`;
    const viagemRef = doc(db, "viagens_ativas", tripId);
    const snap = await getDoc(viagemRef);
    if (!snap.exists()) return;
    const dados = snap.data();
    if (dados.proximoRastreador) {
      await updateDoc(viagemRef, {
        rastreadorAtual: dados.proximoRastreador,
        proximoRastreador: null,
        atualizadoEm: serverTimestamp(),
      });
    }
  }, [itinerario, horario]);

  const liberarUsuario = useCallback(async (uid) => {
    if (!uid) return;
    try {
      await updateDoc(doc(db, "usuarios", uid), { viagemAtualId: null });
    } catch {}
  }, []);

  // ─── Lógica de Execução por Amostragem Dinâmica (Tick) ──────────────────────
  const tick = useCallback(
    async (posicaoAtual, uid) => {
      const { lat, lng } = posicaoAtual;
      const agora = Date.now();

      let velocidadeKmh = 0;
      if (ultimaPosRef.current && ultimoTempoRef.current) {
        const deltaMs = agora - ultimoTempoRef.current;
        velocidadeKmh = calcularVelocidadeKmh(
          ultimaPosRef.current.lat,
          ultimaPosRef.current.lng,
          lat,
          lng,
          deltaMs,
        );
      }

      ultimaPosRef.current = { lat, lng };
      ultimoTempoRef.current = agora;

      const coordsDestino = getCoordsParada(paradaDestino);
      if (coordsDestino) {
        const distDestino = calculateDistance(
          lat,
          lng,
          coordsDestino[0],
          coordsDestino[1],
        );
        if (distDestino <= DIST_CHEGADA_METROS) {
          if (isRastreador) await promoverProximoRastreador();
          await liberarUsuario(uid);
          onExpulsar("destino");
          return;
        }
      }

      const trecho = detectarTrechoAtual(lat, lng);

      if (trecho?.coordsA && trecho?.coordsB) {
        const chave = `${itinerario.id}_${trecho.idParadaA}-${trecho.idParadaB}`;
        const rotaTrecho = rotasAprendidas?.[chave];
        const pontos =
          rotaTrecho && rotaTrecho.length >= 2
            ? rotaTrecho
            : [
                [trecho.coordsA[0], trecho.coordsA[1]],
                [trecho.coordsB[0], trecho.coordsB[1]],
              ];
        const desvioMetros = desvioMinimoNaRota(lat, lng, pontos);

        if (desvioMetros > DESVIO_MAX_METROS) {
          if (!iniciouDesvioRef.current) {
            iniciouDesvioRef.current = agora;
          } else if (agora - iniciouDesvioRef.current > TEMPO_DESVIO_EXPULSAR) {
            if (isRastreador) await promoverProximoRastreador();
            await liberarUsuario(uid);
            onExpulsar("desvio");
            return;
          }
        } else {
          iniciouDesvioRef.current = null;
        }
      }

      if (velocidadeKmh > VEL_MAX_KMH) return;

      // CORREÇÃO PROBLEMA 2: Escrita Transacional Atômica (Anti-Retrocesso)
      if (isRastreador && trecho?.idParadaA && trecho?.idxAtual !== undefined) {
        const tripId = `${itinerario.id}_${horario.replace(":", "")}`;
        const indiceAnterior = ultimoIndiceRef.current ?? -1;

        if (trecho.idxAtual !== indiceAnterior) {
          const viagemRef = doc(db, "viagens_ativas", tripId);

          try {
            // Executa transação para garantir ordem cronológica e geométrica crescente
            await runTransaction(db, async (transaction) => {
              const sfDoc = await transaction.get(viagemRef);
              if (!sfDoc.exists()) return;

              const dadosAtuais = sfDoc.data();
              const indiceNoBanco = dadosAtuais.indiceParada ?? -1;

              // Só atualiza se o novo índice do celular for estritamente MAIOR (ou se o banco estiver limpo)
              // Isso previne que delays de conexão forcem a rota a retroceder na tela
              if (trecho.idxAtual >= indiceNoBanco) {
                transaction.update(viagemRef, {
                  ultimaParada: trecho.idParadaA,
                  indiceParada: trecho.idxAtual,
                  atualizadoEm: serverTimestamp(),
                });
                ultimoIndiceRef.current = trecho.idxAtual;
              }
            });
          } catch (e) {
            console.error("[Transação GPS] Erro de concorrência ou rede:", e);
          }
        }
      }

      if (isRastreador && trecho?.idParadaA && trecho?.idParadaB) {
        const velocidadeOk =
          velocidadeKmh === 0 || velocidadeKmh >= VEL_MIN_KMH;
        if (velocidadeOk) {
          try {
            await salvarPontoRastreamento(
              itinerario.id,
              trecho.idParadaA,
              trecho.idParadaB,
              lat,
              lng,
            );
          } catch (e) {
            console.error("[Rastreamento] Erro ao salvar ponto:", e);
          }
        }
      }
    },
    [
      getCoordsParada,
      detectarTrechoAtual,
      paradaDestino,
      isRastreador,
      itinerario,
      horario,
      rotasAprendidas,
      promoverProximoRastreador,
      liberarUsuario,
      onExpulsar,
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
      ultimoIndiceRef.current = null;
      return;
    }

    if (!navigator.geolocation) return;

    // Escuta mudanças de posição guiadas pelo Hardware de forma reativa
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        import("../services/firebase").then(({ auth }) => {
          const uid = auth.currentUser?.uid || null;
          tick({ lat: pos.coords.latitude, lng: pos.coords.longitude }, uid);
        });
      },
      (err) =>
        console.warn("[Watch GPS] Erro de captura de sinal:", err.message),
      {
        enableHighAccuracy: true, // Garante dados limpos nas esquinas
        timeout: 10000,
        maximumAge: 2000, // Reutiliza posições muito recentes para economizar processamento
      },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [ativo, tick]);
};
