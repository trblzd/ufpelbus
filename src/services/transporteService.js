// services/transporteService.js
import { db } from "./firebase";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp,
  runTransaction,
  collection,
  getDocs,
} from "firebase/firestore";
import { calculateDistance } from "../utils/geoUtils";

// ==================== CONSTANTES ====================
const RAIO_CHECKIN_METROS_PADRAO = 50;
const RAIO_CHECKIN_CONFLITO = 20;
const PARADAS_CONFLITANTES = ["cchs", "faurb"];

// ==================== CACHE DE COORDENADAS ====================
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

// ==================== APRENDIZADO DE ROTAS COM HORÁRIO ====================

/**
 * Retorna a faixa horária para agrupamento
 */
const getFaixaHoraria = (hora) => {
  if (hora >= 0 && hora <= 5) return "MADRUGADA";
  if (hora >= 6 && hora <= 11) return "MANHA";
  if (hora >= 12 && hora <= 17) return "TARDE";
  return "NOITE";
};

/**
 * Salva o tempo de percurso entre duas paradas, considerando o horário de saída
 */
export const salvarTempoTrecho = async ({
  itinerarioId,
  paradaA,
  paradaB,
  tempoGastoSegundos,
  horarioSaida,
}) => {
  if (
    !itinerarioId ||
    !paradaA ||
    !paradaB ||
    !tempoGastoSegundos ||
    tempoGastoSegundos < 5
  )
    return;

  const hora = parseInt(horarioSaida?.split(":")[0] || "00");
  const faixaHoraria = getFaixaHoraria(hora);

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
        temposPorFaixa: {
          [faixaHoraria]: {
            soma: tempoGastoSegundos,
            count: 1,
            media: tempoGastoSegundos,
            ultimoTempo: tempoGastoSegundos,
          },
        },
        ultimosTempos: [tempoGastoSegundos],
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

    const temposPorFaixa = dados.temposPorFaixa || {};
    if (!temposPorFaixa[faixaHoraria]) {
      temposPorFaixa[faixaHoraria] = {
        soma: 0,
        count: 0,
        media: 0,
        ultimoTempo: 0,
      };
    }
    const faixa = temposPorFaixa[faixaHoraria];
    faixa.soma += tempoGastoSegundos;
    faixa.count += 1;
    faixa.media = Math.round(faixa.soma / faixa.count);
    faixa.ultimoTempo = tempoGastoSegundos;

    const ultimosTempos = dados.ultimosTempos || [];
    ultimosTempos.push(tempoGastoSegundos);
    if (ultimosTempos.length > 20) {
      ultimosTempos.shift();
    }

    const ultimos10 = ultimosTempos.slice(-10);
    const mediaMovel = Math.round(
      ultimos10.reduce((a, b) => a + b, 0) / ultimos10.length,
    );

    transaction.update(rotaRef, {
      tempoMedioSegundos: novoTempoMedio,
      totalAmostras,
      ultimaAtualizacao: serverTimestamp(),
      temposPorFaixa,
      ultimosTempos,
      mediaMovel,
    });
  });
};

/**
 * Busca o tempo estimado para um trecho
 */
export const getTempoEstimadoTrecho = async (
  itinerarioId,
  paradaA,
  paradaB,
  horarioSaida,
) => {
  const chave = `${itinerarioId}_${paradaA}-${paradaB}`;
  const rotaRef = doc(db, "rotas_aprendidas", chave);

  try {
    const snap = await getDoc(rotaRef);
    if (!snap.exists()) {
      return 180; // fallback de 3 minutos
    }

    const dados = snap.data();
    const hora = parseInt(horarioSaida?.split(":")[0] || "00");
    const faixaHoraria = getFaixaHoraria(hora);

    const temposPorFaixa = dados.temposPorFaixa || {};
    if (
      temposPorFaixa[faixaHoraria] &&
      temposPorFaixa[faixaHoraria].count > 0
    ) {
      return temposPorFaixa[faixaHoraria].media;
    }

    if (dados.mediaMovel && dados.mediaMovel > 0) {
      return dados.mediaMovel;
    }

    if (dados.tempoMedioSegundos) {
      return dados.tempoMedioSegundos;
    }

    return 180;
  } catch (error) {
    console.warn("Erro ao buscar tempo estimado:", error);
    return 180;
  }
};

/**
 * Calcula o horário estimado de chegada do ônibus até a parada onde o usuário está
 * Baseado no horário de saída e nos tempos médios de cada trecho
 */
