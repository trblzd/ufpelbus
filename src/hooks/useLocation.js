// hooks/useLocation.js
import { useState, useEffect, useRef } from "react";

export const useLocation = ({ ativo = true } = {}) => {
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

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 },
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [ativo]);

  return { position, error };
};
