// services/transporteService.js
// SERVIÇO DE TRANSPORTE - Gerencia viagens, rastreamento e aprendizado de rotas

import { db } from "./firebase";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  collection,
  getDocs,
  runTransaction,
} from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";

// ==================== CONSTANTES ====================

// Raio de detecção de parada (em metros)
const RAIO_CHECKIN_METROS_PADRAO = 40; // 40 metros para paradas normais
const RAIO_CHECKIN_CONFLITO = 20; // 20 metros para paradas conflitantes

// Paradas que têm conflito de localização (ex: CCHS e FaUrb são próximas)
const PARADAS_CONFLITANTES = ["cchs", "faurb"];

// Timeout para heartbeat (não usado atualmente, mas mantido para referência)
const HEARTBEAT_TIMEOUT_MS = 120000; // 2 minutos

// ==================== CACHE DE COORDENADAS ====================

/**
 * Cache em memória das coordenadas das paradas
 * Evita múltiplas leituras do Firestore para a mesma parada
 * Map: chave = nome da parada, valor = { lat, lng }
 */
const coordsCache = new Map();

/**
 * Busca coordenadas de uma parada (com cache)
 * @param {string} paradaId - ID da parada (ex: "anglo")
 * @returns {Promise<{lat: number, lng: number}>} Coordenadas normalizadas
 */
const getCoordsFromCache = async (paradaId) => {
  // Verifica se já está no cache
  if (coordsCache.has(paradaId)) return coordsCache.get(paradaId);

  // Busca no Firestore
  const ref = doc(db, "paradas", paradaId);
  const snap = await getDoc(ref);
  if (!snap.exists() || !snap.data().location) return null;

  const loc = snap.data().location;
  let lat = Number(loc.latitude || loc._lat);
  let lng = Number(loc.longitude || loc._long);

  // Normaliza coordenadas (Pelotas: latitudes e longitudes negativas)
  const coords = {
    lat: lat > 0 ? lat * -1 : lat,
    lng: lng > 0 ? lng * -1 : lng,
  };

  coordsCache.set(paradaId, coords);
  return coords;
};

// ==================== APRENDIZADO DE ROTAS ====================

/**
 * Salva o tempo gasto em um trecho (aprendizado coletivo)
 * Usa média ponderada para calcular o tempo médio
 *
 * @param {Object} params - Parâmetros do trecho
 * @param {string} params.itinerarioId - ID do itinerário
 * @param {string} params.paradaA - Parada de origem
 * @param {string} params.paradaB - Parada de destino
 * @param {number} params.tempoGastoSegundos - Tempo que o usuário levou
 */
export const salvarTempoTrecho = async ({
  itinerarioId,
  paradaA,
  paradaB,
  tempoGastoSegundos,
}) => {
  // Validações básicas
  if (
    !itinerarioId ||
    !paradaA ||
    !paradaB ||
    !tempoGastoSegundos ||
    tempoGastoSegundos < 5 // Ignora tempos menores que 5 segundos (ruído)
  )
    return;

  const chave = `${itinerarioId}_${paradaA}-${paradaB}`;
  const rotaRef = doc(db, "rotas_aprendidas", chave);

  // Usa transação para evitar condições de corrida
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(rotaRef);

    if (!snap.exists()) {
      // Primeira amostra para este trecho
      transaction.set(rotaRef, {
        itinerarioId,
        paradaA,
        paradaB,
        tempoMedioSegundos: tempoGastoSegundos,
        totalAmostras: 1,
        ultimaAtualizacao: serverTimestamp(),
      });
      return;
    }

    // Atualiza média ponderada existente
    const dados = snap.data();
    const totalAmostras = (dados.totalAmostras || 0) + 1;
    const tempoMedioAtual = dados.tempoMedioSegundos || 180;

    // Fórmula da média ponderada:
    // novaMédia = (médiaAtual * (n-1) + novoValor) / n
    const novoTempoMedio = Math.round(
      (tempoMedioAtual * (totalAmostras - 1) + tempoGastoSegundos) /
        totalAmostras,
    );

    transaction.update(rotaRef, {
      tempoMedioSegundos: novoTempoMedio,
      totalAmostras,
      ultimaAtualizacao: serverTimestamp(),
    });
  });
};

// ==================== GERENCIAMENTO DE VIAGEM ====================

/**
 * Registra um usuário em uma viagem ativa
 * Define o papel do usuário: rastreador, reserva_prioritaria ou passageiro
 *
 * @returns {Promise<string>} Papel atribuído: "rastreador", "reserva_prioritaria", "passageiro", ou "bloqueado"
 */
