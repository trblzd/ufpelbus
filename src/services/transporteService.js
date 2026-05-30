// services/transporteService.js
//
// Serviço central de lógica de viagens.
// Inclui:
//  - entrarNaViagem         → embarque com bloqueio de viagem simultânea
//  - salvarPontoRastreamento → contribuição para roteirização aprendida
//  - atualizarParadaPorGPS  → atualização da parada atual via GPS (legada, mantida)
//  - alternarFavorito       → toggle de parada favorita

import { db } from "./firebase";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  collection,
  getDocs,
} from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";

// ─── Constantes ──────────────────────────────────────────────────────────────
const RAIO_CLUSTER_METROS = 5; // Pontos a menos de 5m são agrupados (média ponderada)

// ─── entrarNaViagem ───────────────────────────────────────────────────────────
// Embarque de um passageiro na viagem.
//
// Regras:
//  1. Bloqueia se o usuário já tiver uma viagemAtualId ativa no Firestore.
//  2. Se for o primeiro passageiro → vira rastreador.
//  3. Se for mais longe que o rastreador atual → vira próximo rastreador (fila).
//  4. Caso contrário → passageiro comum (sem rastreamento GPS).
//
// Retorna: 'rastreador' | 'reserva_prioritaria' | 'passageiro' | 'bloqueado'
export const entrarNaViagem = async (
  linha,
  horario,
  usuario,
  paradaOrigem,
  paradaDestino,
  itinerarioCompleto,
) => {
  const viagemId  = `${linha.toLowerCase().trim()}_${horario.replace(":", "")}`;
  const viagemRef = doc(db, "viagens_ativas", viagemId);
  const userRef   = doc(db, "usuarios", usuario.uid);

  // ── 1. Verifica se o usuário já está em outra viagem ────────────────────
  let userSnap;
  try {
    userSnap = await getDoc(userRef);
  } catch {
    userSnap = null;
  }

  if (userSnap?.exists()) {
    const viagemAtualId = userSnap.data().viagemAtualId;
    if (viagemAtualId && viagemAtualId !== viagemId) {
      // Usuário já está em outra viagem ativa — bloqueia
      console.warn("[entrarNaViagem] Usuário já está em outra viagem:", viagemAtualId);
      return "bloqueado";
    }
  }

  // ── 2. Busca dados da parada de destino para saber a ordem ──────────────
  const dadosParadaDestino = itinerarioCompleto.paradas.find((p) =>
    (typeof p === "object" ? p.nome : p).toLowerCase().trim() ===
    paradaDestino.toLowerCase().trim()
  );

  const novoPassageiro = {
    uid:           usuario.uid,
    nome:          usuario.displayName || "Estudante",
    origem:        paradaOrigem,
    destino:       paradaDestino,
    ordemDestino:  dadosParadaDestino?.ordem ?? 0,
    timestamp:     new Date(),
  };

  const snap = await getDoc(viagemRef);

  let papel;

  if (!snap.exists()) {
    // ── Primeiro passageiro: cria a viagem e vira rastreador ──────────────
    await setDoc(viagemRef, {
      linha,
      horarioSaida:    horario,
      rastreadorAtual: novoPassageiro,
      proximoRastreador: null,
      ultimaParada:    paradaOrigem,
      indiceParada:    itinerarioCompleto.paradas
        .map((p) => (typeof p === "object" ? p.nome : p).toLowerCase().trim())
        .indexOf(paradaOrigem.toLowerCase().trim()),
      atualizadoEm:    serverTimestamp(),
    });
    papel = "rastreador";

  } else {
    const viagemDados = snap.data();
    const ordemRastreadorAtual = viagemDados.rastreadorAtual?.ordemDestino ?? 0;
    const ordemProximo         = viagemDados.proximoRastreador?.ordemDestino ?? 0;

    if (novoPassageiro.ordemDestino > ordemRastreadorAtual) {
      // ── Vai mais longe que o rastreador atual ─────────────────────────
      if (novoPassageiro.ordemDestino > ordemProximo) {
        // É o candidato a próximo mais qualificado
        await updateDoc(viagemRef, {
          proximoRastreador: novoPassageiro,
          atualizadoEm:      serverTimestamp(),
        });
      }
      papel = "reserva_prioritaria";
    } else {
      papel = "passageiro";
    }
  }

  // ── 3. Marca o usuário como em viagem ativa no seu documento ────────────
  try {
    await setDoc(userRef, { viagemAtualId: viagemId }, { merge: true });
  } catch (e) {
    console.error("[entrarNaViagem] Erro ao marcar usuário em viagem:", e);
  }

  return papel;
};

