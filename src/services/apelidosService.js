// services/apelidosService.js
import { atualizarCacheApelidos } from "../utils/dicionarioParadas";

let apelidosCache = null;
let listeners = [];

const carregarCache = () => {
  if (apelidosCache === null) {
    try {
      apelidosCache = JSON.parse(localStorage.getItem("user_apelidos") || "{}");
    } catch {
      apelidosCache = {};
    }
  }
  return apelidosCache;
};

const salvarCache = () => {
  localStorage.setItem("user_apelidos", JSON.stringify(apelidosCache));
  // Atualiza o cache no dicionarioParadas também
  atualizarCacheApelidos(apelidosCache);
  // Notifica ouvintes
  listeners.forEach((fn) => fn(apelidosCache));
};

// Retorna o apelido sem chamar traduzirSigla (evita recursão)
export const getApelido = (sigla) => {
  const cache = carregarCache();
  if (cache[sigla]) return cache[sigla];
  return null; // Retorna null se não houver apelido
};

export const setApelido = (sigla, novoNome) => {
  const cache = carregarCache();
  cache[sigla] = novoNome;
  salvarCache();
};

export const setMultiplosApelidos = (apelidosObj) => {
  const cache = carregarCache();
  Object.assign(cache, apelidosObj);
  salvarCache();
};

export const getAllApelidos = () => {
  return { ...carregarCache() };
};

export const limparApelidos = () => {
  apelidosCache = {};
  salvarCache();
};

export const subscribeApelidos = (callback) => {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((fn) => fn !== callback);
  };
};

// Função para obter apelido com fallback (usar somente quando necessário)
export const getApelidoComFallback = (sigla, fallback) => {
  const apelido = getApelido(sigla);
  return apelido || fallback;
};
