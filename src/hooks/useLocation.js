// hooks/useLocation.js
// HOOK DE GEOLOCALIZAÇÃO
// Gerencia a posição GPS do usuário com configurações otimizadas por caso de uso

import { useState, useEffect, useRef } from "react";

/**
 * Hook para acessar a localização do usuário
 *
 * @param {Object} options - Opções de configuração
 * @param {boolean} options.ativo - Se deve estar ativo (economiza bateria)
 * @param {boolean} options.paraViagem - Se é para rastreamento de viagem (alta precisão)
 * @returns {Object} { position: {lat, lng}, error: string }
 */
export const useLocation = ({ ativo = true, paraViagem = false } = {}) => {
  const [position, setPosition] = useState({ lat: null, lng: null });
  const [error, setError] = useState(null);
  const watchIdRef = useRef(null); // ID do watcher para limpeza

  useEffect(() => {
    // ========== DESATIVADO ==========
    // Se não está ativo, para o watcher se existir
    if (!ativo) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    // ========== VERIFICAÇÃO DE SUPORTE ==========
    if (!navigator.geolocation) {
      setError("Geolocalização não suportada pelo navegador.");
      return;
    }

    /**
     * Configurações de precisão:
     *
     * ParaViagem = true (rastreamento):
     * - enableHighAccuracy: true -> Usa GPS (mais preciso, mais bateria)
     * - timeout: 15000 -> Espera 15 segundos antes de erro
     * - maximumAge: 5000 -> Pode usar posição com até 5 segundos
     *
     * ParaViagem = false (home/casa):
     * - enableHighAccuracy: false -> Usa rede WiFi/celular (menos bateria)
     * - timeout: 20000 -> Espera 20 segundos
     * - maximumAge: 10000 -> Pode usar posição com até 10 segundos
     *
     * Benefício: Economia de bateria de ~70% na tela inicial
     */
    const options = paraViagem
      ? { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 } // Rastreamento
      : { enableHighAccuracy: false, timeout: 20000, maximumAge: 10000 }; // Home

    // Inicia watcher de posição
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) =>
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        }),
      (err) => setError(err.message),
      options,
    );

    // ========== LIMPEZA ==========
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [ativo, paraViagem]); // Reage quando modo de ativo/precisão muda

  return { position, error };
};
