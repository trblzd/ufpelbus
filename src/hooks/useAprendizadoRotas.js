// hooks/useAprendizadoRotas.js (já estava correto, apenas pequeno ajuste)
import { useRef, useCallback, useEffect } from "react";
import { salvarTempoTrecho } from "../services/transporteService";
import { usePageVisibility } from "./usePageVisibility";

const INTERVALO_ENVIO_MS = 10000;

export const useAprendizadoRotas = ({ itinerarioId }) => {
  const filaPendentes = useRef([]);
  const intervalRef = useRef(null);
  const isPageVisible = usePageVisibility();
  const inicioTrechoRef = useRef(null);
  const trechoAtualRef = useRef(null);

  const enviarLote = useCallback(async () => {
    if (filaPendentes.current.length === 0) return;
    const lote = [...filaPendentes.current];
    filaPendentes.current = [];
    for (const item of lote) {
      try {
        await salvarTempoTrecho(item);
      } catch (e) {
        console.warn("Erro ao enviar tempo:", e);
        filaPendentes.current.unshift(item);
      }
    }
  }, []);

  const extrairParadasDaChave = (chaveTrecho) => {
    const underscoreIndex = chaveTrecho.indexOf("_");
    if (underscoreIndex === -1) return null;
    const paradasPart = chaveTrecho.substring(underscoreIndex + 1);
    const hyphenIndex = paradasPart.lastIndexOf("-");
    if (hyphenIndex === -1) return null;
    return {
      paradaA: paradasPart.substring(0, hyphenIndex),
      paradaB: paradasPart.substring(hyphenIndex + 1),
    };
  };

  const iniciarTrecho = useCallback(
    (chaveTrecho) => {
      if (trechoAtualRef.current !== chaveTrecho) {
        if (trechoAtualRef.current && inicioTrechoRef.current) {
          const tempoGasto = Math.round(
            (Date.now() - inicioTrechoRef.current) / 1000,
          );
          if (tempoGasto > 5) {
            const paradas = extrairParadasDaChave(trechoAtualRef.current);
            if (paradas && itinerarioId)
              filaPendentes.current.push({
                itinerarioId,
                paradaA: paradas.paradaA,
                paradaB: paradas.paradaB,
                tempoGastoSegundos: tempoGasto,
              });
          }
        }
        trechoAtualRef.current = chaveTrecho;
        inicioTrechoRef.current = Date.now();
      }
    },
    [itinerarioId],
  );

  const finalizarTrecho = useCallback(() => {
    if (trechoAtualRef.current && inicioTrechoRef.current) {
      const tempoGasto = Math.round(
        (Date.now() - inicioTrechoRef.current) / 1000,
      );
      if (tempoGasto > 5) {
        const paradas = extrairParadasDaChave(trechoAtualRef.current);
        if (paradas && itinerarioId)
          filaPendentes.current.push({
            itinerarioId,
            paradaA: paradas.paradaA,
            paradaB: paradas.paradaB,
            tempoGastoSegundos: tempoGasto,
          });
      }
    }
    trechoAtualRef.current = null;
    inicioTrechoRef.current = null;
  }, [itinerarioId]);

  useEffect(() => {
    if (isPageVisible && intervalRef.current === null)
      intervalRef.current = setInterval(() => {
        if (filaPendentes.current.length) enviarLote();
      }, INTERVALO_ENVIO_MS);
    else if (!isPageVisible && intervalRef.current !== null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      enviarLote();
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      enviarLote();
    };
  }, [isPageVisible, enviarLote]);

  return { iniciarTrecho, finalizarTrecho };
};