// ─── salvarPontoRastreamento ──────────────────────────────────────────────────
// Salva (ou atualiza) um ponto GPS no documento de rota aprendida do trecho.
//
// Estrutura do documento em rotas_aprendidas/{itinerarioId}_{paradaA}-{paradaB}:
//   pontos: [
//     { lat: number, lng: number, contagem: number },
//     ...
//   ]
//   totalContribuicoes: number
//   atualizadoEm: timestamp
//
// Algoritmo de clustering:
//   - Se já existir um ponto a menos de RAIO_CLUSTER_METROS → incrementa contagem
//     e atualiza a posição para a média ponderada (mais preciso com mais dados).
//   - Caso contrário → adiciona como novo ponto.
//
// Nota: Usa getDoc + setDoc em vez de arrayUnion pois precisamos checar
//       proximidade entre os pontos existentes, o que não é possível com
//       operações atômicas simples do Firestore.
export const salvarPontoRastreamento = async (
  itinerarioId,
  idParadaA,
  idParadaB,
  lat,
  lng,
) => {
  const chave    = `${itinerarioId}_${idParadaA}-${idParadaB}`;
  const rotaRef  = doc(db, "rotas_aprendidas", chave);
  const snap     = await getDoc(rotaRef);

  // Normaliza coords para Sul/Oeste (negativo) — consistência com geoUtils
  const nLat = lat > 0 ? lat * -1 : lat;
  const nLng = lng > 0 ? lng * -1 : lng;

  if (!snap.exists()) {
    // Primeiro ponto deste trecho
    await setDoc(rotaRef, {
      itinerarioId,
      paradaA:            idParadaA,
      paradaB:            idParadaB,
      pontos:             [{ lat: nLat, lng: nLng, contagem: 1 }],
      totalContribuicoes: 1,
      atualizadoEm:       serverTimestamp(),
    });
    return;
  }

  const dados  = snap.data();
  const pontos = dados.pontos || [];

  // Verifica se existe ponto próximo (clustering)
  let encontrouVizinho = false;
  const pontosAtualizados = pontos.map((p) => {
    if (encontrouVizinho) return p;
    const dist = calculateDistance(p.lat, p.lng, nLat, nLng);
    if (dist <= RAIO_CLUSTER_METROS) {
      encontrouVizinho = true;
      const novaContagem = p.contagem + 1;
      // Média ponderada: posição se move levemente em direção ao novo dado
      return {
        lat:      (p.lat * p.contagem + nLat) / novaContagem,
        lng:      (p.lng * p.contagem + nLng) / novaContagem,
        contagem: novaContagem,
      };
    }
    return p;
  });

  if (!encontrouVizinho) {
    pontosAtualizados.push({ lat: nLat, lng: nLng, contagem: 1 });
  }

  // Ordena os pontos pelo progresso na rota para garantir polilinha consistente.
  // Usa a distância acumulada a partir do primeiro ponto como proxy de ordem.
  const pontosOrdenados = ordenarPontosNaRota(pontosAtualizados);

  await setDoc(rotaRef, {
    itinerarioId,
    paradaA:            idParadaA,
    paradaB:            idParadaB,
    pontos:             pontosOrdenados,
    totalContribuicoes: (dados.totalContribuicoes || 0) + 1,
    atualizadoEm:       serverTimestamp(),
  });
};

