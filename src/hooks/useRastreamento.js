// hooks/useRastreamento.js
import { useEffect, useRef, useCallback, useMemo } from "react";
import { db, auth } from "../services/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";
import { verificarEAtualizarParadaAutomatica } from "../services/transporteService";
import { useAprendizadoRotas } from "./useAprendizadoRotas";

// ========== CONFIGURAÇÕES ==========
const CONFIG = {
  VEL_MIN_KMH: 2,
  VEL_MAX_KMH: 70,
  DESVIO_MAX_METROS: 500,
  TEMPO_DESVIO_EXPULSAR_MS: 600000, // 10 minutos
  DIST_CHEGADA_METROS: 80,
  THROTTLE_SAVE_MS: 15000,
  MIN_MOVIMENTO_METROS: 20,
  RAIO_DINAMICO_PERCENT: 0.15,
  RAIO_MINIMO_METROS: 100,
  RAIO_MAXIMO_METROS: 500,
  DESVIO_CHECK_INTERVAL: 3,
  GPS_OPTIONS: { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
};

// ========== UTILITÁRIOS PUROS ==========
const calcularVelocidadeKmh = (lat1, lng1, lat2, lng2, deltaMs) => {
  if (deltaMs <= 0) return 0;
  const distMetros = calculateDistance(lat1, lng1, lat2, lng2);
  return distMetros / 1000 / (deltaMs / 3600000);
};

const distanciaAteSegmento = (p, a, b) => {
  const dy = b.lat - a.lat;
  const dx = b.lng - a.lng;
  if (dx === 0 && dy === 0)
    return calculateDistance(p.lat, p.lng, a.lat, a.lng);

  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.lat - a.lat) * dy + (p.lng - a.lng) * dx) / (dy * dy + dx * dx),
    ),
  );
  const proj = { lat: a.lat + t * dy, lng: a.lng + t * dx };
  return calculateDistance(p.lat, p.lng, proj.lat, proj.lng);
};

