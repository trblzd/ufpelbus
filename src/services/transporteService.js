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

const RAIO_CLUSTER_METROS = 5;
const RAIO_CHECKIN_METROS = 40;

// Cache global para coordenadas de paradas (evita leituras repetidas do Firestore)
const coordsCache = new Map();

const getCoordsFromCache = async (paradaId) => {
  if (coordsCache.has(paradaId)) return coordsCache.get(paradaId);

  const ref = doc(db, "paradas", paradaId);
  const snap = await getDoc(ref);
  if (!snap.exists() || !snap.data().location) return null;

  const loc = snap.data().location;
  let lat = Number(loc.latitude || loc._lat);
  let lng = Number(loc.longitude || loc._long);
  const coords = {
    lat: lat > 0 ? lat * -1 : lat,
    lng: lng > 0 ? lng * -1 : lng,
  };
  coordsCache.set(paradaId, coords);
  return coords;
};

// Função de ordenação por projeção linear (já corrigida)
const ordenarPontosPorProjecaoLinear = (pontos, pontoInicial, pontoFinal) => {
  if (!pontos || pontos.length <= 1) return pontos || [];
  const dx = pontoFinal.lng - pontoInicial.lng;
  const dy = pontoFinal.lat - pontoInicial.lat;
  const comprimento = Math.sqrt(dx * dx + dy * dy);
  if (comprimento === 0) return pontos;
  const ux = dx / comprimento;
  const uy = dy / comprimento;
  const pontosComProj = pontos.map((p) => ({
    ...p,
    proj: (p.lng - pontoInicial.lng) * ux + (p.lat - pontoInicial.lat) * uy,
  }));
  pontosComProj.sort((a, b) => a.proj - b.proj);
  return pontosComProj.map(({ proj, ...rest }) => rest);
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
  if (userSnap.exists()) {
    const viagemAtualId = userSnap.data().viagemAtualId;
    if (viagemAtualId && viagemAtualId !== viagemId) {
      console.warn(
        "[entrarNaViagem] Usuário já está em outra viagem:",
        viagemAtualId,
      );
      return "bloqueado";
    }
  }

  const dadosParadaDestino = itinerarioCompleto.paradas.find(
    (p) =>
      (typeof p === "object" ? p.nome : p).toLowerCase().trim() ===
      paradaDestino.toLowerCase().trim(),
  );

  const novoPassageiro = {
    uid: usuario.uid,
    nome: usuario.displayName || "Estudante",
    origem: paradaOrigem,
    destino: paradaDestino,
    ordemDestino: dadosParadaDestino?.ordem ?? 0,
    timestamp: new Date(),
  };

  let papel;

  try {
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
          indiceParada: itinerarioCompleto.paradas
            .map((p) =>
              (typeof p === "object" ? p.nome : p).toLowerCase().trim(),
            )
            .indexOf(paradaOrigem.toLowerCase().trim()),
          atualizadoEm: serverTimestamp(),
        });
        papel = "rastreador";
      } else {
        const viagemDados = snap.data();
        const ordemRastreadorAtual =
          viagemDados.rastreadorAtual?.ordemDestino ?? 0;
        const ordemProximo = viagemDados.proximoRastreador?.ordemDestino ?? 0;
        if (novoPassageiro.ordemDestino > ordemRastreadorAtual) {
          if (novoPassageiro.ordemDestino > ordemProximo) {
            transaction.update(viagemRef, {
              proximoRastreador: novoPassageiro,
              atualizadoEm: serverTimestamp(),
            });
          }
          papel = "reserva_prioritaria";
        } else {
          papel = "passageiro";
        }
      }
    });
  } catch (e) {
    console.error("[entrarNaViagem] Erro na transaction:", e);
    return "erro";
  }

  try {
    await setDoc(userRef, { viagemAtualId: viagemId }, { merge: true });
  } catch (e) {
    console.error("[entrarNaViagem] Erro ao marcar usuário em viagem:", e);
  }

  return papel;
};