export const calcularHorarioChegadaOnibusAteVoce = async (
  itinerarioId,
  paradasLista,
  horarioSaida,
  paradaUsuario,
  indiceAtualOnibus,
) => {
  if (!itinerarioId || !paradasLista || !horarioSaida || !paradaUsuario) {
    return null;
  }

  // Encontrar TODAS as ocorrências da parada do usuário
  const idxsUsuario = [];
  paradasLista.forEach((p, i) => {
    if (p === paradaUsuario.toLowerCase().trim()) idxsUsuario.push(i);
  });

  if (idxsUsuario.length === 0) return null;

  // Encontrar a primeira ocorrência que o ônibus ainda não passou
  let idxUsuario = -1;
  for (const idx of idxsUsuario) {
    if (idx > indiceAtualOnibus) {
      idxUsuario = idx;
      break;
    }
  }

  // Se todas as ocorrências já foram passadas
  if (idxUsuario === -1) {
    const ultimoIdx = idxsUsuario[idxsUsuario.length - 1];
    if (ultimoIdx <= indiceAtualOnibus) {
      return {
        horarioEstimado: null,
        status: "passou",
        mensagem: "O ônibus já passou da sua parada!",
      };
    }
    idxUsuario = idxsUsuario[0];
  }

  // Se o ônibus já está na parada do usuário
  if (indiceAtualOnibus === idxUsuario) {
    return {
      horarioEstimado: horarioSaida,
      status: "aqui",
      mensagem: "O ônibus está na sua parada!",
    };
  }

  let tempoTotalSegundos = 0;
  const detalhes = [];

  // Soma os tempos do ônibus até a parada do usuário
  for (let i = indiceAtualOnibus; i < idxUsuario; i++) {
    const paradaA = paradasLista[i];
    const paradaB = paradasLista[i + 1];

    const tempoTrecho = await getTempoEstimadoTrecho(
      itinerarioId,
      paradaA,
      paradaB,
      horarioSaida,
    );

    tempoTotalSegundos += tempoTrecho;
    detalhes.push({
      paradaA,
      paradaB,
      tempoSegundos: tempoTrecho,
      tempoAcumulado: tempoTotalSegundos,
    });
  }

  // Calcula o horário estimado de chegada do ônibus até o usuário
  const [horas, minutos] = horarioSaida.split(":").map(Number);
  const dataSaida = new Date();
  dataSaida.setHours(horas, minutos, 0, 0);

  const dataChegada = new Date(dataSaida.getTime() + tempoTotalSegundos * 1000);
  const horarioEstimado = dataChegada.toTimeString().slice(0, 5);

  return {
    horarioEstimado,
    tempoTotalSegundos,
    detalhes,
    paradaUsuario,
    paradaAtual: paradasLista[indiceAtualOnibus],
    paradasRestantes: idxUsuario - indiceAtualOnibus,
    status: "chegando",
    mensagem: `O ônibus chega na sua parada às ${horarioEstimado}`,
  };
};

/**
 * Calcula o horário estimado de chegada a uma parada (destino final)
 */
export const calcularHorarioEstimadoParada = async (
  itinerarioId,
  paradasLista,
  horarioSaida,
  paradaDestino,
) => {
  if (!itinerarioId || !paradasLista || !horarioSaida || !paradaDestino) {
    return null;
  }

  // Encontrar todas as ocorrências do destino
  const idxsDestino = [];
  paradasLista.forEach((p, i) => {
    if (p === paradaDestino.toLowerCase().trim()) idxsDestino.push(i);
  });

  if (idxsDestino.length === 0) return null;

  // Usar a primeira ocorrência (assumindo que o usuário quer a primeira vez que passa)
  const destinoIdx = idxsDestino[0];
  if (destinoIdx === 0) return null;

  let tempoTotalSegundos = 0;
  const detalhes = [];

  for (let i = 0; i < destinoIdx; i++) {
    const paradaA = paradasLista[i];
    const paradaB = paradasLista[i + 1];

    const tempoTrecho = await getTempoEstimadoTrecho(
      itinerarioId,
      paradaA,
      paradaB,
      horarioSaida,
    );

    tempoTotalSegundos += tempoTrecho;
    detalhes.push({
      paradaA,
      paradaB,
      tempoSegundos: tempoTrecho,
      tempoAcumulado: tempoTotalSegundos,
    });
  }

  const [horas, minutos] = horarioSaida.split(":").map(Number);
  const dataSaida = new Date();
  dataSaida.setHours(horas, minutos, 0, 0);

  const dataChegada = new Date(dataSaida.getTime() + tempoTotalSegundos * 1000);
  const horarioEstimado = dataChegada.toTimeString().slice(0, 5);

  return {
    horarioEstimado,
    tempoTotalSegundos,
    detalhes,
    paradaDestino,
  };
};

