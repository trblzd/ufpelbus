// services/apelidosService.js
// SERVIÇO DE APELIDOS - Gerencia nomes personalizados para paradas
// Permite que os usuários renomeiem paradas conforme preferência

import { atualizarCacheApelidos } from "../utils/dicionarioParadas";

// ==================== ESTADO GLOBAL ====================

/**
 * Cache em memória dos apelidos
 * Carregado do localStorage na primeira vez
 */
let apelidosCache = null;

/**
 * Lista de listeners para mudanças nos apelidos
 * Usado para sincronizar entre diferentes componentes/abas
 */
let listeners = [];

// ==================== FUNÇÕES DE CACHE ====================

/**
 * Carrega o cache do localStorage (se disponível)
 * @returns {Object} Mapa de apelidos { sigla: "nome personalizado" }
 */
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

/**
 * Salva o cache no localStorage e notifica ouvintes
 * Também atualiza o dicionarioParadas para manter consistência
 */
const salvarCache = () => {
  localStorage.setItem("user_apelidos", JSON.stringify(apelidosCache));

  // Atualiza o cache no dicionarioParadas (evita duplicação)
  atualizarCacheApelidos(apelidosCache);

  // Notifica todos os ouvintes sobre a mudança
  listeners.forEach((fn) => fn(apelidosCache));
};

// ==================== API PÚBLICA ====================

/**
 * Retorna o apelido de uma parada (sem fallback)
 * @param {string} sigla - Sigla da parada (ex: "anglo")
 * @returns {string|null} Apelido ou null se não houver
 */
export const getApelido = (sigla) => {
  const cache = carregarCache();
  if (cache[sigla]) return cache[sigla];
  return null;
};

/**
 * Define um apelido para uma parada
 * @param {string} sigla - Sigla da parada
 * @param {string} novoNome - Novo nome personalizado
 */
export const setApelido = (sigla, novoNome) => {
  const cache = carregarCache();
  cache[sigla] = novoNome;
  salvarCache();
};

/**
 * Define MÚLTIPLOS apelidos de uma vez
 * Útil para salvar todas as alterações da página de personalização
 * @param {Object} apelidosObj - Mapa de apelidos { sigla: "nome" }
 */
export const setMultiplosApelidos = (apelidosObj) => {
  const cache = carregarCache();
  Object.assign(cache, apelidosObj);
  salvarCache();
};

/**
 * Retorna TODOS os apelidos (cópia)
 * @returns {Object} Cópia do mapa de apelidos
 */
export const getAllApelidos = () => {
  return { ...carregarCache() };
};

/**
 * Limpa TODOS os apelidos (reset)
 */
export const limparApelidos = () => {
  apelidosCache = {};
  salvarCache();
};

/**
 * Inscreve-se para mudanças nos apelidos
 * Permite que componentes reajam a alterações em tempo real
 *
 * @param {Function} callback - Função chamada quando apelidos mudam
 * @returns {Function} Função para cancelar inscrição
 *
 * @example
 * const unsubscribe = subscribeApelidos((novosApelidos) => {
 *   console.log("Apelidos atualizados:", novosApelidos);
 * });
 * // ... quando não precisar mais:
 * unsubscribe();
 */
export const subscribeApelidos = (callback) => {
  listeners.push(callback);
  return () => {
    listeners = listeners.filter((fn) => fn !== callback);
  };
};

/**
 * Retorna apelido com fallback (se não houver apelido, usa o fallback)
 * @param {string} sigla - Sigla da parada
 * @param {string} fallback - Valor padrão se não houver apelido
 * @returns {string} Apelido ou fallback
 */
export const getApelidoComFallback = (sigla, fallback) => {
  const apelido = getApelido(sigla);
  return apelido || fallback;
};