// ─── ordenarPontosNaRota ──────────────────────────────────────────────────────
// Ordena um array de pontos {lat, lng, contagem} pela distância acumulada
// a partir do primeiro ponto (aproximação de ordem ao longo do percurso).
// Isso garante que a Polyline no mapa seja desenhada na direção correta.
const ordenarPontosNaRota = (pontos) => {
  if (pontos.length <= 1) return pontos;

  // Encontra o ponto "âncora" — o com maior contagem (mais confirmado)
  const ancora = pontos.reduce((max, p) => (p.contagem > max.contagem ? p : max), pontos[0]);

  // Ordena pela distância ao âncora (pontos próximos ao início ficam juntos)
  // Essa heurística não é perfeita mas funciona bem para rotas quase lineares
  // como as de ônibus urbano.
  return [...pontos].sort((a, b) =>
    calculateDistance(ancora.lat, ancora.lng, a.lat, a.lng) -
    calculateDistance(ancora.lat, ancora.lng, b.lat, b.lng)
  );
};

// ─── carregarRotasAprendidas ──────────────────────────────────────────────────
// Carrega todas as rotas aprendidas de um itinerário específico.
// Retorna um objeto indexado pela chave do trecho:
//   { "anglofamed_ceiq-cotada": [[lat,lng], [lat,lng], ...], ... }
//
// Deve ser chamado no MainPage ao carregar, para alimentar o renderGradiente.
export const carregarRotasAprendidas = async (itinerarioId) => {
  // Firestore não tem startsWith, então buscamos a coleção toda e filtramos.
  // Dado que rotas_aprendidas terá no máximo algumas dezenas de documentos
  // por itinerário, isso é aceitável.
  try {
    const snap = await getDocs(collection(db, "rotas_aprendidas"));
    const resultado = {};
    snap.docs.forEach((d) => {
      if (d.id.startsWith(itinerarioId + "_")) {
        const dados = d.data();
        // Converte para array de [lat, lng] para uso direto no Leaflet
        resultado[d.id] = (dados.pontos || []).map((p) => [p.lat, p.lng]);
      }
    });
    return resultado;
  } catch (e) {
    console.error("[carregarRotasAprendidas] Erro:", e);
    return {};
  }
};

// ─── atualizarParadaPorGPS ────────────────────────────────────────────────────
// Mantida do código original. Atualiza a parada atual no Firestore
// com base na proximidade GPS do usuário.
export const atualizarParadaPorGPS = async (
  viagemId,
  userLat,
  userLng,
  itinerario,
  paradasGeograficas,
  lotacaoAtual,
) => {
  let paradaMaisProxima = null;
  let menorDistancia    = 50; // metros

  itinerario.paradas.forEach((pItinerario) => {
    const nome = (typeof pItinerario === "object" ? pItinerario.nome : pItinerario).toLowerCase().trim();
    const geo  = paradasGeograficas.find(
      (g) => g.nome.toLowerCase().trim() === nome
    );
    if (geo) {
      const dist = calculateDistance(
        userLat,
        userLng,
        geo.location.latitude,
        geo.location.longitude,
      );
      if (dist < menorDistancia) {
        menorDistancia    = dist;
        paradaMaisProxima = geo.nome;
      }
    }
  });

  if (paradaMaisProxima) {
    const viagemRef = doc(db, "viagens_ativas", viagemId);
    await updateDoc(viagemRef, {
      paradaAtual:  paradaMaisProxima,
      lotacao:      lotacaoAtual,
      atualizadoEm: serverTimestamp(),
    });
  }
};

// ─── alternarFavorito ─────────────────────────────────────────────────────────
// Bug fix aplicado: arrayRemove agora importado corretamente acima.
export const alternarFavorito = async (userId, nomeParada) => {
  const userRef  = doc(db, "usuarios", userId);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    const favoritas = userSnap.data().favoritas || [];
    if (favoritas.includes(nomeParada)) {
      await updateDoc(userRef, { favoritas: arrayRemove(nomeParada) });
      return false; // Removido
    } else {
      await updateDoc(userRef, { favoritas: arrayUnion(nomeParada) });
      return true; // Adicionado
    }
  }
};
