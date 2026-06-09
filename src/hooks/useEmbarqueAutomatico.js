// hooks/useEmbarqueAutomatico.js
import { useState, useEffect, useRef, useCallback } from "react";
import { calculateDistance } from "../utils/geoUtils";

const DISTANCIA_EMBARQUE_METROS = 80;
const VELOCIDADE_EMBARQUE_KMH = 5;
const TEMPO_CONFIRMACAO_MS = 5000;

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

  // Atualiza tempo restante em tempo real
  useEffect(() => {
    if (
      status === "proximo" &&
      inicioEmbarqueRef.current &&
      velocidade > VELOCIDADE_EMBARQUE_KMH
    ) {
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
  }, [status, velocidade]);

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

    if (dist <= DISTANCIA_EMBARQUE_METROS) {
      if (status === "aguardando") {
        setStatus("proximo");
        console.log(`[EmbarqueAuto] Próximo à parada (${Math.round(dist)}m)`);
      }

      if (vel > VELOCIDADE_EMBARQUE_KMH) {
        if (!inicioEmbarqueRef.current) {
          inicioEmbarqueRef.current = Date.now();
          console.log(
            `[EmbarqueAuto] Velocidade detectada: ${vel.toFixed(1)}km/h - aguardando confirmação...`,
          );
        } else {
          const tempoEmVelocidade = Date.now() - inicioEmbarqueRef.current;
          if (
            tempoEmVelocidade >= TEMPO_CONFIRMACAO_MS &&
            !jaDisparouRef.current
          ) {
            jaDisparouRef.current = true;
            setStatus("confirmado");
            console.log(
              `[EmbarqueAuto] Embarque confirmado após ${tempoEmVelocidade}ms`,
            );
            onEmbarqueConfirmado();
          }
        }
      } else {
        if (inicioEmbarqueRef.current) {
          inicioEmbarqueRef.current = null;
          console.log("[EmbarqueAuto] Velocidade caiu, resetando contagem");
        }
      }
    } else {
      if (status !== "aguardando") {
        setStatus("aguardando");
      }
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