export const salvarPontoETempoRastreamento = async (
  itinerarioId,
  idParadaA,
  idParadaB,
  lat,
  lng,
  tempoGastoSegundos = null,
) => {
  const chave = `${itinerarioId}_${idParadaA}-${idParadaB}`;
  const rotaRef = doc(db, "rotas_aprendidas", chave);
  const snap = await getDoc(rotaRef);

  const nLat = lat > 0 ? lat * -1 : lat;
  const nLng = lng > 0 ? lng * -1 : lng;

  if (!snap.exists()) {
    await setDoc(rotaRef, {
      itinerarioId,
      paradaA: idParadaA,
      paradaB: idParadaB,
      pontos: [{ lat: nLat, lng: nLng, contagem: 1 }],
      totalContribuicoes: 1,
      tempoMedioSegundos: tempoGastoSegundos || 180,
      totalContribuicoesTempo: tempoGastoSegundos ? 1 : 0,
      atualizadoEm: serverTimestamp(),
    });
    return;
  }

  const dados = snap.data();
  const pontos = dados.pontos || [];

  // Clustering
  let encontrouVizinho = false;
  const pontosAtualizados = pontos.map((p) => {
    if (encontrouVizinho) return p;
    const dist = calculateDistance(p.lat, p.lng, nLat, nLng);
    if (dist <= RAIO_CLUSTER_METROS) {
      encontrouVizinho = true;
      const novaContagem = p.contagem + 1;
      return {
        lat: (p.lat * p.contagem + nLat) / novaContagem,
        lng: (p.lng * p.contagem + nLng) / novaContagem,
        contagem: novaContagem,
      };
    }
    return p;
  });

  if (!encontrouVizinho) {
    pontosAtualizados.push({ lat: nLat, lng: nLng, contagem: 1 });
  }

  // OBTÉM COORDENADAS DAS PARADAS VIA CACHE (sem leitura extra do Firestore)
  const pontoInicial = await getCoordsFromCache(idParadaA);
  const pontoFinal = await getCoordsFromCache(idParadaB);

  let pontosOrdenados = pontosAtualizados;
  if (pontoInicial && pontoFinal) {
    pontosOrdenados = ordenarPontosPorProjecaoLinear(
      pontosAtualizados,
      pontoInicial,
      pontoFinal,
    );
  } else {
    console.warn(
      `[salvarPonto] Coordenadas não encontradas para ${idParadaA} ou ${idParadaB}`,
    );
  }

  let novoTempoMedio = dados.tempoMedioSegundos || 180;
  let totalContribuicoesTempo = dados.totalContribuicoesTempo || 0;

  if (tempoGastoSegundos && tempoGastoSegundos > 5) {
    totalContribuicoesTempo += 1;
    novoTempoMedio =
      (novoTempoMedio * (totalContribuicoesTempo - 1) + tempoGastoSegundos) /
      totalContribuicoesTempo;
  }

  await setDoc(rotaRef, {
    itinerarioId,
    paradaA: idParadaA,
    paradaB: idParadaB,
    pontos: pontosOrdenados,
    totalContribuicoes: (dados.totalContribuicoes || 0) + 1,
    tempoMedioSegundos: Math.round(novoTempoMedio),
    totalContribuicoesTempo,
    atualizadoEm: serverTimestamp(),
  });
};

export const verificarEAtualizarParadaAutomatica = async (
  viagemId,
  lat,
  lng,
  itinerario,
  paradasData,
) => {
  const viagemRef = doc(db, "viagens_ativas", viagemId);
  let paradaDetectada = null;
  let indiceDetectado = -1;
  const paradasLista = itinerario.paradas.map((p) =>
    (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
  );

  for (let i = 0; i < paradasLista.length; i++) {
    const nomeParada = paradasLista[i];
    const info = paradasData[nomeParada];
    if (!info?.location) continue;
    let latP = Number(info.location.latitude || info.location._lat);
    let lngP = Number(info.location.longitude || info.location._long);
    latP = latP > 0 ? latP * -1 : latP;
    lngP = lngP > 0 ? lngP * -1 : lngP;
    const dist = calculateDistance(lat, lng, latP, lngP);
    if (dist <= RAIO_CHECKIN_METROS) {
      paradaDetectada = nomeParada;
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
      console.error("[GPS Autocheckin] Erro na transação de avanço:", e);
    }
  }
  return null;
};

export const carregarRotasAprendidas = async (itinerarioId) => {
  try {
    const snap = await getDocs(collection(db, "rotas_aprendidas"));
    const resultado = {};
    snap.docs.forEach((d) => {
      if (d.id.startsWith(itinerarioId + "_")) {
        const dados = d.data();
        resultado[d.id] = {
          coordenadas: (dados.pontos || []).map((p) => [p.lat, p.lng]),
          tempoMedio: dados.tempoMedioSegundos || 180,
        };
      }
    });
    return resultado;
  } catch (e) {
    console.error("[carregarRotasAprendidas] Erro:", e);
    return {};
  }
};

export const alternarFavorito = async (userId, nomeParada) => {
  const userRef = doc(db, "usuarios", userId);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    const favoritas = userSnap.data().favoritas || [];
    if (favoritas.includes(nomeParada)) {
      await updateDoc(userRef, { favoritas: arrayRemove(nomeParada) });
      return false;
    } else {
      await updateDoc(userRef, { favoritas: arrayUnion(nomeParada) });
      return true;
    }
  }
};
