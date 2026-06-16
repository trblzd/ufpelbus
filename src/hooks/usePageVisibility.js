// hooks/usePageVisibility.js
// HOOK DE VISIBILIDADE DA PÁGINA
// Detecta quando o usuário troca de aba ou minimiza o navegador

import { useState, useEffect } from "react";

/**
 * Hook que retorna se a aba do navegador está visível
 * Útil para:
 * - Pausar/retomar atualizações de GPS (economia de bateria)
 * - Reconectar ao Firebase quando voltar
 * - Parar animações desnecessárias
 *
 * @returns {boolean} true se a aba está visível, false se está oculta
 */
export const usePageVisibility = () => {
  // Estado inicial: assume visível (document.hidden = false)
  const [isVisible, setIsVisible] = useState(!document.hidden);

  useEffect(() => {
    /**
     * Handler do evento visibilitychange
     * Disparado quando:
     * - Usuário troca para outra aba
     * - Usuário minimiza o navegador
     * - Usuário bloqueia a tela (mobile)
     * - Usuário volta para a aba
     */
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    // Registra listener no documento
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Cleanup: remove listener quando o componente desmontar
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return isVisible;
};
