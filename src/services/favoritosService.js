// services/favoritosService.js
// SERVIÇO DE FAVORITOS - Gerencia paradas favoritas do usuário
// Sincroniza entre localStorage (fallback) e Firestore (cloud)

import { db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// ==================== ESTADO GLOBAL ====================

/**
 * Cache em memória dos favoritos
 * Carregado do localStorage/Firestore na primeira vez
 */
let favoritosCache = null;

/**
 * UID do usuário atual (para saber se o cache ainda é válido)
 */
let uidAtual = null;

// ==================== FUNÇÕES DE STORAGE LOCAL ====================

/**
 * Carrega favoritos do localStorage (fallback offline)
 * @returns {Array} Lista de IDs de paradas favoritas
 */
const carregarDoLocalStorage = () => {
  return JSON.parse(localStorage.getItem("user_favoritos") || "[]");
};

/**
 * Salva favoritos no localStorage
 * @param {Array} lista - Lista de IDs de paradas favoritas
 */
const salvarNoLocalStorage = (lista) => {
  localStorage.setItem("user_favoritos", JSON.stringify(lista));
};

// ==================== FUNÇÕES DE SYNC COM FIRESTORE ====================

/**
 * Sincroniza favoritos com o Firestore (cloud)
 * @param {string} uid - ID do usuário
 * @param {Array} lista - Lista de favoritos
 */
const sincronizarComFirestore = async (uid, lista) => {
  if (!uid) return;

  // Estrutura: usuarios/{uid}/favoritos/dados
  const userFavRef = doc(db, "usuarios", uid, "favoritos", "dados");

  try {
    await setDoc(
      userFavRef,
      { lista, atualizadoEm: new Date() },
      { merge: true }, // Merge para não sobrescrever outros dados
    );
  } catch (e) {
    console.error("Erro ao sincronizar favoritos com Firestore:", e);
  }
};

/**
 * Carrega favoritos do Firestore (cloud)
 * @param {string} uid - ID do usuário
 * @returns {Promise<Array|null>} Lista de favoritos ou null se não existir
 */
const carregarDoFirestore = async (uid) => {
  if (!uid) return null;

  const userFavRef = doc(db, "usuarios", uid, "favoritos", "dados");
  const snap = await getDoc(userFavRef);

  if (snap.exists()) {
    return snap.data().lista || [];
  }
  return null;
};

// ==================== API PÚBLICA ====================

/**
 * Obtém a lista de favoritos (com cache)
 * Prioridade: Cache → Firestore → localStorage
 *
 * @returns {Promise<Array>} Lista de IDs de paradas favoritas
 */
export const getFavoritos = async () => {
  const auth = getAuth();
  const user = auth.currentUser;
  const uid = user?.uid;

  // Se houver cache e o usuário não mudou, retorna cache imediatamente
  if (favoritosCache !== null && uidAtual === uid) {
    return favoritosCache;
  }

  let lista = null;

  // Tenta buscar do Firestore (se usuário logado)
  if (uid) {
    lista = await carregarDoFirestore(uid);
  }

  // Fallback para localStorage (se não tiver no Firestore ou usuário não logado)
  if (!lista) {
    lista = carregarDoLocalStorage();
  }

  // Atualiza cache
  favoritosCache = lista;
  uidAtual = uid;

  return lista;
};

/**
 * Adiciona uma parada aos favoritos
 * @param {string} idParada - ID da parada (ex: "anglo")
 * @returns {Promise<Array>} Nova lista de favoritos
 */
export const adicionarFavorito = async (idParada) => {
  const auth = getAuth();
  const user = auth.currentUser;
  const uid = user?.uid;

  let lista = await getFavoritos();

  // Evita duplicatas
  if (lista.includes(idParada)) return lista;

  // Adiciona à lista
  lista = [...lista, idParada];

  // Atualiza cache
  favoritosCache = lista;

  // Persiste localmente
  salvarNoLocalStorage(lista);

  // Sincroniza com cloud (se usuário logado)
  if (uid) {
    await sincronizarComFirestore(uid, lista);
  }

  return lista;
};

/**
 * Remove uma parada dos favoritos
 * @param {string} idParada - ID da parada (ex: "anglo")
 * @returns {Promise<Array>} Nova lista de favoritos
 */
export const removerFavorito = async (idParada) => {
  const auth = getAuth();
  const user = auth.currentUser;
  const uid = user?.uid;

  let lista = await getFavoritos();

  if (!lista.includes(idParada)) return lista;

  // Remove da lista
  lista = lista.filter((id) => id !== idParada);

  // Atualiza cache
  favoritosCache = lista;

  // Persiste localmente
  salvarNoLocalStorage(lista);

  // Sincroniza com cloud (se usuário logado)
  if (uid) {
    await sincronizarComFirestore(uid, lista);
  }

  return lista;
};

/**
 * Alterna o status de favorito (adiciona se não tiver, remove se tiver)
 * @param {string} idParada - ID da parada
 * @returns {Promise<Array>} Nova lista de favoritos
 */
export const toggleFavorito = async (idParada) => {
  const lista = await getFavoritos();
  if (lista.includes(idParada)) {
    return await removerFavorito(idParada);
  } else {
    return await adicionarFavorito(idParada);
  }
};

/**
 * Obtém favoritos de forma SÍNCRONA (usa cache ou localStorage)
 * Útil para componentes que precisam ler rápido
 *
 * @returns {Array} Lista de favoritos
 */
export const getFavoritosSync = () => {
  if (favoritosCache !== null) return favoritosCache;
  return JSON.parse(localStorage.getItem("user_favoritos") || "[]");
};

/**
 * Limpa o cache de favoritos
 * Útil após logout para evitar dados de usuário anterior
 */
export const limparCacheFavoritos = () => {
  favoritosCache = null;
  uidAtual = null;
};
