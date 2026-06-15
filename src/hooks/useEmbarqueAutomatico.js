// hooks/useEmbarqueAutomatico.js
import { useState, useEffect, useRef, useCallback } from "react";
import { calculateDistance } from "../utils/geoUtils";

const DISTANCIA_EMBARQUE_METROS = 80;
const VELOCIDADE_MAX_EMBARQUE_KMH = 3; // CORRIGIDO: embarque quando PARADO
const TEMPO_CONFIRMACAO_MS = 3000;

export const useEmbarqueAutomatico = ({
  ativo,
  position,
  paradaOrigem,
  paradaCoords,
  onEmbarqueConfirmado,
}) => {
  const [status, setStatus] = useState("aguardando");
  const [distancia, setDistancia] = useState(null);
  const [velocidade, setVelocidade] = useState(0);
  const [tempoRestante, setTempoRestante] = useState(null);

  const ultimaPosicaoRef = useRef(null);
  const ultimoTempoRef = useRef(null);
  const inicioEmbarqueRef = useRef(null);
  const jaDisparouRef = useRef(false);
  const intervalRef = useRef(null);

  const calcularVelocidade = useCallback((lat1, lng1, lat2, lng2, deltaMs) => {
    if (deltaMs <= 0) return 0;
    const distMetros = calculateDistance(lat1, lng1, lat2, lng2);
    const distKm = distMetros / 1000;
    const tempoHoras = deltaMs / 3600000;
    return distKm / tempoHoras;
  }, []);

  useEffect(() => {
    if (status === "proximo" && inicioEmbarqueRef.current) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        if (inicioEmbarqueRef.current) {
          const elapsed = Date.now() - inicioEmbarqueRef.current;
          const remaining = Math.max(0, TEMPO_CONFIRMACAO_MS - elapsed);
          setTempoRestante(remaining);
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

  useEffect(() => {
    if (
      !ativo ||
      !position ||
      !paradaCoords ||
      !paradaOrigem ||
      jaDisparouRef.current
    )
      return;

    const { lat, lng } = position;
    const dist = calculateDistance(lat, lng, paradaCoords[0], paradaCoords[1]);
    setDistancia(dist);

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

    ultimaPosicaoRef.current = { lat, lng };
    ultimoTempoRef.current = Date.now();

    // CORREÇÃO: Confirma embarque quando está próximo E PARADO (velocidade baixa)
    if (dist <= DISTANCIA_EMBARQUE_METROS) {
      if (status === "aguardando") {
        setStatus("proximo");
      }

      // Mudança: velocidade MENOR que o limite para confirmar embarque
      if (vel <= VELOCIDADE_MAX_EMBARQUE_KMH) {
        if (!inicioEmbarqueRef.current) {
          inicioEmbarqueRef.current = Date.now();
        } else {
          const tempoParado = Date.now() - inicioEmbarqueRef.current;
          if (tempoParado >= TEMPO_CONFIRMACAO_MS && !jaDisparouRef.current) {
            jaDisparouRef.current = true;
            setStatus("confirmado");
            onEmbarqueConfirmado();
          }
        }
      } else {
        // Reset se começou a se mover
        if (inicioEmbarqueRef.current) {
          inicioEmbarqueRef.current = null;
        }
      }
    } else {
      if (status !== "aguardando") setStatus("aguardando");
      inicioEmbarqueRef.current = null;
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
