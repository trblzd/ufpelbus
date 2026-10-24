import React, { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, CircleMarker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, serverTimestamp, onSnapshot, deleteDoc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { Box, Button, Typography, Paper, Skeleton, Stack, Chip, IconButton, Snackbar, Alert, LinearProgress } from '@mui/material';
import { CloseIcon, DirectionsBusIcon, LocationOnIcon, ScheduleIcon, TripOriginIcon } from './icons';
import { traduzirSigla } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import { useLocation as useGeoLocation } from '../hooks/useLocation';
import { useRastreamento } from '../hooks/useRastreamento';
import {
  entrarNaViagem,
  calcularHorarioChegadaOnibusAteVoce,
  calcularHorarioEstimadoParada,
  calcularTempoParaOnibusChegarAteVoce,
  calcularTempoRestanteAteDestino,
  calcularTempoParaOnibusChegarAteVocePorPosicao,
} from '../services/transporteService';
import { usePersistViagem } from '../hooks/usePersistViagem';
import { useEmbarqueAutomatico } from '../hooks/useEmbarqueAutomatico';
import { usePageVisibility } from '../hooks/usePageVisibility';
import { getAuth } from 'firebase/auth';
import { cores } from '../theme/tokens';
import 'leaflet/dist/leaflet.css';
import './MainPage.css';

// ==================== CONSTANTES E CONFIGURAÇÕES ====================

const iconEmbarque = new L.DivIcon({
  className: 'custom-stop-icon',
  html: `<div style="width:24px;height:24px;border-radius:50%;background:${cores.marca};border:2px solid ${cores.marcaClara};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.25)"><span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px;color:${cores.texto}">trip_origin</span></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

const iconIntermediario = new L.DivIcon({
  className: 'custom-stop-icon',
  html: `<div style="width:10px;height:10px;border-radius:50%;background:${cores.superficie1};border:2px solid ${cores.texto2}"></div>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7]
});

