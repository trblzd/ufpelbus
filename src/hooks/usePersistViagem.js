// hooks/usePersistViagem.js
// HOOK DE PERSISTÊNCIA DE VIAGEM
// Salva estado da viagem em sessionStorage para recuperar após refresh (F5)

import { useState, useEffect, useRef } from "react";

/**
 * Hook que persiste estado no sessionStorage
 *
 * sessionStorage vs localStorage:
 * - sessionStorage: Persiste apenas durante a sessão (aba aberta)
 * - localStorage: Persiste para sempre (entre sessões)
 *
 * Usamos sessionStorage porque viagem ativa deve expirar ao fechar a aba
 *
 * @param {string} key - Chave única para armazenamento (prefixo "busepel_")
 * @param {any} initialState - Valor inicial (se não houver salvo)
 * @returns {[any, Function, Function]} [state, setState, clearPersisted]
 *
 * @example
 * const [status, setStatus, clearStatus] = usePersistViagem('statusFluxo', 'inicial');
 */
export const usePersistViagem = (key, initialState) => {
  // ========== INICIALIZAÇÃO COM CACHE ==========
  // Tenta carregar do sessionStorage primeiro
  const [state, setState] = useState(() => {
    try {
      const saved = sessionStorage.getItem(`busepel_${key}`);
      if (saved !== null) {
        return JSON.parse(saved); // Restaura estado salvo
      }
    } catch (e) {
      console.error(`Erro ao restaurar ${key}:`, e);
    }
    // Fallback para initialState (pode ser função ou valor direto)
    return typeof initialState === "function" ? initialState() : initialState;
  });

  // ========== CONTROLE DE PRIMEIRA MONTAGEM ==========
  // Evita salvar no sessionStorage na primeira renderização (já está salvo)
  const isInitialMount = useRef(true);

  // ========== PERSISTÊNCIA ==========
  // Salva no sessionStorage sempre que o estado mudar (exceto na primeira vez)
  useEffect(() => {
    // Pula a primeira montagem
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    try {
      sessionStorage.setItem(`busepel_${key}`, JSON.stringify(state));
    } catch (e) {
      console.error(`Erro ao salvar ${key}:`, e);
    }
  }, [state, key]);

  /**
   * Limpa o valor persistido do sessionStorage
   * Usado quando a viagem termina (expulso/inicial)
   */
  const clearPersisted = () => {
    sessionStorage.removeItem(`busepel_${key}`);
  };

  return [state, setState, clearPersisted];
};
