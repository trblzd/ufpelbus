// hooks/useLocation.js
import { useState, useEffect, useRef } from "react";

export const useLocation = ({ ativo = true, paraViagem = false } = {}) => {
  const [position, setPosition] = useState({ lat: null, lng: null });
  const [error, setError] = useState(null);
  const watchIdRef = useRef(null);

  useEffect(() => {
    if (!ativo) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!navigator.geolocation) {
      setError("Geolocalização não suportada pelo navegador.");
      return;
    }

    // Configurações diferentes para viagem (rastreamento) vs uso normal
    const options = paraViagem
      ? { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 } // rastreamento: mais preciso, mas menos frequente
      : { enableHighAccuracy: false, timeout: 20000, maximumAge: 10000 }; // home: menos preciso, economia de bateria/dados

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) =>
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => setError(err.message),
      options,
    );

    return () => {
      if (watchIdRef.current !== null)
        navigator.geolocation.clearWatch(watchIdRef.current);
    };
  }, [ativo, paraViagem]);

  return { position, error };
};
