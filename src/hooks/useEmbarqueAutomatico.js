// hooks/useEmbarqueAutomatico.js
// HOOK DE EMBARQUE AUTOMÁTICO
// Detecta quando o usuário está próximo da parada e parado, confirmando embarque automaticamente

import { useState, useEffect, useRef, useCallback } from "react";
import { calculateDistance } from "../utils/geoUtils";

// ==================== CONSTANTES ====================

// Distância máxima da parada para considerar "próximo" (80 metros)
const DISTANCIA_EMBARQUE_METROS = 80;

// Velocidade máxima para considerar que o usuário está "parado" (3 km/h)
// Valores abaixo disso indicam que o usuário está aguardando o ônibus
const VELOCIDADE_MAX_EMBARQUE_KMH = 3;

// Tempo que o usuário precisa ficar parado para confirmar embarque (3 segundos)
// Evita disparos falsos por movimento temporário
const TEMPO_CONFIRMACAO_MS = 3000;

// ==================== HOOK PRINCIPAL ====================

/**
 * Hook para embarque automático
 *
 * Estados possíveis:
 * - "aguardando": Usuário longe da parada ou em movimento
 * - "proximo": Usuário está perto da parada
 * - "confirmado": Embarque já foi confirmado (evita múltiplos disparos)
 *
 * @param {Object} params
 * @param {boolean} params.ativo - Se o hook está ativo (depende do fluxo da viagem)
 * @param {Object} params.position - Posição GPS atual { lat, lng }
 * @param {string} params.paradaOrigem - Nome da parada de origem
 * @param {Array} params.paradaCoords - Coordenadas [lat, lng] da parada
 * @param {Function} params.onEmbarqueConfirmado - Callback quando o embarque é confirmado
 */
export const useEmbarqueAutomatico = ({
  ativo,
  position,
  paradaOrigem,
  paradaCoords,
  onEmbarqueConfirmado,
}) => {
  // ==================== ESTADOS ====================
  const [status, setStatus] = useState("aguardando"); // Estado atual do embarque
  const [distancia, setDistancia] = useState(null); // Distância até a parada (metros)
  const [velocidade, setVelocidade] = useState(0); // Velocidade atual (km/h)
  const [tempoRestante, setTempoRestante] = useState(null); // Tempo restante para confirmação (ms)

  // ==================== REFS ====================
  const ultimaPosicaoRef = useRef(null); // Última posição GPS para calcular velocidade
  const ultimoTempoRef = useRef(null); // Timestamp da última posição
  const inicioEmbarqueRef = useRef(null); // Quando começou a ficar parado na parada
  const jaDisparouRef = useRef(false); // Evita múltiplos disparos do callback
  const intervalRef = useRef(null); // Intervalo para atualizar tempoRestante

  // ==================== FUNÇÕES ====================

  /**
   * Calcula a velocidade atual baseado no deslocamento entre duas posições
   * @param {number} lat1, lng1 - Primeira posição
   * @param {number} lat2, lng2 - Segunda posição
   * @param {number} deltaMs - Tempo entre as medições (ms)
   * @returns {number} Velocidade em km/h
   */
  const calcularVelocidade = useCallback((lat1, lng1, lat2, lng2, deltaMs) => {
    if (deltaMs <= 0) return 0;
    const distMetros = calculateDistance(lat1, lng1, lat2, lng2);
    const distKm = distMetros / 1000;
    const tempoHoras = deltaMs / 3600000;
    return distKm / tempoHoras;
  }, []);

  // ==================== EFEITOS ====================

  /**
   * Gerencia o timer de contagem regressiva quando o usuário está "proximo"
   * Atualiza tempoRestante a cada 100ms para mostrar feedback visual
   */
  useEffect(() => {
    if (status === "proximo" && inicioEmbarqueRef.current) {
      // Limpa intervalo anterior se existir
      if (intervalRef.current) clearInterval(intervalRef.current);

      // Cria novo intervalo para atualizar tempoRestante
      intervalRef.current = setInterval(() => {
        if (inicioEmbarqueRef.current) {
          const elapsed = Date.now() - inicioEmbarqueRef.current;
          const remaining = Math.max(0, TEMPO_CONFIRMACAO_MS - elapsed);
          setTempoRestante(remaining);

          // Limpa intervalo quando chegar a zero
          if (remaining <= 0 && !jaDisparouRef.current) {
            clearInterval(intervalRef.current);
          }
        }
      }, 100);

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else {
      setTempoRestante(null);
    }
  }, [status]);

  /**
   * Lógica principal de detecção de embarque
   * Executa sempre que posição, ativo ou outros parâmetros mudam
   */
  useEffect(() => {
    // Validações iniciais
    if (
      !ativo ||
      !position ||
      !paradaCoords ||
      !paradaOrigem ||
      jaDisparouRef.current
    )
      return;

    const { lat, lng } = position;

    // Calcula distância atual até a parada
    const dist = calculateDistance(lat, lng, paradaCoords[0], paradaCoords[1]);
    setDistancia(dist);

    // Calcula velocidade atual
    let vel = 0;
    if (ultimaPosicaoRef.current && ultimoTempoRef.current) {
      const deltaMs = Date.now() - ultimoTempoRef.current;
      vel = calcularVelocidade(
        ultimaPosicaoRef.current.lat,
        ultimaPosicaoRef.current.lng,
        lat,
        lng,
        deltaMs,
      );
      setVelocidade(vel);
    }

    // Atualiza posições para próxima iteração
    ultimaPosicaoRef.current = { lat, lng };
    ultimoTempoRef.current = Date.now();

    // ========== LÓGICA DE DETECÇÃO ==========

    // CASO 1: Usuário está próximo da parada (dist <= 80m)
    if (dist <= DISTANCIA_EMBARQUE_METROS) {
      // Muda status para "proximo" se ainda não estiver
      if (status === "aguardando") {
        setStatus("proximo");
      }

      // Verifica se está parado (velocidade <= 3 km/h)
      if (vel <= VELOCIDADE_MAX_EMBARQUE_KMH) {
        // Inicia ou continua timer de confirmação
        if (!inicioEmbarqueRef.current) {
          inicioEmbarqueRef.current = Date.now(); // Começa a contar
        } else {
          const tempoParado = Date.now() - inicioEmbarqueRef.current;
          // Após 3 segundos parado, confirma embarque
          if (tempoParado >= TEMPO_CONFIRMACAO_MS && !jaDisparouRef.current) {
            jaDisparouRef.current = true;
            setStatus("confirmado");
            onEmbarqueConfirmado(); // Dispara callback
          }
        }
      } else {
        // Reset se começou a se mover (velocidade > 3 km/h)
        if (inicioEmbarqueRef.current) {
          inicioEmbarqueRef.current = null;
        }
      }
    }
    // CASO 2: Usuário está longe da parada
    else {
      if (status !== "aguardando") setStatus("aguardando");
      inicioEmbarqueRef.current = null; // Reset timer
    }
  }, [
    ativo,
    position,
    paradaCoords,
    paradaOrigem,
    status,
    calcularVelocidade,
    onEmbarqueConfirmado,
  ]);

  /**
   * Limpa todos os estados quando o hook é desativado
   * Previne memória vazada e callbacks fantasmas
   */
  useEffect(() => {
    if (!ativo) {
      jaDisparouRef.current = false;
      inicioEmbarqueRef.current = null;
      setStatus("aguardando");
      setTempoRestante(null);
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [ativo]);

  return { status, distancia, velocidade, tempoRestante };
};