/**
 * Calcula o tempo estimado para o ônibus chegar até a parada onde o usuário está
 */
export const calcularTempoParaOnibusChegarAteVoce = async (
  viagemAtiva,
  itinerario,
  paradaUsuario,
  horarioSaida,
) => {
  if (!viagemAtiva || !itinerario || !paradaUsuario) return null;

  const paradas = itinerario.paradas.map((p) =>
    (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
  );

  const idxOnibus = viagemAtiva.indiceParada ?? 0;

  const idxsUsuario = [];
  paradas.forEach((p, i) => {
    if (p === paradaUsuario.toLowerCase().trim()) idxsUsuario.push(i);
  });

  if (idxsUsuario.length === 0) {
    return {
      minutos: 0,
      segundos: 0,
      status: "erro",
      mensagem: "Parada não encontrada no itinerário",
    };
  }

  let idxUsuario = -1;
  for (const idx of idxsUsuario) {
    if (idx > idxOnibus) {
      idxUsuario = idx;
      break;
    }
  }

  if (idxUsuario === -1) {
    const ultimoIdx = idxsUsuario[idxsUsuario.length - 1];
    if (ultimoIdx <= idxOnibus) {
      return {
        minutos: 0,
        segundos: 0,
        status: "passou",
        mensagem: "O ônibus já passou da sua parada!",
      };
    }
    idxUsuario = idxsUsuario[0];
  }

  if (idxOnibus === idxUsuario) {
    return {
      minutos: 0,
      segundos: 0,
      status: "aqui",
      mensagem: "O ônibus está na sua parada!",
    };
  }

  let segundosSomados = 0;
  const detalhes = [];

  for (let i = idxOnibus; i < idxUsuario; i++) {
    const paradaA = paradas[i];
    const paradaB = paradas[i + 1];

    const tempoTrecho = await getTempoEstimadoTrecho(
      itinerario.id,
      paradaA,
      paradaB,
      horarioSaida,
    );

    segundosSomados += tempoTrecho;
    detalhes.push({
      de: paradaA,
      para: paradaB,
      tempo: tempoTrecho,
      acumulado: segundosSomados,
    });
  }

  return {
    minutos: Math.ceil(segundosSomados / 60),
    segundos: segundosSomados,
    status: "chegando",
    mensagem: `O ônibus chega em você em ${Math.ceil(segundosSomados / 60)} minutos`,
    detalhes,
    paradaAtual: paradas[idxOnibus],
    paradaUsuario: paradaUsuario,
    paradasRestantes: idxUsuario - idxOnibus,
  };
};

/**
 * Calcula o tempo restante para o usuário chegar ao seu destino
 */
export const calcularTempoRestanteAteDestino = async (
  viagemAtiva,
  itinerario,
  destinoUsuario,
  horarioSaida,
) => {
  if (!viagemAtiva || !itinerario || !destinoUsuario) return null;

  const paradas = itinerario.paradas.map((p) =>
    (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
  );

  const idxOnibus = viagemAtiva.indiceParada ?? 0;

  const idxsDestino = [];
  paradas.forEach((p, i) => {
    if (p === destinoUsuario.toLowerCase().trim()) idxsDestino.push(i);
  });

  if (idxsDestino.length === 0) return null;

  let idxDestino = -1;
  for (const idx of idxsDestino) {
    if (idx > idxOnibus) {
      idxDestino = idx;
      break;
    }
  }

  if (idxDestino === -1) {
    const ultimoIdx = idxsDestino[idxsDestino.length - 1];
    if (ultimoIdx <= idxOnibus) {
      return {
        minutos: 0,
        segundos: 0,
        status: "chegou",
        mensagem: "Você já chegou ao seu destino!",
      };
    }
    idxDestino = idxsDestino[0];
  }

  if (idxOnibus >= idxDestino) {
    return {
      minutos: 0,
      segundos: 0,
      status: "chegou",
      mensagem: "Você já chegou ao seu destino!",
    };
  }

  let segundosSomados = 0;
  const detalhes = [];

  for (let i = idxOnibus; i < idxDestino; i++) {
    const paradaA = paradas[i];
    const paradaB = paradas[i + 1];

    const tempoTrecho = await getTempoEstimadoTrecho(
      itinerario.id,
      paradaA,
      paradaB,
      horarioSaida,
    );

    segundosSomados += tempoTrecho;
    detalhes.push({
      de: paradaA,
      para: paradaB,
      tempo: tempoTrecho,
      acumulado: segundosSomados,
    });
  }

  return {
    minutos: Math.ceil(segundosSomados / 60),
    segundos: segundosSomados,
    status: "viajando",
    mensagem: `Chegada em ${Math.ceil(segundosSomados / 60)} minutos`,
    detalhes,
    paradaAtual: paradas[idxOnibus],
    destino: destinoUsuario,
    paradasRestantes: idxDestino - idxOnibus,
  };
};

// ==================== GERENCIAMENTO DE VIAGEM ====================
export const entrarNaViagem = async (
  viagemId,
  usuario,
  paradaOrigem,
  paradaDestino,
  itinerarioCompleto,
) => {
  const viagemRef = doc(db, "viagens_ativas", viagemId);
  const userRef = doc(db, "usuarios", usuario.uid);

  const userSnap = await getDoc(userRef);
  if (
    userSnap.exists() &&
    userSnap.data().viagemAtualId &&
    userSnap.data().viagemAtualId !== viagemId
  ) {
    console.log(
      "[Embarque] Usuário já está em outra viagem:",
      userSnap.data().viagemAtualId,
    );
    return "bloqueado";
  }

  const paradasLista = itinerarioCompleto.paradas.map((p) =>
    (typeof p === "object" ? p.nome : p).toLowerCase().trim(),
  );

  const idxsOrigem = [];
  const idxsDestino = [];
  paradasLista.forEach((p, i) => {
    if (p === paradaOrigem.toLowerCase().trim()) idxsOrigem.push(i);
    if (p === paradaDestino.toLowerCase().trim()) idxsDestino.push(i);
  });

  let melhorOrigem = -1;
  let melhorDestino = -1;
  let menorDistancia = Infinity;

  for (const o of idxsOrigem) {
    for (const d of idxsDestino) {
      if (o < d && d - o < menorDistancia) {
        menorDistancia = d - o;
        melhorOrigem = o;
        melhorDestino = d;
      }
    }
  }

  if (melhorOrigem === -1 || melhorDestino === -1) {
    console.error("[Embarque] Paradas não encontradas no itinerário");
    return "bloqueado";
  }

  const ordemDestino = melhorDestino;

  const novoPassageiro = {
    uid: usuario.uid,
    nome: usuario.displayName || "Estudante",
    origem: paradaOrigem,
    destino: paradaDestino,
    ordemDestino,
    timestamp: new Date(),
  };

  let papel;

  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(viagemRef);

      if (!snap.exists()) {
        console.log("[Embarque] Criando nova viagem, usuário vira rastreador");
        transaction.set(viagemRef, {
          rastreadorAtual: novoPassageiro,
          proximoRastreador: null,
          ultimaParada: paradaOrigem,
          paradaAtual: paradaOrigem,
          indiceParada: melhorOrigem,
          ultimoHeartbeat: serverTimestamp(),
          atualizadoEm: serverTimestamp(),
          historicoLotacao: [],
          lat: null,
          lng: null,
          velocidade: 0,
          chegouAoDestino: false,
        });
        papel = "rastreador";
        return;
      }

      const viagemDados = snap.data();

      if (!viagemDados.rastreadorAtual) {
        console.log("[Embarque] Sem rastreador, usuário vira rastreador");
        transaction.update(viagemRef, {
          rastreadorAtual: novoPassageiro,
          proximoRastreador: null,
          ultimaParada: paradaOrigem,
          paradaAtual: paradaOrigem,
          indiceParada: melhorOrigem,
          atualizadoEm: serverTimestamp(),
          chegouAoDestino: false,
        });
        papel = "rastreador";
        return;
      }

      const ordemRastreadorAtual =
        viagemDados.rastreadorAtual?.ordemDestino ?? 999;
      const ordemProximo = viagemDados.proximoRastreador?.ordemDestino ?? 999;

      if (ordemDestino > ordemRastreadorAtual) {
        if (ordemDestino > ordemProximo || ordemProximo === 999) {
          transaction.update(viagemRef, {
            proximoRastreador: novoPassageiro,
            atualizadoEm: serverTimestamp(),
          });
        }
        papel = "reserva_prioritaria";
      } else {
        papel = "passageiro";
      }
    });
  } catch (error) {
    console.error("[Embarque] Erro na transação:", error);
    return "bloqueado";
  }

  try {
    await setDoc(userRef, { viagemAtualId: viagemId }, { merge: true });
    console.log("[Embarque] Usuário atualizado com viagemId:", viagemId);
  } catch (error) {
    console.error("[Embarque] Erro ao atualizar usuário:", error);
  }

  return papel;
};

