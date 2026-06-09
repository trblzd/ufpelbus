// hooks/usePersistViagem.js
import { useState, useEffect, useRef } from "react";

export const usePersistViagem = (key, initialState) => {
  const [state, setState] = useState(() => {
    try {
      const saved = sessionStorage.getItem(`busepel_${key}`);
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error(`Erro ao restaurar ${key}:`, e);
    }
    return typeof initialState === "function" ? initialState() : initialState;
  });

  const isInitialMount = useRef(true);

  useEffect(() => {
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

  const clearPersisted = () => {
    sessionStorage.removeItem(`busepel_${key}`);
  };

  return [state, setState, clearPersisted];
};
