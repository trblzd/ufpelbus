// hooks/useRastreamento.js
// HOOK DE RASTREAMENTO DE VIAGEM
// Gerencia o envio de posição GPS durante a viagem ativa

import { useEffect, useRef, useCallback, useMemo } from "react";
import { db, auth } from "../services/firebase";
import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";
import { verificarEAtualizarParadaAutomatica } from "../services/transporteService";
import { useAprendizadoRotas } from "./useAprendizadoRotas";

// ========== CONFIGURAÇÕES ==========
const CONFIG = {
  VEL_MIN_KMH: 2, // Velocidade mínima para salvar (evita ruído)
  VEL_MAX_KMH: 70, // Velocidade máxima plausível (filtro)
  DESVIO_MAX_METROS: 500, // Distância máxima para considerar "na rota"
  TEMPO_DESVIO_EXPULSAR_MS: 600000, // 10 minutos fora da rota = expulsão
  DIST_CHEGADA_METROS: 80, // Distância para considerar "chegou ao destino"
  THROTTLE_SAVE_MS: 15000, // Salva posição a cada 15 segundos (economia)
  MIN_MOVIMENTO_METROS: 20, // Movimento mínimo para salvar (evita posição parada)
  RAIO_DINAMICO_PERCENT: 0.15, // 15% da distância entre paradas
  RAIO_MINIMO_METROS: 100, // Raio mínimo de detecção (100m)
  RAIO_MAXIMO_METROS: 500, // Raio máximo de detecção (500m)
  GPS_OPTIONS: {
    enableHighAccuracy: true, // Alta precisão para rastreamento
    timeout: 15000, // Timeout de 15 segundos
    maximumAge: 5000, // Pode usar posição com até 5 segundos
  },
};

// ========== UTILITÁRIOS PUROS ==========

/**
 * Calcula velocidade em km/h entre duas posições GPS
 */
const calcularVelocidadeKmh = (lat1, lng1, lat2, lng2, deltaMs) => {
  if (deltaMs <= 0) return 0;
  const distMetros = calculateDistance(lat1, lng1, lat2, lng2);
  return distMetros / 1000 / (deltaMs / 3600000);
};

/**
 * Calcula distância de um ponto a um segmento de reta (entre duas paradas)
 * Usado para detectar se o ônibus está no trecho correto
 */
