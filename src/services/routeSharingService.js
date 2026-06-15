// services/routeSharingService.js
import { db } from "./firebase";
import {
  collection,
  getDocs,
  query,
  where,
  getDoc,
  doc,
} from "firebase/firestore";

/**
 * Busca todos os trechos existentes no Firestore
 */
export async function buscarTodosTrechosExistentes() {
  try {
    const snapshot = await getDocs(collection(db, "rotas_geometricas"));
    const trechos = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.geometria && data.geometria.length >= 2) {
        trechos.push({
          id: doc.id,
          ...data,
        });
      }
    });

    return trechos;
  } catch (error) {
    console.error("Erro ao buscar trechos:", error);
    return [];
  }
}

/**
 * Busca trechos por paradas específicas (independente do itinerário)
 */
export async function buscarTrechosPorParadas(paradaA, paradaB) {
  try {
    // Busca qualquer documento que termine com paradaA-paradaB
    const snapshot = await getDocs(collection(db, "rotas_geometricas"));
    const trechos = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (data.paradaA === paradaA && data.paradaB === paradaB) {
        if (data.geometria && data.geometria.length >= 2) {
          trechos.push({
            id: doc.id,
            itinerarioId: data.itinerarioId,
            geometria: data.geometria,
            distanciaMetros: data.distanciaMetros,
          });
        }
      }
    });

    return trechos;
  } catch (error) {
    console.error("Erro ao buscar trechos por paradas:", error);
    return [];
  }
}

/**
 * Busca trechos similares (com mesmo sentido, pode ser usado para sugestão)
 */
export async function buscarTrechosSimilares(paradaA, paradaB) {
  const todos = await buscarTodosTrechosExistentes();

  // Filtra trechos que começam com paradaA e terminam com paradaB
  // ou vice-versa (considerando sentido)
  const similares = todos.filter(
    (trecho) =>
      (trecho.paradaA === paradaA && trecho.paradaB === paradaB) ||
      (trecho.paradaA === paradaB && trecho.paradaB === paradaA),
  );

  return similares;
}

/**
 * Busca trechos por itinerário específico
 */
export async function buscarTrechosPorItinerario(itinerarioId) {
  try {
    const snapshot = await getDocs(collection(db, "rotas_geometricas"));
    const trechos = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      if (
        data.itinerarioId === itinerarioId &&
        data.geometria &&
        data.geometria.length >= 2
      ) {
        trechos.push({
          id: doc.id,
          paradaA: data.paradaA,
          paradaB: data.paradaB,
          geometria: data.geometria,
        });
      }
    });

    return trechos;
  } catch (error) {
    console.error("Erro ao buscar trechos por itinerário:", error);
    return [];
  }
}
