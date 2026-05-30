import { useState, useEffect } from "react";

export const useLocation = () => {
  const [position, setPosition] = useState({ lat: null, lng: null });
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setError("Geolocalização não suportada pelo navegador.");
      return;
    }

    const watcher = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => setError(err.message),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 },
    );

    return () => navigator.geolocation.clearWatch(watcher);
  }, []);

  return { position, error };
};