const iconDestino = new L.DivIcon({
  className: 'custom-stop-icon',
  html: `<div style="width:24px;height:24px;border-radius:50%;background:${cores.marca};border:2px solid ${cores.marcaClara};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.25)"><span class="material-symbols-outlined" aria-hidden="true" style="font-size:14px;color:${cores.texto};font-variation-settings:'FILL' 1">location_on</span></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -12]
});

const iconOnibus = new L.DivIcon({
  className: 'custom-bus-icon',
  html: `<div style="width:32px;height:32px;border-radius:50%;background:${cores.marca};display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.25)"><span class="material-symbols-outlined" aria-hidden="true" style="font-size:18px;color:${cores.texto};font-variation-settings:'FILL' 1">directions_bus</span></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

const TEMPO_CONFIRMACAO_MS = 5000;

// ==================== COMPONENTE PRINCIPAL ====================

export default function MainPage({
  itinerario,
  horario,
  origem,
  destino,
  modoApenasConsulta,
  voltar,
  categoria
}) {
  const navigate = useNavigate();
  const { position } = useGeoLocation({ ativo: true });
  const auth = getAuth();
  const isPageVisible = usePageVisibility();

  // ==================== ESTADOS LOCAIS ====================
  const [reconectando, setReconectando] = useState(false);
  const ultimaReconexaoRef = useRef(0);
  const [embarqueAutomaticoAtivo, setEmbarqueAutomaticoAtivo] = useState(true);

  const [statusFluxoPersistido, setStatusFluxoPersistido, clearStatusFluxo] = usePersistViagem('statusFluxo', 'inicial');
  const [isRastreadorPersistido, setIsRastreadorPersistido, clearIsRastreador] = usePersistViagem('isRastreador', false);
  const [viagemIdPersistida, setViagemIdPersistida, clearViagemId] = usePersistViagem('viagemId', null);
  const [gpsPassageiroAtivoPersistido, setGpsPassageiroAtivoPersistido, clearGpsPassageiro] = usePersistViagem('gpsPassageiroAtivo', false);

  const [paradasData, setParadasData] = useState({});
  const [loading, setLoading] = useState(true);
  const [viagemAtiva, setViagemAtiva] = useState(null);
  const [distanciaAteParada, setDistanciaAteParada] = useState(null);
  const [rotasAprendidas, setRotasAprendidas] = useState({});
  const [geometriaRotas, setGeometriaRotas] = useState({});
  const [alertaMsg, setAlertaMsg] = useState(null);
  const [embarcando, setEmbarcando] = useState(false);
  const [posicaoOnibus, setPosicaoOnibus] = useState(null);

  // ==================== ESTIMATIVAS ====================
  const [horarioChegadaOnibus, setHorarioChegadaOnibus] = useState(null);
  const [horarioEstimadoDestino, setHorarioEstimadoDestino] = useState(null);
  const [carregandoEstimativa, setCarregandoEstimativa] = useState(false);
  const [tempoParaOnibusChegar, setTempoParaOnibusChegar] = useState(null);
  const [tempoAteDestino, setTempoAteDestino] = useState(null);
  const [carregandoTempo, setCarregandoTempo] = useState(false);

  const snackbarTimerRef = useRef(null);

  const dataAtual = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const tripId = `${itinerario?.id}_${horario?.replace(':', '')}_${dataAtual}`;

  // ==================== WRAPPERS DOS ESTADOS PERSISTENTES ====================
  const statusFluxo = statusFluxoPersistido;
  const setStatusFluxo = useCallback((value) => {
    if (value === 'expulso' || value === 'inicial') {
      clearStatusFluxo();
      clearIsRastreador();
      clearViagemId();
      clearGpsPassageiro();
    }
    setStatusFluxoPersistido(value);
  }, [clearStatusFluxo, clearIsRastreador, clearViagemId, clearGpsPassageiro, setStatusFluxoPersistido]);

  const isRastreador = isRastreadorPersistido;
  const setIsRastreador = useCallback((value) => setIsRastreadorPersistido(value), [setIsRastreadorPersistido]);
  const gpsPassageiroAtivo = gpsPassageiroAtivoPersistido;
  const setGpsPassageiroAtivo = useCallback((value) => setGpsPassageiroAtivoPersistido(value), [setGpsPassageiroAtivoPersistido]);

  // ==================== FUNÇÕES AUXILIARES ====================

  const getCoords = useCallback((idRaw) => {
    if (!idRaw) return null;
    const id = (typeof idRaw === 'object' ? idRaw.nome : idRaw).toString().toLowerCase().trim();
    const info = paradasData[id];
    if (info?.location) {
      let lat = Number(info.location.latitude || info.location._lat);
      let lng = Number(info.location.longitude || info.location._long);
      return [lat > 0 ? lat * -1 : lat, lng > 0 ? lng * -1 : lng];
    }
    return null;
  }, [paradasData]);

  const coordsParadaOrigem = useMemo(() => {
    if (!origem || !paradasData) return null;
    return getCoords(origem);
  }, [origem, paradasData, getCoords]);

  useEffect(() => {
  if (modoApenasConsulta) return;
  if (statusFluxo !== 'inicial') return; // já está numa viagem desta sessão
  if (!tripId) return;

  const usuario = auth.currentUser;
  if (!usuario) return;

  let cancelado = false;
  (async () => {
    try {
      const userRef = doc(db, "usuarios", usuario.uid);
      const snap = await getDoc(userRef);
      if (cancelado || !snap.exists()) return;

      const viagemAtual = snap.data().viagemAtualId;
      if (viagemAtual && viagemAtual !== tripId) {
        console.log(
          `[MainPage] Limpando viagemAtiva anterior (${viagemAtual}) ao entrar no mapa de ${tripId}`
        );
        await updateDoc(userRef, { viagemAtualId: null });
      }
    } catch (e) {
      console.warn("[MainPage] Erro ao limpar viagem anterior:", e);
    }
  })();

  return () => { cancelado = true; };
}, [modoApenasConsulta, statusFluxo, tripId, auth]);


  // ==================== LÓGICA DE ESTIMATIVAS ====================
  const calcularHorarioChegadaOnibus = useCallback(async () => {
    if (!itinerario || !horario || !origem || Object.keys(paradasData).length === 0) return;
    if (modoApenasConsulta) return;
    if (statusFluxo !== 'inicial') return;

    setCarregandoEstimativa(true);
    try {
      const paradasLista = itinerario.paradas.map(p =>
        (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
      );
      const indiceAtualOnibus = viagemAtiva?.indiceParada ?? 0;
      const resultado = await calcularHorarioChegadaOnibusAteVoce(
        itinerario.id, paradasLista, horario, origem, indiceAtualOnibus
      );
      if (resultado) setHorarioChegadaOnibus(resultado);
    } catch (error) {
      console.warn(error);
    } finally {
      setCarregandoEstimativa(false);
    }
  }, [itinerario, horario, origem, paradasData, modoApenasConsulta, statusFluxo, viagemAtiva]);

  const calcularHorarioDestino = useCallback(async () => {
    if (!itinerario || !horario || !destino || Object.keys(paradasData).length === 0) return;
    if (modoApenasConsulta) return;
    if (statusFluxo === 'inicial') return;

    setCarregandoEstimativa(true);
    try {
      const paradasLista = itinerario.paradas.map(p =>
        (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
      );
      const resultado = await calcularHorarioEstimadoParada(
        itinerario.id, paradasLista, horario, destino
      );
      if (resultado) setHorarioEstimadoDestino(resultado);
    } catch (error) {
      console.warn(error);
    } finally {
      setCarregandoEstimativa(false);
    }
  }, [itinerario, horario, destino, paradasData, modoApenasConsulta, statusFluxo]);

  const calcularEstimativas = useCallback(async () => {
    if (!viagemAtiva || !itinerario || !horario || modoApenasConsulta) return;
    if (!origem && !destino) return;

    setCarregandoTempo(true);
    try {
      if (statusFluxo === 'inicial' && origem) {
        let resultado = null;

        // ✅ Se o ônibus já reportou posição, usa distância ônibus→parada
        if (
          viagemAtiva.lat != null &&
          viagemAtiva.lng != null &&
          paradasData &&
          Object.keys(paradasData).length > 0
        ) {
          resultado = calcularTempoParaOnibusChegarAteVocePorPosicao(
            viagemAtiva,
            itinerario,
            origem,
            paradasData,
          );
        }

        // Fallback: método antigo (índice + tempos aprendidos)
        if (!resultado) {
          resultado = await calcularTempoParaOnibusChegarAteVoce(
            viagemAtiva, itinerario, origem, horario
          );
        }

        if (resultado) {
          setTempoParaOnibusChegar(resultado);
          setTempoAteDestino(null);
        }
      } else if (statusFluxo !== 'inicial' && destino) {
        const resultado = await calcularTempoRestanteAteDestino(
          viagemAtiva, itinerario, destino, horario
        );
        if (resultado) {
          setTempoAteDestino(resultado);
          setTempoParaOnibusChegar(null);
        }
      }
    } catch (error) {
      console.warn(error);
    } finally {
      setCarregandoTempo(false);
    }
  }, [viagemAtiva, itinerario, horario, origem, destino, statusFluxo, modoApenasConsulta, paradasData]);

  useEffect(() => {
    if (itinerario && horario && origem && Object.keys(paradasData).length > 0) {
      calcularHorarioChegadaOnibus();
    }
    if (itinerario && horario && destino && Object.keys(paradasData).length > 0 && statusFluxo !== 'inicial') {
      calcularHorarioDestino();
    }
  }, [itinerario, horario, origem, destino, paradasData, statusFluxo, calcularHorarioChegadaOnibus, calcularHorarioDestino]);

  useEffect(() => {
    if (viagemAtiva && itinerario && horario) calcularEstimativas();
  }, [viagemAtiva, itinerario, horario, calcularEstimativas]);

  useEffect(() => {
    if (viagemAtiva && !modoApenasConsulta) {
      const timer = setTimeout(() => {
        calcularHorarioChegadaOnibus();
        calcularHorarioDestino();
        calcularEstimativas();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [viagemAtiva, modoApenasConsulta, calcularHorarioChegadaOnibus, calcularHorarioDestino, calcularEstimativas]);

  const handleFechar = useCallback(async () => {
    try {
      const usuario = auth.currentUser;
      if (usuario && tripId && statusFluxo !== 'inicial' && statusFluxo !== 'expulso') {
        const viagemRef = doc(db, "viagens_ativas", tripId);
        const snap = await getDoc(viagemRef);

        if (snap.exists()) {
          const dados = snap.data();
          if (dados.rastreadorAtual?.uid === usuario.uid) {
            if (dados.proximoRastreador) {
              await updateDoc(viagemRef, {
                rastreadorAtual: dados.proximoRastreador,
                proximoRastreador: null,
                atualizadoEm: serverTimestamp(),
              });
            } else {
              await updateDoc(viagemRef, {
                rastreadorAtual: null,
                atualizadoEm: serverTimestamp(),
              });
            }
          } else if (dados.proximoRastreador?.uid === usuario.uid) {
            await updateDoc(viagemRef, {
              proximoRastreador: null,
              atualizadoEm: serverTimestamp(),
            });
          }
        }

        await updateDoc(doc(db, "usuarios", usuario.uid), {
          viagemAtualId: null,
        });
      }
    } catch (e) {
      console.warn("Erro ao sair da viagem:", e);
    }

    clearStatusFluxo();
    clearIsRastreador();
    clearViagemId();
    clearGpsPassageiro();
    voltar();
  }, [tripId, statusFluxo, clearStatusFluxo, clearIsRastreador, clearViagemId, clearGpsPassageiro, voltar]);

  // ==================== FUNÇÕES DE INTERAÇÃO E EMBARQUE ====================
  const handleConfirmarEmbarque = useCallback(async () => {
    if (embarcando) return;
    setEmbarcando(true);

    try {
      const usuario = auth.currentUser;
      if (!usuario) {
        setAlertaMsg({ texto: 'Usuário não autenticado.', severidade: 'error' });
        return;
      }

      const paradasNormalizadas = itinerario.paradas.map(p =>
        (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
      );

      const idxsOrigem = [];
      paradasNormalizadas.forEach((p, i) => {
        if (p === origem.toLowerCase().trim()) idxsOrigem.push(i);
      });

      const idxsDestino = [];
      paradasNormalizadas.forEach((p, i) => {
        if (p === destino.toLowerCase().trim()) idxsDestino.push(i);
      });

      let melhorOrigem = -1; let melhorDestino = -1; let menorDistancia = Infinity;

      for (const o of idxsOrigem) {
        for (const d of idxsDestino) {
          if (o < d && (d - o) < menorDistancia) {
            menorDistancia = d - o; melhorOrigem = o; melhorDestino = d;
          }
        }
      }

      if (melhorOrigem === -1 || melhorDestino === -1) {
        setAlertaMsg({ texto: 'Parada não encontrada.', severidade: 'error' });
        return;
      }

      if (melhorOrigem === paradasNormalizadas.length - 1) {
        setAlertaMsg({ texto: 'Você está na última parada.', severidade: 'warning' });
        return;
      }

      let papel;
      try {
        papel = await entrarNaViagem(tripId, usuario, origem, destino, itinerario);
      } catch (e) {
        setAlertaMsg({ texto: 'Erro: ' + e.message, severidade: 'error' });
        return;
      }

      if (papel === 'bloqueado') {
        setAlertaMsg({ texto: 'Você já está em outra viagem!', severidade: 'warning' });
        return;
      }

      await setDoc(doc(db, "viagens_ativas", tripId), {
        ultimaParada: origem,
        indiceParada: melhorOrigem,
        atualizadoEm: serverTimestamp(),
      }, { merge: true });

      setIsRastreador(papel === 'rastreador' || papel === 'reserva_prioritaria');
      setStatusFluxo('votando');
      setAlertaMsg({ texto: `Embarque confirmado!`, severidade: 'success' });

    } catch (error) {
      setAlertaMsg({ texto: 'Erro ao confirmar embarque.', severidade: 'error' });
    } finally {
      setEmbarcando(false);
    }
  }, [auth, itinerario, origem, destino, tripId, setIsRastreador, setStatusFluxo, embarcando]);

  const { status: statusEmbarqueAuto, distancia: distanciaAuto, velocidade: velocidadeAuto, tempoRestante } = useEmbarqueAutomatico({
    ativo: embarqueAutomaticoAtivo && !modoApenasConsulta && statusFluxo === 'inicial' && !!position && !!coordsParadaOrigem,
    position,
    paradaOrigem: origem,
    paradaCoords: coordsParadaOrigem,
    onEmbarqueConfirmado: async () => {
      setAlertaMsg({ texto: `Embarque automático detectado!`, severidade: 'success' });
      await handleConfirmarEmbarque();
      setEmbarqueAutomaticoAtivo(false);
    },
  });

  // ==================== PERSISTÊNCIA & FETCHING ====================
  useEffect(() => {
    if (statusFluxo !== 'inicial' && statusFluxo !== 'expulso' && tripId) setViagemIdPersistida(tripId);
  }, [statusFluxo, tripId, setViagemIdPersistida]);

  useEffect(() => {
    let mounted = true;
    getDocs(collection(db, "paradas")).then(s => {
      const mapeamento = {};
      s.docs.forEach(d => { mapeamento[d.id.toLowerCase().trim()] = d.data(); });
      if (mounted) setParadasData(mapeamento);
      setLoading(false);
    });

    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) {
        const dados = d.data();
        setViagemAtiva(dados);
        if (dados.lat && dados.lng) setPosicaoOnibus({ lat: dados.lat, lng: dados.lng });
      } else {
        setViagemAtiva(null); setPosicaoOnibus(null);
      }
    });
    return () => { mounted = false; unsub(); };
  }, [tripId]);

  useEffect(() => {
    const carregarGeometriasFixas = async () => {
      if (!itinerario?.id) return;
      const paradasLista = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
      const geometrias = {};
      for (let i = 0; i < paradasLista.length - 1; i++) {
        const docId = `${itinerario.id}_${paradasLista[i]}-${paradasLista[i + 1]}`;
        try {
          const docSnap = await getDoc(doc(db, "rotas_geometricas", docId));
          if (docSnap.exists() && docSnap.data().geometria?.length >= 2) geometrias[docId] = docSnap.data().geometria;
        } catch (err) { }
      }
      setGeometriaRotas(geometrias);
    };
    carregarGeometriasFixas();
  }, [itinerario]);

  useEffect(() => {
    const carregarRotasTempo = async () => {
      if (!itinerario?.id) return;
      const paradasLista = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
      const tempos = {};
      for (let i = 0; i < paradasLista.length - 1; i++) {
        const docId = `${itinerario.id}_${paradasLista[i]}-${paradasLista[i + 1]}`;
        const docSnap = await getDoc(doc(db, "rotas_aprendidas", docId));
        tempos[docId] = docSnap.exists() ? { tempoMedioSegundos: docSnap.data().tempoMedioSegundos || 180 } : { tempoMedioSegundos: 180 };
      }
      setRotasAprendidas(tempos);
    };
    carregarRotasTempo();
  }, [itinerario]);

  useEffect(() => {
    const oriKey = origem?.toLowerCase().trim();
    if (position && paradasData[oriKey]) {
      const coords = getCoords(oriKey);
      if (coords) setDistanciaAteParada(calculateDistance(position.lat, position.lng, coords[0], coords[1]));
    }
  }, [position, paradasData, origem, getCoords]);

  // ==================== EXPULSÃO DE VIAGEM ====================
  const handleExpulsar = useCallback(async (motivo) => {
    // ✅ Guarda contra expulsão dupla (o hook pode chamar + este useEffect abaixo pode chamar)
    if (statusFluxo === 'expulso') {
      console.log('[Expulsão] Ignorada — usuário já foi expulso.');
      return;
    }

    console.log(`[Expulsão] Motivo: ${motivo}`);

    if (motivo === 'destino' && tripId) {
      try {
        await updateDoc(doc(db, "viagens_ativas", tripId), {
          status: 'concluida',
          horarioConclusao: serverTimestamp(),
        });
      } catch (error) {
        console.warn('Erro ao concluir viagem:', error);
      }
    }

    setStatusFluxo('expulso');
    setTimeout(() => {
      clearStatusFluxo();
      clearIsRastreador();
      clearViagemId();
      clearGpsPassageiro();
      voltar();
    }, 3000);
  }, [voltar, setStatusFluxo, tripId, statusFluxo, clearStatusFluxo, clearIsRastreador, clearViagemId, clearGpsPassageiro]);

  // ============================================================
  // ✅ NOVO: EXPULSÃO DO PASSAGEIRO AO CHEGAR NO DESTINO
  // ============================================================
  // Independente do GPS. Reage à mudança de `indiceParada` no
  // Firestore: quando o ônibus chega (ou passa) do índice do
  // destino do usuário, ele é liberado automaticamente.
  //
  // Isso resolve o problema do passageiro que fica preso no ônibus
  // porque seu GPS nunca era ativado (o hook useRastreamento
  // precisa de `ativo === true` para rodar `tick()`, e o
  // passageiro só ativava o GPS via `onReativarGpsPassageiro`
  // dentro do próprio `tick` — deadlock).
  useEffect(() => {
    if (modoApenasConsulta) return;
    if (!viagemAtiva || !itinerario || !destino) return;
    if (statusFluxo === 'inicial' || statusFluxo === 'expulso') return;

    const paradasLista = itinerario.paradas.map((p) =>
      (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
    );
    const destinoKey = destino.toLowerCase().trim();

    const indices = [];
    paradasLista.forEach((p, i) => {
      if (p === destinoKey) indices.push(i);
    });
    if (indices.length === 0) return;

    const indiceAtualOnibus = viagemAtiva.indiceParada ?? 0;

    // Escolhe o primeiro índice do destino que é >= ao índice atual
    let idxDestinoUsuario = -1;
    for (const idx of indices) {
      if (idx >= indiceAtualOnibus) {
        idxDestinoUsuario = idx;
        break;
      }
    }
    if (idxDestinoUsuario === -1) idxDestinoUsuario = indices[indices.length - 1];

    // Condição de expulsão:
    //  - índice do ônibus >= índice do destino do usuário
    //  - OU flag `chegouAoDestino` marcada pelo rastreador
    if (
      indiceAtualOnibus >= idxDestinoUsuario ||
      viagemAtiva.chegouAoDestino === true
    ) {
      console.log(
        `[MainPage] Usuário chegou ao destino (indiceOnibus=${indiceAtualOnibus}, idxDestino=${idxDestinoUsuario}). Expulsando...`
      );
      handleExpulsar('destino');
    }
  }, [
    viagemAtiva,
    itinerario,
    destino,
    statusFluxo,
    modoApenasConsulta,
    handleExpulsar,
  ]);

  const handleVotarLotacao = useCallback(async (statusLot) => {
    const valores = { 'vazio': 1, 'medio': 3, 'lotado': 5 };
    await updateDoc(doc(db, "viagens_ativas", tripId), {
      historicoLotacao: arrayUnion({ valor: valores[statusLot], data: new Date() }),
      atualizadoEm: serverTimestamp()
    });
    setStatusFluxo('rastreando');
  }, [tripId, setStatusFluxo]);

  useRastreamento({
    ativo: (statusFluxo === 'rastreando' && isRastreador && !modoApenasConsulta) || (statusFluxo === 'rastreando' && gpsPassageiroAtivo),
    isRastreador, viagemId: tripId, itinerario, horario,
    paradaOrigem: origem || '', paradaDestino: destino || '',
    paradasData, rotasAprendidas, onExpulsar: handleExpulsar,
    onReativarGpsPassageiro: () => {
      if (!isRastreador && statusFluxo === 'rastreando' && !gpsPassageiroAtivo) setGpsPassageiroAtivo(true);
    },
  });

  const infoLotacao = useMemo(() => {
    if (!viagemAtiva?.historicoLotacao || viagemAtiva.historicoLotacao.length === 0) return null;
    const agoraMs = Date.now();
    const votosRecentes = viagemAtiva.historicoLotacao.filter(voto => {
      const dataVoto = voto.data?.toDate ? voto.data.toDate().getTime() : (voto.data?.seconds * 1000 || agoraMs);
      return (agoraMs - dataVoto) <= 20 * 60 * 1000;
    });
    if (votosRecentes.length === 0) return null;
    const soma = votosRecentes.reduce((acc, curr) => acc + curr.valor, 0);
    const media = parseFloat((soma / votosRecentes.length).toFixed(1));
    let label = "Vazio", cor = cores.sucesso;
    if (media > 4.0) { label = "Lotado"; cor = cores.perigo; }
    else if (media > 2.5) { label = "Médio"; cor = cores.alerta; }
    return { media, label, cor };
  }, [viagemAtiva]);

  const paradasTrecho = useMemo(() => {
    if (!itinerario?.paradas) return [];
    const lista = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
    if (modoApenasConsulta || !origem || !destino) return lista;
    const ori = origem.toLowerCase().trim(); const dst = destino.toLowerCase().trim();
    const idxsO = []; const idxsD = [];
    lista.forEach((p, i) => { if (p === ori) idxsO.push(i); if (p === dst) idxsD.push(i); });
    let melhorDiff = Infinity; let melhorIdxO = -1, melhorIdxD = -1;
    for (const o of idxsO) {
      for (const d of idxsD) {
        if (o < d && (d - o) < melhorDiff) { melhorDiff = d - o; melhorIdxO = o; melhorIdxD = d; }
      }
    }
    if (melhorIdxO !== -1 && melhorIdxD !== -1) return lista.slice(melhorIdxO, melhorIdxD + 1);
    return lista;
  }, [itinerario, origem, destino, modoApenasConsulta]);

  const coords = useMemo(() => paradasTrecho.map(getCoords).filter(c => c !== null), [paradasTrecho, getCoords]);
  const progressoEmbarque = useMemo(() => statusEmbarqueAuto !== 'proximo' || !tempoRestante ? 0 : ((TEMPO_CONFIRMACAO_MS - tempoRestante) / TEMPO_CONFIRMACAO_MS) * 100, [statusEmbarqueAuto, tempoRestante]);

  // ==================== TEXTO DA ESTIMATIVA ====================
  const formatarTempo = (minutos) => {
    if (minutos === null || minutos === undefined) return "--";
    if (minutos < 1) return "agora mesmo";
    if (minutos === 1) return "1 min";
    return `${minutos} min`;
  };

  const estimativaTexto = useMemo(() => {
    if (carregandoTempo) return "Calculando...";
    if (statusFluxo === 'inicial' && tempoParaOnibusChegar) {
      return formatarTempo(tempoParaOnibusChegar.minutos);
    }
    if (statusFluxo !== 'inicial' && tempoAteDestino) {
      return formatarTempo(tempoAteDestino.minutos);
    }
    return "--";
  }, [carregandoTempo, statusFluxo, tempoParaOnibusChegar, tempoAteDestino]);

  // ==================== RENDER DOS TRAÇOS DO MAPA COM GRADIENTE ====================
  const renderRota = () => {
    if (paradasTrecho.length < 2) return null;

    const oriIdx = origem ? paradasTrecho.findIndex(p => p === origem.toLowerCase().trim()) : -1;
    const dstIdx = destino ? paradasTrecho.findIndex(p => p === destino.toLowerCase().trim()) : -1;

    return paradasTrecho.map((idA, i) => {
      if (i === paradasTrecho.length - 1) return null;
      const idB = paradasTrecho[i + 1];
      const chave = `${itinerario.id}_${idA}-${idB}`;
      const geometria = geometriaRotas[chave];
      const c1 = getCoords(idA);
      const c2 = getCoords(idB);
      if (!c1 || !c2) return null;

      let positions;
      let isEstimada = false;
      if (geometria && geometria.length >= 2) {
        positions = geometria.map(p => [p.lat, p.lng]);
      } else {
        positions = [c1, c2];
        isEstimada = true;
      }

      const isActiveSegment = (oriIdx !== -1 && dstIdx !== -1)
        ? (i >= oriIdx && i < dstIdx)
        : true;

      if (isActiveSegment && !isEstimada) {
        return (
          <Fragment key={i}>
            <Polyline
              positions={positions}
              pathOptions={{
                color: cores.preto,
                weight: 9,
                opacity: 1,
                lineCap: 'round',
                lineJoin: 'round'
              }}
            />
            <Polyline
              positions={positions}
              pathOptions={{
                color: cores.marcaClara,
                weight: 5,
                opacity: 1,
                lineCap: 'round',
                lineJoin: 'round'
              }}
            />
          </Fragment>
        );
      }

      if (isActiveSegment && isEstimada) {
        return (
          <Polyline
            key={i}
            positions={positions}
            pathOptions={{
              color: cores.marcaClara,
              weight: 4,
              opacity: 0.8,
              dashArray: '8, 8',
              lineCap: 'round',
              lineJoin: 'round'
            }}
          />
        );
      }

      return (
        <Polyline
          key={i}
          positions={positions}
          pathOptions={{
            color: cores.texto3,
            weight: 3,
            opacity: 0.6,
            lineCap: 'round',
            lineJoin: 'round'
          }}
        />
      );
    });
  };

  const handleCloseAlert = () => {
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    setAlertaMsg(null);
  };

  const legenda = (
    <div className="map-legend">
      <div className="map-legend-item">
        <TripOriginIcon className="map-legend-marcador" sx={{ fontSize: 16 }} />
        <span className="map-legend-label">Embarque</span>
      </div>
      <div className="map-legend-item">
        <span className="map-legend-linha" />
        <span className="map-legend-label">Rota</span>
      </div>
      <div className="map-legend-item">
        <LocationOnIcon className="map-legend-marcador" sx={{ fontSize: 16 }} />
        <span className="map-legend-label">Destino</span>
      </div>
    </div>
  );

  if (loading || reconectando) return (
    <div className="mainpage-wrapper mapa-tela" aria-busy="true">
      <div className="map-bottom-wrapper" key="esqueleto">
        <div className="map-info-card">
          <div className="map-info-row">
            <div className="map-info-left">
              <span className="map-info-title">{categoria || destino || "Rota"}</span>
              <Skeleton variant="text" width={140} sx={{ fontSize: 14 }} />
            </div>
            <div className="map-info-right">{horario}</div>
          </div>
          {legenda}
        </div>
        <Skeleton variant="rounded" height={56} sx={{ borderRadius: 'var(--raio-pill)' }} />
        <Typography variant="body2" sx={{ color: cores.texto2, textAlign: 'center' }}>
          {reconectando ? 'Reconectando...' : 'Carregando...'}
        </Typography>
      </div>
    </div>
  );

  return (
    <div className="mainpage-wrapper mapa-tela">

      {/* MAPA AO FUNDO */}
      <div className="map-container-full aparecer">
        <MapContainer center={coords[0] || [-31.76, -52.33]} zoom={15} zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_2zia_1_7597566517a627144c3ece15" />
          {renderRota()}

          {posicaoOnibus && viagemAtiva && !modoApenasConsulta && (
            <Marker position={[posicaoOnibus.lat, posicaoOnibus.lng]} icon={iconOnibus} />
          )}
          {position?.lat != null && position?.lng != null && (
            <CircleMarker center={[position.lat, position.lng]} radius={7} pathOptions={{ color: cores.texto, weight: 3, fillColor: cores.info, fillOpacity: 1 }}>
              <Popup><Typography variant="body2" sx={{ color: cores.texto, fontWeight: 500 }}>Você está aqui</Typography></Popup>
            </CircleMarker>
          )}

          {paradasTrecho.map((id, i) => {
            if (id.startsWith('int_')) return null;
            const c = getCoords(id);
            if (!c) return null;

            let icon = iconIntermediario;
            const idLower = id.toLowerCase().trim();
            if (idLower === origem?.toLowerCase().trim()) {
              icon = iconEmbarque;
            } else if (idLower === destino?.toLowerCase().trim()) {
              icon = iconDestino;
            }

            return (
              <Marker key={i} position={c} icon={icon}>
                <Popup><Typography variant="body2" sx={{ color: cores.texto, fontWeight: 500 }}>{traduzirSigla(id)}</Typography></Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* BOTÃO FECHAR/VOLTAR (X) */}
      <button type="button" className="map-top-close-btn" onClick={handleFechar} aria-label="Fechar">
        <CloseIcon sx={{ fontSize: 22 }} />
      </button>

      {/* BADGE SUPERIOR - Visto por Último */}
      {!modoApenasConsulta && viagemAtiva && (
        <div className="map-top-badge-container">
          <div className="map-top-badge">
            <span className="map-badge-title">Visto por último em</span>
            <span className="map-badge-value">{traduzirSigla(viagemAtiva.ultimaParada)}</span>
          </div>
        </div>
      )}

      {/* CONTAINER INFERIOR (Ações e Informações) */}
      <div className="map-bottom-wrapper">

        {/* BLOCO DE INFORMAÇÕES INFERIOR COM LEGENDA */}
        <div className="map-info-card">
          <div className="map-info-row">
            <div className="map-info-left">
              <span className="map-info-title">{categoria || destino || "Rota"}</span>
              <span className="map-info-subtitle">Estimativa: {estimativaTexto}</span>
            </div>
            <div className="map-info-right">
              {horario}
            </div>
          </div>

          {/* Legenda do Traçado */}
          {legenda}
        </div>

        {/* ÁREA DE AÇÕES */}
        <div className="map-actions-area aparecer">

          {/* Estado de Expulsão (Conclusão) */}
          {statusFluxo === 'expulso' && (
            <div className="expulsao-alert">
              Você foi liberado do ônibus!
            </div>
          )}

          {/* Estado de Votação de Lotação */}
          {statusFluxo === 'votando' && (
            <div className="lotacao-card">
              <Typography className="lotacao-title">Como está a lotação do ônibus?</Typography>
              <button type="button" className="btn-lotacao" onClick={() => handleVotarLotacao('vazio')}>
                <span className="status-dot" style={{ backgroundColor: cores.sucesso }} aria-hidden="true" />
                Vazio
              </button>
              <button type="button" className="btn-lotacao" onClick={() => handleVotarLotacao('medio')}>
                <span className="status-dot" style={{ backgroundColor: cores.alerta }} aria-hidden="true" />
                Médio
              </button>
              <button type="button" className="btn-lotacao" onClick={() => handleVotarLotacao('lotado')}>
                <span className="status-dot" style={{ backgroundColor: cores.perigo }} aria-hidden="true" />
                Lotado
              </button>
            </div>
          )}

          {/* Badges de Status */}
          <div className="dark-status-chips">
            {infoLotacao && statusFluxo !== 'votando' && (
              <Chip
                icon={<span className="status-dot" style={{ backgroundColor: infoLotacao.cor, marginLeft: 10 }} aria-hidden="true" />}
                label={`${infoLotacao.label} (${infoLotacao.media})`}
                size="small"
              />
            )}
            {statusFluxo === 'rastreando' && isRastreador && (
              <Chip icon={<DirectionsBusIcon sx={{ fontSize: 14 }} />} label="Rastreando" size="small" />
            )}
          </div>

          {/* Botão de Embarque Inicial */}
          {!modoApenasConsulta && statusFluxo === 'inicial' && (
            <Box sx={{ width: '100%' }}>
              {embarqueAutomaticoAtivo && statusEmbarqueAuto === 'proximo' && velocidadeAuto < 1 && tempoRestante && (
                <Box sx={{ mb: 1.5 }}>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="body2" sx={{ color: cores.sucesso, fontWeight: 500 }}>
                        Embarque em {Math.ceil(tempoRestante / 1000)}s...
                      </Typography>
                    </Stack>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(progressoEmbarque, 100)}
                      sx={{ height: 4, borderRadius: 2, bgcolor: cores.superficie2, '& .MuiLinearProgress-bar': { bgcolor: cores.sucesso } }}
                    />
                  </Stack>
                </Box>
              )}

              {/* BOTÃO DISTANCIA PARADA METROS */}
              <Button
                variant="contained"
                size="large"
                fullWidth
                disabled={embarcando || (distanciaAteParada || distanciaAuto || 999) > 50}
                onClick={async () => { if (embarqueAutomaticoAtivo) setEmbarqueAutomaticoAtivo(false); await handleConfirmarEmbarque(); }}
              >
                {embarcando ? 'Processando...' : ((distanciaAteParada || distanciaAuto || 999) > 50 ? `Longe (${Math.round(distanciaAteParada || distanciaAuto || 0)}m)` : (embarqueAutomaticoAtivo && statusEmbarqueAuto === 'proximo' ? `Aguardando (${Math.ceil(tempoRestante / 1000)}s)...` : 'Confirmar Embarque'))}
              </Button>
            </Box>
          )}
        </div>

      </div>

      {/* SNACKBAR DE ALERTAS */}
      <Snackbar open={!!alertaMsg} autoHideDuration={4000} onClose={handleCloseAlert} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} sx={{ mt: 10 }}>
        <Alert onClose={handleCloseAlert} severity={alertaMsg?.severidade || 'info'} sx={{ width: '100%' }}>
          {alertaMsg?.texto}
        </Alert>
      </Snackbar>
    </div>
  );
}