// ==================== DETECÇÃO AUTOMÁTICA DE PARADAS ====================
export const verificarEAtualizarParadaAutomatica = async (
  viagemId,
  lat,
  lng,
  itinerario,
  paradasData,
  isRastreador = true,
  velocidade = 0,
) => {
  const viagemRef = doc(db, "viagens_ativas", viagemId);
  const paradasLista = itinerario.paradas.map((p) =>
    (typeof p === "object" ? p.nome : p).toString().toLowerCase().trim(),
  );

  const snap = await getDoc(viagemRef);
  if (!snap.exists()) return null;
  const dadosAtuais = snap.data();
  const indiceAtual = dadosAtuais.indiceParada ?? -1;

  if (indiceAtual === -1) return null;

  const proximoIndice = indiceAtual + 1;

  if (proximoIndice >= paradasLista.length) {
    const ultimaParada = paradasLista[paradasLista.length - 1];
    const infoUltima = paradasData[ultimaParada];
    if (infoUltima?.location) {
      let latP = Number(
        infoUltima.location.latitude || infoUltima.location._lat,
      );
      let lngP = Number(
        infoUltima.location.longitude || infoUltima.location._long,
      );
      latP = latP > 0 ? latP * -1 : latP;
      lngP = lngP > 0 ? lngP * -1 : lngP;
      const distUltima = calculateDistance(lat, lng, latP, lngP);

      if (
        distUltima <= RAIO_CHECKIN_METROS_PADRAO &&
        (velocidade < 3 || velocidade === 0)
      ) {
        await updateDoc(viagemRef, {
          paradaAtual: ultimaParada,
          ultimaParada: ultimaParada,
          indiceParada: paradasLista.length - 1,
          atualizadoEm: serverTimestamp(),
          chegouAoDestino: true,
        });
        return {
          indiceDetectado: paradasLista.length - 1,
          paradaDetectada: ultimaParada,
          fimDoItinerario: true,
        };
      }
    }
    return null;
  }

  const nomeProxima = paradasLista[proximoIndice];
  const infoProxima = paradasData[nomeProxima];
  if (!infoProxima?.location) return null;

  let latP = Number(infoProxima.location.latitude || infoProxima.location._lat);
  let lngP = Number(
    infoProxima.location.longitude || infoProxima.location._long,
  );
  latP = latP > 0 ? latP * -1 : latP;
  lngP = lngP > 0 ? lngP * -1 : lngP;

  const distProxima = calculateDistance(lat, lng, latP, lngP);

  let raioUsar = RAIO_CHECKIN_METROS_PADRAO;
  if (isRastreador && PARADAS_CONFLITANTES.includes(nomeProxima)) {
    raioUsar = RAIO_CHECKIN_CONFLITO;
  }

  if (distProxima <= raioUsar && (velocidade < 5 || velocidade === 0)) {
    await updateDoc(viagemRef, {
      paradaAtual: nomeProxima,
      ultimaParada: nomeProxima,
      indiceParada: proximoIndice,
      atualizadoEm: serverTimestamp(),
    });
    return { indiceDetectado: proximoIndice, paradaDetectada: nomeProxima };
  }

  const proximoIndice2 = indiceAtual + 2;
  if (proximoIndice2 < paradasLista.length) {
    const nomeProxima2 = paradasLista[proximoIndice2];
    const infoProxima2 = paradasData[nomeProxima2];
    if (infoProxima2?.location) {
      let latP2 = Number(
        infoProxima2.location.latitude || infoProxima2.location._lat,
      );
      let lngP2 = Number(
        infoProxima2.location.longitude || infoProxima2.location._long,
      );
      latP2 = latP2 > 0 ? latP2 * -1 : latP2;
      lngP2 = lngP2 > 0 ? lngP2 * -1 : lngP2;
      const distProxima2 = calculateDistance(lat, lng, latP2, lngP2);
      if (distProxima2 <= 15 && velocidade < 1) {
        await updateDoc(viagemRef, {
          paradaAtual: nomeProxima2,
          ultimaParada: nomeProxima2,
          indiceParada: proximoIndice2,
          atualizadoEm: serverTimestamp(),
        });
        return {
          indiceDetectado: proximoIndice2,
          paradaDetectada: nomeProxima2,
        };
      }
    }
  }

  return null;
};

// ==================== FUNÇÃO LEGACY ====================
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
