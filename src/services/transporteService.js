import { db } from "./firebase";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";

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

  const snap = await getDoc(viagemRef);
  const dadosParadaDestino = itinerarioCompleto.paradas.find(
    (p) => p.nome === paradaDestino,
  );

  const novoPassageiro = {
    uid: usuario.uid,
    nome: usuario.displayName || "Estudante",
    origem: paradaOrigem,
    destino: paradaDestino,
    ordemDestino: dadosParadaDestino?.ordem || 0,
    timestamp: new Date(),
  };

  if (!snap.exists()) {
    // Se for o primeiro, vira rastreador oficial
    await setDoc(viagemRef, {
      linha,
      horarioSaida: horario,
      rastreadorAtual: novoPassageiro,
      lotacao: "razoavel",
      paradaAtual: paradaOrigem,
      ultimaAtualizacao: serverTimestamp(),
    });
    return "rastreador";
  } else {
    const viagemDados = snap.data();
    // Se o novo passageiro vai mais longe que o rastreador atual, vira o próximo da fila
    if (
      novoPassageiro.ordemDestino >
      (viagemDados.rastreadorAtual?.ordemDestino || 0)
    ) {
      await updateDoc(viagemRef, {
        proximoRastreador: novoPassageiro,
      });
      return "reserva_prioritaria";
    }
    return "passageiro";
  }
};

export const atualizarParadaPorGPS = async (
  viagemId,
  userLat,
  userLng,
  itinerario,
  paradasGeograficas,
  lotacaoAtual,
) => {
  let paradaMaisProxima = null;
  let menorDistancia = 50; // metros

  itinerario.paradas.forEach((pItinerario) => {
    const geo = paradasGeograficas.find((g) => g.nome === pItinerario.nome);
    if (geo) {
      const dist = calculateDistance(
        userLat,
        userLng,
        geo.location.latitude,
        geo.location.longitude,
      );
      if (dist < menorDistancia) {
        menorDistancia = dist;
        paradaMaisProxima = geo.nome;
      }
    }
  });

  if (paradaMaisProxima) {
    const viagemRef = doc(db, "viagens_ativas", viagemId);
    await updateDoc(viagemRef, {
      paradaAtual: paradaMaisProxima,
      lotacao: lotacaoAtual,
      ultimaAtualizacao: serverTimestamp(),
    });
  }
};

export const alternarFavorito = async (userId, nomeParada) => {
  const userRef = doc(db, "usuarios", userId);
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
