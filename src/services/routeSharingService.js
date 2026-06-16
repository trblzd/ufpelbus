// services/routeSharingService.js
// SERVIÇO DE COMPARTILHAMENTO DE ROTAS
// Permite reutilizar geometrias de rotas entre diferentes itinerários

import { db } from "./firebase";
import { collection, getDocs, doc } from "firebase/firestore";

// ==================== FUNÇÕES DE BUSCA ====================

/**
 * Busca TODOS os trechos existentes no Firestore
 * Usado no editor de rotas para mostrar trechos disponíveis para importação
 *
 * @returns {Promise<Array>} Lista de trechos com geometria, paradas, etc.
 */
export async function buscarTodosTrechosExistentes() {
  try {
    // Busca TODOS os documentos da coleção "rotas_geometricas"
    const snapshot = await getDocs(collection(db, "rotas_geometricas"));
    const trechos = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      // Filtra apenas trechos que têm geometria válida (pelo menos 2 pontos)
      if (data.geometria && data.geometria.length >= 2) {
        trechos.push({
          id: doc.id, // ID do documento (ex: "anglo_capao-centro")
          ...data, // Spread dos dados (paradaA, paradaB, geometria, etc.)
        });
      }
    });

    return trechos;
  } catch (error) {
    console.error("Erro ao buscar trechos:", error);
    return []; // Retorna array vazio em caso de erro
  }
}

/**
 * Busca trechos por paradas ESPECÍFICAS (independente do itinerário)
 * Útil quando você quer encontrar rotas que ligam duas paradas específicas
 *
 * Exemplo: buscarTrechosPorParadas("anglo", "centro")
 * Retorna todos os trechos que vão do Anglo ao Centro, de qualquer linha
 *
 * @param {string} paradaA - Nome da parada de origem
 * @param {string} paradaB - Nome da parada de destino
 * @returns {Promise<Array>} Lista de trechos que conectam estas paradas
 */
export async function buscarTrechosPorParadas(paradaA, paradaB) {
  try {
    const snapshot = await getDocs(collection(db, "rotas_geometricas"));
    const trechos = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      // Verifica se as paradas correspondem EXATAMENTE
      if (data.paradaA === paradaA && data.paradaB === paradaB) {
        if (data.geometria && data.geometria.length >= 2) {
          trechos.push({
            id: doc.id,
            itinerarioId: data.itinerarioId, // De qual itinerário veio
            geometria: data.geometria, // Pontos da rota
            distanciaMetros: data.distanciaMetros, // Distância total
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
 * Busca trechos SIMILARES (mesmo sentido ou inverso)
 * Usado para sugestões de rotas alternativas
 *
 * Exemplo: Se você tem "anglo" -> "centro", também encontra "centro" -> "anglo"
 *
 * @param {string} paradaA - Nome da parada A
 * @param {string} paradaB - Nome da parada B
 * @returns {Promise<Array>} Lista de trechos similares (qualquer direção)
 */
export async function buscarTrechosSimilares(paradaA, paradaB) {
  const todos = await buscarTodosTrechosExistentes();

  // Filtra trechos que conectam as duas paradas em QUALQUER direção
  const similares = todos.filter(
    (trecho) =>
      (trecho.paradaA === paradaA && trecho.paradaB === paradaB) || // Mesmo sentido
      (trecho.paradaA === paradaB && trecho.paradaB === paradaA), // Sentido oposto
  );

  return similares;
}

/**
 * Busca trechos por ITINERÁRIO específico
 * Retorna todas as geometrias de rota de um determinado itinerário
 *
 * @param {string} itinerarioId - ID do itinerário (ex: "anglo")
 * @returns {Promise<Array>} Lista de trechos do itinerário
 */
export async function buscarTrechosPorItinerario(itinerarioId) {
  try {
    const snapshot = await getDocs(collection(db, "rotas_geometricas"));
    const trechos = [];

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      // Verifica se o trecho pertence ao itinerário solicitado
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
