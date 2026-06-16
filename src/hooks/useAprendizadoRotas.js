// hooks/useAprendizadoRotas.js
// HOOK DE APRENDIZADO DE ROTAS
// Coleta tempos de percurso entre paradas para melhorar estimativas futuras

import { useRef, useCallback, useEffect } from "react";
import { salvarTempoTrecho } from "../services/transporteService";
import { usePageVisibility } from "./usePageVisibility";

// ==================== CONSTANTES ====================

// Envia lotes de dados a cada 10 segundos (evita muitas requisições)
const INTERVALO_ENVIO_MS = 10000;

// ==================== HOOK PRINCIPAL ====================

/**
 * Hook para aprendizado de rotas
 *
 * Como funciona:
 * 1. Quando o rastreador entra em um trecho, marca horário de início
 * 2. Quando sai do trecho (ou muda de trecho), calcula tempo gasto
 * 3. Acumula tempos em uma fila
 * 4. Envia lote para o Firebase a cada 10 segundos ou quando a aba é fechada
 *
 * Por que fazer assim?
 * - Evita sobrecarga de requisições (batch)
 * - Pausa quando aba está oculta (economia de bateria)
 * - Envia dados pendentes antes de fechar
 *
 * @param {Object} params
 * @param {string} params.itinerarioId - ID do itinerário (ex: "anglo")
 * @returns {Object} { iniciarTrecho, finalizarTrecho }
 */
export const useAprendizadoRotas = ({ itinerarioId }) => {
  // ==================== REFS ====================
  const filaPendentes = useRef([]); // Fila de tempos a serem enviados
  const intervalRef = useRef(null); // Intervalo para envio em lote
  const isPageVisible = usePageVisibility(); // Detecta se aba está visível

  // Controle do trecho atual
  const inicioTrechoRef = useRef(null); // Timestamp de quando entrou no trecho
  const trechoAtualRef = useRef(null); // ID do trecho atual

  // ==================== FUNÇÕES ====================

  /**
   * Envia todos os itens pendentes para o Firebase
   * Se falhar, recoloca na fila para tentar depois
   */
  const enviarLote = useCallback(async () => {
    if (filaPendentes.current.length === 0) return;

    const lote = [...filaPendentes.current];
    filaPendentes.current = [];

    for (const item of lote) {
      try {
        await salvarTempoTrecho(item);
      } catch (e) {
        console.warn("Erro ao enviar tempo:", e);
        // Recoloca no início da fila para tentar novamente
        filaPendentes.current.unshift(item);
      }
    }
  }, []);

  /**
   * Extrai as paradas A e B de uma chave de trecho
   *
   * Exemplo: "anglo_capao-centro" → { paradaA: "capao", paradaB: "centro" }
   *
   * @param {string} chaveTrecho - Formato: "{itinerarioId}_{paradaA}-{paradaB}"
   * @returns {Object|null} { paradaA, paradaB } ou null se formato inválido
   */
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

  /**
   * Marca o início de um trecho
   * Se já estava em outro trecho, finaliza o anterior automaticamente
   *
   * @param {string} chaveTrecho - Chave do trecho que está começando
   */
  const iniciarTrecho = useCallback(
    (chaveTrecho) => {
      // Se mudou de trecho, finaliza o anterior
      if (trechoAtualRef.current !== chaveTrecho) {
        // Finaliza trecho anterior (se existir)
        if (trechoAtualRef.current && inicioTrechoRef.current) {
          const tempoGasto = Math.round(
            (Date.now() - inicioTrechoRef.current) / 1000,
          );
          // Ignora tempos muito curtos (<5s) - provavelmente erro de GPS
          if (tempoGasto > 5) {
            const paradas = extrairParadasDaChave(trechoAtualRef.current);
            if (paradas && itinerarioId) {
              filaPendentes.current.push({
                itinerarioId,
                paradaA: paradas.paradaA,
                paradaB: paradas.paradaB,
                tempoGastoSegundos: tempoGasto,
              });
            }
          }
        }
        // Inicia novo trecho
        trechoAtualRef.current = chaveTrecho;
        inicioTrechoRef.current = Date.now();
      }
    },
    [itinerarioId],
  );

  /**
   * Finaliza o trecho atual (chamado quando a viagem termina ou é expulsa)
   * Envia o tempo do último trecho
   */
  const finalizarTrecho = useCallback(() => {
    if (trechoAtualRef.current && inicioTrechoRef.current) {
      const tempoGasto = Math.round(
        (Date.now() - inicioTrechoRef.current) / 1000,
      );
      if (tempoGasto > 5) {
        const paradas = extrairParadasDaChave(trechoAtualRef.current);
        if (paradas && itinerarioId) {
          filaPendentes.current.push({
            itinerarioId,
            paradaA: paradas.paradaA,
            paradaB: paradas.paradaB,
            tempoGastoSegundos: tempoGasto,
          });
        }
      }
    }
    // Limpa referências
    trechoAtualRef.current = null;
    inicioTrechoRef.current = null;
  }, [itinerarioId]);

  // ==================== GERENCIAMENTO DO INTERVALO ====================

  /**
   * Gerencia o intervalo de envio baseado na visibilidade da página
   * - Aba visível: intervalo ativo (envia a cada 10 segundos)
   * - Aba oculta: pausa o intervalo e envia dados pendentes imediatamente
   */
  useEffect(() => {
    if (isPageVisible && intervalRef.current === null) {
      // Aba visível: inicia intervalo
      intervalRef.current = setInterval(() => {
        if (filaPendentes.current.length) enviarLote();
      }, INTERVALO_ENVIO_MS);
    } else if (!isPageVisible && intervalRef.current !== null) {
      // Aba oculta: pausa e envia dados pendentes
      clearInterval(intervalRef.current);
      intervalRef.current = null;
      enviarLote();
    }

    // Cleanup: envia dados pendentes quando o componente desmontar
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      enviarLote();
    };
  }, [isPageVisible, enviarLote]);

  return { iniciarTrecho, finalizarTrecho };
};