export const entrarNaViagem = async (
  linha, // ID do itinerário (ex: "anglo")
  horario, // Horário de saída (ex: "07:30")
  usuario, // Objeto do Firebase Auth
  paradaOrigem, // Onde o usuário vai embarcar
  paradaDestino, // Onde o usuário vai desembarcar
  itinerarioCompleto, // Dados completos do itinerário
) => {
  // ID único da viagem = "linha_horario" (ex: "anglo_0730")
  const viagemId = `${linha.toLowerCase().trim()}_${horario.replace(":", "")}`;
  const viagemRef = doc(db, "viagens_ativas", viagemId);
  const userRef = doc(db, "usuarios", usuario.uid);

  // Verifica se usuário já está em outra viagem (bloqueia)
  const userSnap = await getDoc(userRef);
  if (
    userSnap.exists() &&
    userSnap.data().viagemAtualId &&
    userSnap.data().viagemAtualId !== viagemId
  )
    return "bloqueado";

  // Normaliza lista de paradas
  const paradasLista = itinerarioCompleto.paradas.map((p) =>
    (typeof p === "object" ? p.nome : p).toLowerCase().trim(),
  );

  // Índice do destino do usuário (quanto mais longe, maior o índice)
  const ordemDestino = paradasLista.indexOf(paradaDestino.toLowerCase().trim());

  // Objeto do passageiro
  const novoPassageiro = {
    uid: usuario.uid,
    nome: usuario.displayName || "Estudante",
    origem: paradaOrigem,
    destino: paradaDestino,
    ordemDestino, // Quanto maior, mais prioridade
    timestamp: new Date(),
  };

  let papel;

  // Transação para evitar condições de corrida
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(viagemRef);

    if (!snap.exists()) {
      // PRIMEIRA VIAGEM: usuário vira RASTREADOR
      transaction.set(viagemRef, {
        linha,
        horarioSaida: horario,
        rastreadorAtual: novoPassageiro, // 👑 Rastreador principal
        proximoRastreador: null, // 👤 Sem reserva ainda
        ultimaParada: paradaOrigem,
        paradaAtual: paradaOrigem,
        indiceParada: paradasLista.indexOf(paradaOrigem.toLowerCase().trim()),
        ultimoHeartbeat: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });
      papel = "rastreador";
    } else {
      // VIAGEM JÁ EXISTE: decide papel baseado na distância do destino
      const viagemDados = snap.data();
      const ordemRastreadorAtual =
        viagemDados.rastreadorAtual?.ordemDestino ?? 0;
      const ordemProximo = viagemDados.proximoRastreador?.ordemDestino ?? 0;

      if (ordemDestino > ordemRastreadorAtual) {
        // Este usuário vai para MAIS LONGE que o rastreador atual
        if (ordemDestino > ordemProximo) {
          // Torna-se o PRÓXIMO rastreador (reserva prioritária)
          transaction.update(viagemRef, {
            proximoRastreador: novoPassageiro,
            atualizadoEm: serverTimestamp(),
          });
        }
        papel = "reserva_prioritaria"; // ⏳ Será o próximo rastreador
      } else {
        papel = "passageiro"; // 🧑 Apenas acompanha
      }
    }
  });

  // Atualiza o documento do usuário com a viagem atual
  await setDoc(userRef, { viagemAtualId: viagemId }, { merge: true });

  return papel;
};

// ==================== DETECÇÃO AUTOMÁTICA DE PARADAS ====================

/**
 * Verifica se o ônibus está próximo de uma parada e atualiza no Firestore
 * Chamado pelo rastreador a cada atualização de GPS
 *
 * @returns {Promise<{indiceDetectado: number, paradaDetectada: string}>}
 */
export const verificarEAtualizarParadaAutomatica = async (
  viagemId,
  lat,
  lng,
  itinerario,
  paradasData,
  isRastreador = true,
) => {
  const viagemRef = doc(db, "viagens_ativas", viagemId);
  const paradasLista = itinerario.paradas.map((p) =>
    (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
  );

  let paradaDetectada = null;
  let indiceDetectado = -1;

  // Itera sobre as paradas do itinerário
  for (let i = 0; i < paradasLista.length; i++) {
    const info = paradasData[paradasLista[i]];
    if (!info?.location) continue;

    // Obtém coordenadas da parada
    let latP = Number(info.location.latitude || info.location._lat);
    let lngP = Number(info.location.longitude || info.location._long);
    latP = latP > 0 ? latP * -1 : latP;
    lngP = lngP > 0 ? lngP * -1 : lngP;

    // Calcula distância da posição atual até a parada
    const dist = calculateDistance(lat, lng, latP, lngP);

    // Define raio (paradas conflitantes usam raio menor)
    let raioUsar = RAIO_CHECKIN_METROS_PADRAO; // 40m
    if (isRastreador && PARADAS_CONFLITANTES.includes(paradasLista[i])) {
      raioUsar = RAIO_CHECKIN_CONFLITO; // 20m
    }

    if (dist <= raioUsar) {
      paradaDetectada = paradasLista[i];
      indiceDetectado = i;
      break; // Encontrou a parada mais próxima
    }
  }

  // Se detectou uma parada, atualiza no Firestore
  if (paradaDetectada && indiceDetectado !== -1) {
    try {
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(viagemRef);
        if (!sfDoc.exists()) return;

        const dadosAtuais = sfDoc.data();
        const indiceNoBanco = dadosAtuais.indiceParada ?? -1;

        // Só atualiza se a parada detectada é MAIS AVANÇADA que a atual
        if (indiceDetectado > indiceNoBanco) {
          transaction.update(viagemRef, {
            paradaAtual: paradaDetectada,
            ultimaParada: paradaDetectada,
            indiceParada: indiceDetectado,
            atualizadoEm: serverTimestamp(),
          });
        }
      });
      return { indiceDetectado, paradaDetectada };
    } catch (e) {
      console.error("[GPS] Erro na transação de avanço:", e);
    }
  }

  return null;
};

// ==================== FUNÇÃO LEGADA ====================

/**
 * Carrega rotas aprendidas para um itinerário
 * NOTA: Esta função é mantida para compatibilidade, mas não é mais usada
 * Os dados de tempo são carregados diretamente no MainPage
 *
 * @deprecated Use o carregamento direto no MainPage
 */
export const carregarRotasAprendidas = async (itinerarioId) => {
  try {
    const resultado = {};
    const snap = await getDocs(collection(db, "rotas_aprendidas"));
    snap.docs.forEach((d) => {
      if (d.id.startsWith(itinerarioId + "_"))
        resultado[d.id] = {
          tempoMedio: d.data().tempoMedioSegundos || 180,
          totalAmostras: d.data().totalAmostras || 0,
        };
    });
    return resultado;
  } catch (e) {
    return {};
  }
};
