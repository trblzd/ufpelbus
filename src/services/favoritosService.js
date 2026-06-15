// services/favoritosService.js
import { db } from "./firebase";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";

let favoritosCache = null;
let uidAtual = null;

const carregarDoLocalStorage = () => {
  return JSON.parse(localStorage.getItem("user_favoritos") || "[]");
};

const salvarNoLocalStorage = (lista) => {
  localStorage.setItem("user_favoritos", JSON.stringify(lista));
};

const sincronizarComFirestore = async (uid, lista) => {
  if (!uid) return;
  const userFavRef = doc(db, "usuarios", uid, "favoritos", "dados");
  try {
    await setDoc(
      userFavRef,
      { lista, atualizadoEm: new Date() },
      { merge: true },
    );
  } catch (e) {
    console.error("Erro ao sincronizar favoritos com Firestore:", e);
  }
};

const carregarDoFirestore = async (uid) => {
  if (!uid) return null;
  const userFavRef = doc(db, "usuarios", uid, "favoritos", "dados");
  const snap = await getDoc(userFavRef);
  if (snap.exists()) {
    return snap.data().lista || [];
  }
  return null;
};

export const getFavoritos = async () => {
  const auth = getAuth();
  const user = auth.currentUser;
  const uid = user?.uid;

  // Se houver cache e uid não mudou, retorna cache
  if (favoritosCache !== null && uidAtual === uid) {
    return favoritosCache;
  }

  let lista = null;
  if (uid) {
    lista = await carregarDoFirestore(uid);
  }
  if (!lista) {
    lista = carregarDoLocalStorage();
  }
  favoritosCache = lista;
  uidAtual = uid;
  return lista;
};

export const adicionarFavorito = async (idParada) => {
  const auth = getAuth();
  const user = auth.currentUser;
  const uid = user?.uid;
  let lista = await getFavoritos();
  if (lista.includes(idParada)) return lista;
  lista = [...lista, idParada];
  favoritosCache = lista;
  salvarNoLocalStorage(lista);
  if (uid) {
    await sincronizarComFirestore(uid, lista);
  }
  return lista;
};

export const removerFavorito = async (idParada) => {
  const auth = getAuth();
  const user = auth.currentUser;
  const uid = user?.uid;
  let lista = await getFavoritos();
  if (!lista.includes(idParada)) return lista;
  lista = lista.filter((id) => id !== idParada);
  favoritosCache = lista;
  salvarNoLocalStorage(lista);
  if (uid) {
    await sincronizarComFirestore(uid, lista);
  }
  return lista;
};

export const toggleFavorito = async (idParada) => {
  const lista = await getFavoritos();
  if (lista.includes(idParada)) {
    return await removerFavorito(idParada);
  } else {
    return await adicionarFavorito(idParada);
  }
};

// Para uso síncrono em componentes que precisam ler rápido (com cache)
export const getFavoritosSync = () => {
  if (favoritosCache !== null) return favoritosCache;
  return JSON.parse(localStorage.getItem("user_favoritos") || "[]");
};

// Limpa cache (útil após logout)
export const limparCacheFavoritos = () => {
  favoritosCache = null;
  uidAtual = null;
};