const distanciaAteSegmento = (p, a, b) => {
  const dy = b.lat - a.lat;
  const dx = b.lng - a.lng;
  if (dx === 0 && dy === 0)
    return calculateDistance(p.lat, p.lng, a.lat, a.lng);

  // Projeção do ponto no segmento
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

/**
 * Hook de rastreamento
 *
 * Responsabilidades:
 * 1. Enviar posição GPS em tempo real (apenas rastreador)
 * 2. Detectar paradas automaticamente
 * 3. Gerenciar desvios de rota
 * 4. Promover próximo rastreador quando o atual desce
 * 5. Ativar GPS de passageiros próximos ao destino
 *
 * @param {Object} params
 * @param {boolean} params.ativo - Se o rastreamento está ativo
 * @param {boolean} params.isRastreador - Se o usuário é o rastreador atual
 * @param {Object} params.itinerario - Dados do itinerário
 * @param {string} params.horario - Horário da viagem
 * @param {string} params.paradaOrigem - Parada de embarque
 * @param {string} params.paradaDestino - Parada de desembarque
 * @param {Object} params.paradasData - Dados de todas as paradas
 * @param {Function} params.onExpulsar - Callback quando usuário é expulso
 * @param {Function} params.onReativarGpsPassageiro - Callback para ativar GPS de passageiro
 */
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
  // ID único da viagem
  const viagemId = useMemo(
    () =>
      `${itinerario?.id?.toLowerCase()?.trim()}_${horario?.replace(":", "")}`,
    [itinerario?.id, horario],
  );

  // ========== REFS ==========
  const watchIdRef = useRef(null); // ID do watcher GPS
  const stateRef = useRef({
    ultimaPos: null, // Última posição salva
    ultimoTempo: null, // Timestamp da última posição
    inicioDesvio: null, // Quando começou o desvio
    ultimoTrecho: null, // Último trecho detectado
    ultimoSave: 0, // Último salvamento (throttle)
    contadorDesvio: 0, // Contador para desvio
    jaReativouGpsPassageiro: false, // Já ativou GPS de passageiro
  });

  // Hook de aprendizado de rotas (mede tempos entre paradas)
  const { iniciarTrecho, finalizarTrecho } = useAprendizadoRotas({
    itinerarioId: itinerario?.id,
  });

  // ========== FUNÇÕES DE PARADA ==========

  /**
   * Obtém coordenadas de uma parada (normalizadas)
   */
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

  /**
   * Calcula raio dinâmico baseado na distância entre paradas
   * Paradas mais distantes têm raio maior
   */
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

  /**
   * Detecta em qual trecho do itinerário o ônibus está atualmente
   * Baseado na posição GPS e na distância aos segmentos do trajeto
   */
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
      obterCoordsParada,
      calcularRaioDinamico,
    ],
  );

  // ========== GERENCIAMENTO DE VIAGEM ==========

  /**
   * Finaliza a viagem para o usuário atual
   * - Promove próximo rastreador (se houver)
   * - Limpa referência da viagem no usuário
   * - Chama callback onExpulsar
   */
  const finalizarViagem = useCallback(
    async (viagemRef, uid, motivo) => {
      finalizarTrecho();

      // Se for rastreador e não for destino, promove próximo
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

      // Limpa referência da viagem no usuário
      await updateDoc(doc(db, "usuarios", uid), { viagemAtualId: null });
      onExpulsar(motivo);
    },
    [isRastreador, finalizarTrecho, onExpulsar],
  );

  // ========== LÓGICA PRINCIPAL DO TICK ==========

  /**
   * Função principal chamada a cada atualização de GPS
   * Gerencia todo o ciclo de rastreamento
   */
  const tick = useCallback(
    async (pos, uid) => {
      if (!uid || !viagemId) return;

      const agora = Date.now();
      const viagemRef = doc(db, "viagens_ativas", viagemId);
      const viagemSnap = await getDoc(viagemRef);

      // Verifica se viagem ainda existe
      if (!viagemSnap.exists()) {
        await finalizarViagem(viagemRef, uid, "cancelada");
        return;
      }

      const viagemDados = viagemSnap.data();

      // Verifica se ainda é o rastreador (pode ter sido substituído)
      if (isRastreador && viagemDados.rastreadorAtual?.uid !== uid) {
        await finalizarViagem(viagemRef, uid, "rebaixado");
        return;
      }

      // Ativa GPS de passageiros próximos ao destino
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

        // Se está a 1 parada do destino, ativa GPS
        if (
          idxDestino > 0 &&
          indiceAtual >= idxDestino - 1 &&
          indiceAtual < idxDestino
        ) {
          stateRef.current.jaReativouGpsPassageiro = true;
          onReativarGpsPassageiro();
        }
      }

      // Atualiza parada automática (apenas rastreador)
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

      // Detecta trecho atual para aprendizado
      const chaveTrecho = detectarTrechoAtual(
        pos.lat,
        pos.lng,
        viagemDados.indiceParada,
      );
      if (chaveTrecho) {
        if (stateRef.current.ultimoTrecho !== chaveTrecho)
          iniciarTrecho(chaveTrecho);
        stateRef.current.ultimoTrecho = chaveTrecho;
        stateRef.current.inicioDesvio = null;
      } else if (isRastreador && !stateRef.current.inicioDesvio) {
        stateRef.current.inicioDesvio = agora;
      }

      // Verifica desvio prolongado (10 minutos fora da rota)
      if (
        isRastreador &&
        stateRef.current.inicioDesvio &&
        agora - stateRef.current.inicioDesvio >= CONFIG.TEMPO_DESVIO_EXPULSAR_MS
      ) {
        await finalizarViagem(viagemRef, uid, "desvio");
        return;
      }

      // Verifica chegada ao destino
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

      // Salva telemetria (com throttle para economizar requisições)
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

        // Só salva se velocidade for plausível e se moveu minimamente
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

  /**
   * Inicia/para o watcher de GPS baseado no estado `ativo`
   */
  useEffect(() => {
    if (!ativo) {
      // Para o watcher e limpa estado
      if (watchIdRef.current)
        navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      finalizarTrecho();
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

  return null; // Hook sem UI, apenas lógica
};
