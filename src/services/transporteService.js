// services/transporteService.js
import { db } from "./firebase";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  collection,
  getDocs,
  runTransaction,
} from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";

const RAIO_CHECKIN_METROS_PADRAO = 40;
const RAIO_CHECKIN_CONFLITO = 20;
const PARADAS_CONFLITANTES = ["cchs", "faurb"];
const HEARTBEAT_TIMEOUT_MS = 120000;

const coordsCache = new Map();
const getCoordsFromCache = async (paradaId) => {
  if (coordsCache.has(paradaId)) return coordsCache.get(paradaId);
  const ref = doc(db, "paradas", paradaId);
  const snap = await getDoc(ref);
  if (!snap.exists() || !snap.data().location) return null;
  const loc = snap.data().location;
  let lat = Number(loc.latitude || loc._lat),
    lng = Number(loc.longitude || loc._long);
  const coords = {
    lat: lat > 0 ? lat * -1 : lat,
    lng: lng > 0 ? lng * -1 : lng,
  };
  coordsCache.set(paradaId, coords);
  return coords;
};

export const salvarTempoTrecho = async ({
  itinerarioId,
  paradaA,
  paradaB,
  tempoGastoSegundos,
}) => {
  if (
    !itinerarioId ||
    !paradaA ||
    !paradaB ||
    !tempoGastoSegundos ||
    tempoGastoSegundos < 5
  )
    return;
  const chave = `${itinerarioId}_${paradaA}-${paradaB}`;
  const rotaRef = doc(db, "rotas_aprendidas", chave);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(rotaRef);
    if (!snap.exists()) {
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
    const dados = snap.data();
    const totalAmostras = (dados.totalAmostras || 0) + 1;
    const tempoMedioAtual = dados.tempoMedioSegundos || 180;
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

export const entrarNaViagem = async (
  linha,
  horario,
  usuario,
  paradaOrigem,
  paradaDestino,
  itinerarioCompleto,
) => {
  const viagemId = `${linha.toLowerCase().trim()}_${horario.replace(":", "")}`;
  const viagemRef = doc(db, "viagens_ativas", viagemId);
  const userRef = doc(db, "usuarios", usuario.uid);
  const userSnap = await getDoc(userRef);
  if (
    userSnap.exists() &&
    userSnap.data().viagemAtualId &&
    userSnap.data().viagemAtualId !== viagemId
  )
    return "bloqueado";
  const paradasLista = itinerarioCompleto.paradas.map((p) =>
    (typeof p === "object" ? p.nome : p).toLowerCase().trim(),
  );
  const ordemDestino = paradasLista.indexOf(paradaDestino.toLowerCase().trim());
  const novoPassageiro = {
    uid: usuario.uid,
    nome: usuario.displayName || "Estudante",
    origem: paradaOrigem,
    destino: paradaDestino,
    ordemDestino,
    timestamp: new Date(),
  };
  let papel;
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(viagemRef);
    if (!snap.exists()) {
      transaction.set(viagemRef, {
        linha,
        horarioSaida: horario,
        rastreadorAtual: novoPassageiro,
        proximoRastreador: null,
        ultimaParada: paradaOrigem,
        paradaAtual: paradaOrigem,
        indiceParada: paradasLista.indexOf(paradaOrigem.toLowerCase().trim()),
        ultimoHeartbeat: serverTimestamp(),
        atualizadoEm: serverTimestamp(),
      });
      papel = "rastreador";
    } else {
      const viagemDados = snap.data();
      const ordemRastreadorAtual =
        viagemDados.rastreadorAtual?.ordemDestino ?? 0;
      const ordemProximo = viagemDados.proximoRastreador?.ordemDestino ?? 0;
      if (ordemDestino > ordemRastreadorAtual) {
        if (ordemDestino > ordemProximo)
          transaction.update(viagemRef, {
            proximoRastreador: novoPassageiro,
            atualizadoEm: serverTimestamp(),
          });
        papel = "reserva_prioritaria";
      } else papel = "passageiro";
    }
  });
  await setDoc(userRef, { viagemAtualId: viagemId }, { merge: true });
  return papel;
};

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
  let paradaDetectada = null,
    indiceDetectado = -1;
  for (let i = 0; i < paradasLista.length; i++) {
    const info = paradasData[paradasLista[i]];
    if (!info?.location) continue;
    let latP = Number(info.location.latitude || info.location._lat),
      lngP = Number(info.location.longitude || info.location._long);
    latP = latP > 0 ? latP * -1 : latP;
    lngP = lngP > 0 ? lngP * -1 : lngP;
    const dist = calculateDistance(lat, lng, latP, lngP);
    let raioUsar = RAIO_CHECKIN_METROS_PADRAO;
    if (isRastreador && PARADAS_CONFLITANTES.includes(paradasLista[i]))
      raioUsar = RAIO_CHECKIN_CONFLITO;
    if (dist <= raioUsar) {
      paradaDetectada = paradasLista[i];
      indiceDetectado = i;
      break;
    }
  }
  if (paradaDetectada && indiceDetectado !== -1) {
    try {
      await runTransaction(db, async (transaction) => {
        const sfDoc = await transaction.get(viagemRef);
        if (!sfDoc.exists()) return;
        const dadosAtuais = sfDoc.data();
        const indiceNoBanco = dadosAtuais.indiceParada ?? -1;
        if (indiceDetectado > indiceNoBanco)
          transaction.update(viagemRef, {
            paradaAtual: paradaDetectada,
            ultimaParada: paradaDetectada,
            indiceParada: indiceDetectado,
            atualizadoEm: serverTimestamp(),
          });
      });
      return { indiceDetectado, paradaDetectada };
    } catch (e) {
      console.error("[GPS] Erro na transação de avanço:", e);
    }
  }
  return null;
};

// Removida a função carregarRotasAprendidas (ou mantida mas sem uso)
// A função abaixo é apenas para compatibilidade, mas não deve ser usada diretamente
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