// ========== HOOK PRINCIPAL ==========
export const useRastreamento = ({
  ativo,
  isRastreador,
  itinerario,
  horario,
  paradaOrigem,
  paradaDestino,
  paradasData,
  onExpulsar,
  onReativarGpsPassageiro,
}) => {
  const viagemId = useMemo(
    () =>
      `${itinerario?.id?.toLowerCase()?.trim()}_${horario?.replace(":", "")}`,
    [itinerario?.id, horario],
  );

  // ========== REFS ==========
  const watchIdRef = useRef(null);
  const stateRef = useRef({
    ultimaPos: null,
    ultimoTempo: null,
    inicioDesvio: null,
    ultimoTrecho: null,
    ultimoSave: 0,
    contadorDesvio: 0,
    jaReativouGpsPassageiro: false,
  });

  const { iniciarTrecho, finalizarTrecho } = useAprendizadoRotas({
    itinerarioId: itinerario?.id,
  });

  // ========== FUNÇÕES DE PARADA ==========
  const obterCoordsParada = useCallback(
    (nomeParada) => {
      if (!nomeParada || !paradasData) return null;
      const dados = paradasData[nomeParada.toLowerCase().trim()];
      if (!dados?.location) return null;

      let lat = Number(dados.location.latitude || dados.location._lat);
      let lng = Number(dados.location.longitude || dados.location._long);
      return { lat: lat > 0 ? lat * -1 : lat, lng: lng > 0 ? lng * -1 : lng };
    },
    [paradasData],
  );

  const calcularRaioDinamico = useCallback(
    (paradaA, paradaB) => {
      const coordsA = obterCoordsParada(paradaA);
      const coordsB = obterCoordsParada(paradaB);
      if (!coordsA || !coordsB) return CONFIG.DESVIO_MAX_METROS;

      const distancia = calculateDistance(
        coordsA.lat,
        coordsA.lng,
        coordsB.lat,
        coordsB.lng,
      );
      const raio = distancia * CONFIG.RAIO_DINAMICO_PERCENT;
      return Math.min(
        CONFIG.RAIO_MAXIMO_METROS,
        Math.max(CONFIG.RAIO_MINIMO_METROS, raio),
      );
    },
    [obterCoordsParada],
  );

  // ========== DETECÇÃO DE TRECHO ==========
  const detectarTrechoAtual = useCallback(
    (lat, lng, indiceAtualViagem) => {
      if (!itinerario?.paradas?.length) return null;

      const paradas = itinerario.paradas.map((p) =>
        (typeof p === "object" ? p.nome : p).toLowerCase().trim(),
      );

      const idxOrigem = paradas.indexOf(paradaOrigem?.toLowerCase().trim());
      const idxDestino = paradas.indexOf(paradaDestino?.toLowerCase().trim());

      if (idxOrigem === -1 || idxDestino === -1 || idxOrigem >= idxDestino)
        return null;

      let menorDistancia = Infinity;
      let melhorChave = null;
      const limiteBusca = Math.min(
        (indiceAtualViagem ?? idxOrigem) + 2,
        idxDestino - 1,
      );

      for (let i = indiceAtualViagem ?? idxOrigem; i <= limiteBusca; i++) {
        if (!paradas[i] || !paradas[i + 1]) continue;

        const pA = paradasData[paradas[i]];
        const pB = paradasData[paradas[i + 1]];
        if (!pA?.location || !pB?.location) continue;

        const a = obterCoordsParada(paradas[i]);
        const b = obterCoordsParada(paradas[i + 1]);
        if (!a || !b) continue;

        const raio = calcularRaioDinamico(paradas[i], paradas[i + 1]);
        const dist = distanciaAteSegmento({ lat, lng }, a, b);

        if (dist < menorDistancia && dist <= raio) {
          menorDistancia = dist;
          melhorChave = `${itinerario.id}_${paradas[i]}-${paradas[i + 1]}`;
        }
      }

      return melhorChave;
    },
    [
      itinerario,
      paradaOrigem,
      paradaDestino,
      paradasData,
      obterCoordsParada,
      calcularRaioDinamico,
    ],
  );

  // ========== GERENCIAMENTO DE VIAGEM ==========
  const finalizarViagem = useCallback(
    async (viagemRef, uid, motivo) => {
      finalizarTrecho();

      if (isRastreador && motivo !== "destino") {
        const snap = await getDoc(viagemRef);
        const dados = snap.data();
        if (dados?.proximoRastreador) {
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
      }

      await updateDoc(doc(db, "usuarios", uid), { viagemAtualId: null });
      onExpulsar(motivo);
    },
    [isRastreador, finalizarTrecho, onExpulsar],
  );

  // ========== LÓGICA PRINCIPAL DO TICK ==========
  const tick = useCallback(
    async (pos, uid) => {
      if (!uid || !viagemId) return;

      const agora = Date.now();
      const viagemRef = doc(db, "viagens_ativas", viagemId);
      const viagemSnap = await getDoc(viagemRef);

      if (!viagemSnap.exists()) {
        await finalizarViagem(viagemRef, uid, "cancelada");
        return;
      }

      const viagemDados = viagemSnap.data();

      // Validação de rastreador
      if (isRastreador && viagemDados.rastreadorAtual?.uid !== uid) {
        await finalizarViagem(viagemRef, uid, "rebaixado");
        return;
      }

      // Ativação de GPS para passageiro (próximo ao destino)
      if (
        !isRastreador &&
        onReativarGpsPassageiro &&
        !stateRef.current.jaReativouGpsPassageiro
      ) {
        const paradasLista = itinerario.paradas.map((p) =>
          (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
        );
        const idxDestino = paradasLista.indexOf(
          paradaDestino?.toLowerCase().trim(),
        );
        const indiceAtual = viagemDados.indiceParada ?? 0;

        if (
          idxDestino > 0 &&
          indiceAtual >= idxDestino - 1 &&
          indiceAtual < idxDestino
        ) {
          stateRef.current.jaReativouGpsPassageiro = true;
          onReativarGpsPassageiro();
        }
      }

      // Atualização automática de parada (apenas rastreador)
      if (isRastreador) {
        await verificarEAtualizarParadaAutomatica(
          viagemId,
          pos.lat,
          pos.lng,
          itinerario,
          paradasData,
          true,
        );
      }

      // Detecção e registro de trecho
      const chaveTrecho = detectarTrechoAtual(
        pos.lat,
        pos.lng,
        viagemDados.indiceParada,
      );
      if (chaveTrecho) {
        if (stateRef.current.ultimoTrecho !== chaveTrecho)
          iniciarTrecho(chaveTrecho);
        stateRef.current.ultimoTrecho = chaveTrecho;
        stateRef.current.inicioDesvio = null; // Reset desvio se está na rota
      } else if (isRastreador && !stateRef.current.inicioDesvio) {
        stateRef.current.inicioDesvio = agora;
      }

      // Verificação de desvio prolongado
      if (
        isRastreador &&
        stateRef.current.inicioDesvio &&
        agora - stateRef.current.inicioDesvio >= CONFIG.TEMPO_DESVIO_EXPULSAR_MS
      ) {
        await finalizarViagem(viagemRef, uid, "desvio");
        return;
      }

      // Verificação de chegada ao destino
      const coordsDestino = obterCoordsParada(paradaDestino);
      if (
        coordsDestino &&
        calculateDistance(
          pos.lat,
          pos.lng,
          coordsDestino.lat,
          coordsDestino.lng,
        ) <= CONFIG.DIST_CHEGADA_METROS
      ) {
        await finalizarViagem(viagemRef, uid, "destino");
        return;
      }

      // Salvamento de telemetria (com throttle)
      if (
        isRastreador &&
        agora - stateRef.current.ultimoSave >= CONFIG.THROTTLE_SAVE_MS
      ) {
        let velKmh = 0;
        let distanciaMovida = 0;

        if (stateRef.current.ultimaPos && stateRef.current.ultimoTempo) {
          const deltaT = agora - stateRef.current.ultimoTempo;
          velKmh = calcularVelocidadeKmh(
            stateRef.current.ultimaPos.lat,
            stateRef.current.ultimaPos.lng,
            pos.lat,
            pos.lng,
            deltaT,
          );
          distanciaMovida = calculateDistance(
            stateRef.current.ultimaPos.lat,
            stateRef.current.ultimaPos.lng,
            pos.lat,
            pos.lng,
          );
        }

        stateRef.current.ultimaPos = pos;
        stateRef.current.ultimoTempo = agora;

        if (
          velKmh >= CONFIG.VEL_MIN_KMH &&
          velKmh <= CONFIG.VEL_MAX_KMH &&
          distanciaMovida >= CONFIG.MIN_MOVIMENTO_METROS
        ) {
          stateRef.current.ultimoSave = agora;
          await updateDoc(viagemRef, {
            lat: pos.lat,
            lng: pos.lng,
            velocidade: Math.round(velKmh),
            atualizadoEm: serverTimestamp(),
          });
        }
      }
    },
    [
      viagemId,
      isRastreador,
      itinerario,
      paradaDestino,
      paradasData,
      obterCoordsParada,
      detectarTrechoAtual,
      finalizarViagem,
      iniciarTrecho,
      onReativarGpsPassageiro,
    ],
  );

  // ========== SETUP DO GPS ==========
  useEffect(() => {
    if (!ativo) {
      if (watchIdRef.current)
        navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      finalizarTrecho();
      // Reset completo do estado
      stateRef.current = {
        ultimaPos: null,
        ultimoTempo: null,
        inicioDesvio: null,
        ultimoTrecho: null,
        ultimoSave: 0,
        contadorDesvio: 0,
        jaReativouGpsPassageiro: false,
      };
      return;
    }

    if (watchIdRef.current || !navigator.geolocation) return;

    console.log("[useRastreamento] Iniciando watcher de GPS");
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const uid = auth.currentUser?.uid;
        if (uid)
          tick({ lat: pos.coords.latitude, lng: pos.coords.longitude }, uid);
      },
      (err) => console.warn("[GPS] Erro:", err.message),
      CONFIG.GPS_OPTIONS,
    );

    return () => {
      if (watchIdRef.current)
        navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [ativo, tick, finalizarTrecho]);

  return null;
};
