// components/MainPage.jsx
// COMPONENTE PRINCIPAL DE VIAGEM - Gerencia embarque, rastreamento e visualização da rota

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, serverTimestamp, onSnapshot, deleteDoc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { Box, Button, Typography, Paper, CircularProgress, Stack, Chip, IconButton, Snackbar, Alert, LinearProgress } from '@mui/material';
import { traduzirSigla } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import { useLocation as useGeoLocation } from '../hooks/useLocation';
import { useRastreamento } from '../hooks/useRastreamento';
import { 
  entrarNaViagem, 
  calcularHorarioChegadaOnibusAteVoce,
  calcularHorarioEstimadoParada,
  calcularTempoParaOnibusChegarAteVoce, 
  calcularTempoRestanteAteDestino
} from '../services/transporteService';
import { usePersistViagem } from '../hooks/usePersistViagem';
import { useEmbarqueAutomatico } from '../hooks/useEmbarqueAutomatico';
import { usePageVisibility } from '../hooks/usePageVisibility';
import { getAuth } from 'firebase/auth';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import 'leaflet/dist/leaflet.css';

// ==================== CONSTANTES E CONFIGURAÇÕES ====================

const iconEmbarque = new L.Icon({ 
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', 
  iconSize: [25, 41], 
  iconAnchor: [12, 41], 
  popupAnchor: [1, -34]
});

const iconIntermediario = new L.DivIcon({ 
  className: 'custom-stop-icon', 
  html: `<div style="background-color: white; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #154370;"></div>`, 
  iconSize: [14, 14], 
  iconAnchor: [7, 7] 
});

const iconOnibus = new L.DivIcon({
  className: 'custom-bus-icon',
  html: `<div style="
    background-color: #00418F; 
    width: 20px; 
    height: 20px; 
    border-radius: 50%; 
    border: 3px solid white;
    box-shadow: 0 0 10px rgba(0,65,143,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    color: white;
  ">🚌</div>`,
  iconSize: [20, 20],
  iconAnchor: [10, 10]
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

  // ==================== FUNÇÃO PARA CALCULAR HORÁRIO DE CHEGADA DO ÔNIBUS ====================
  
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
        itinerario.id,
        paradasLista,
        horario,
        origem,
        indiceAtualOnibus
      );
      
      if (resultado) {
        setHorarioChegadaOnibus(resultado);
      }
    } catch (error) {
      console.warn("Erro ao calcular horário de chegada do ônibus:", error);
    } finally {
      setCarregandoEstimativa(false);
    }
  }, [itinerario, horario, origem, paradasData, modoApenasConsulta, statusFluxo, viagemAtiva]);

  // Calcular quando os dados estiverem prontos
  useEffect(() => {
    if (itinerario && horario && origem && Object.keys(paradasData).length > 0) {
      calcularHorarioChegadaOnibus();
    }
  }, [itinerario, horario, origem, paradasData, calcularHorarioChegadaOnibus]);

  // Recalcular quando a viagem ativa mudar (ônibus se moveu)
  useEffect(() => {
    if (viagemAtiva && !modoApenasConsulta && statusFluxo === 'inicial') {
      const timer = setTimeout(() => {
        calcularHorarioChegadaOnibus();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [viagemAtiva, calcularHorarioChegadaOnibus, modoApenasConsulta, statusFluxo]);

  // ==================== FUNÇÃO PARA CALCULAR HORÁRIO ESTIMADO AO DESTINO ====================
  
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
        itinerario.id,
        paradasLista,
        horario,
        destino
      );
      
      if (resultado) {
        setHorarioEstimadoDestino(resultado);
      }
    } catch (error) {
      console.warn("Erro ao calcular horário estimado:", error);
    } finally {
      setCarregandoEstimativa(false);
    }
  }, [itinerario, horario, destino, paradasData, modoApenasConsulta, statusFluxo]);

  useEffect(() => {
    if (itinerario && horario && destino && Object.keys(paradasData).length > 0 && statusFluxo !== 'inicial') {
      calcularHorarioDestino();
    }
  }, [itinerario, horario, destino, paradasData, statusFluxo, calcularHorarioDestino]);

  // ==================== FUNÇÃO PARA CALCULAR ESTIMATIVAS DE TEMPO ====================
  
  const calcularEstimativas = useCallback(async () => {
    if (!viagemAtiva || !itinerario || !horario || modoApenasConsulta) return;
    if (!origem && !destino) return;
    
    setCarregandoTempo(true);
    try {
      if (statusFluxo === 'inicial' && origem) {
        const resultado = await calcularTempoParaOnibusChegarAteVoce(
          viagemAtiva,
          itinerario,
          origem,
          horario
        );
        if (resultado) {
          setTempoParaOnibusChegar(resultado);
          setTempoAteDestino(null);
        }
      } else if (statusFluxo !== 'inicial' && destino) {
        const resultado = await calcularTempoRestanteAteDestino(
          viagemAtiva,
          itinerario,
          destino,
          horario
        );
        if (resultado) {
          setTempoAteDestino(resultado);
          setTempoParaOnibusChegar(null);
        }
      }
    } catch (error) {
      console.warn("Erro ao calcular estimativas:", error);
    } finally {
      setCarregandoTempo(false);
    }
  }, [viagemAtiva, itinerario, horario, origem, destino, statusFluxo, modoApenasConsulta]);

  useEffect(() => {
    if (viagemAtiva && itinerario && horario) {
      calcularEstimativas();
    }
  }, [viagemAtiva, itinerario, horario, origem, destino, statusFluxo, calcularEstimativas]);

  // Recalcular quando a viagem ativa mudar
  useEffect(() => {
    if (viagemAtiva && !modoApenasConsulta) {
      const timer = setTimeout(() => {
        calcularHorarioChegadaOnibus();
        calcularHorarioDestino();
        calcularEstimativas();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [viagemAtiva, calcularHorarioChegadaOnibus, calcularHorarioDestino, calcularEstimativas, modoApenasConsulta]);

  // ==================== FUNÇÃO DE EMBARQUE ====================
  
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
      
      let melhorOrigem = -1;
      let melhorDestino = -1;
      let menorDistancia = Infinity;
      
      for (const o of idxsOrigem) {
        for (const d of idxsDestino) {
          if (o < d && (d - o) < menorDistancia) {
            menorDistancia = d - o;
            melhorOrigem = o;
            melhorDestino = d;
          }
        }
      }
      
      if (melhorOrigem === -1 || melhorDestino === -1) {
        setAlertaMsg({ texto: 'Parada não encontrada no itinerário.', severidade: 'error' });
        return;
      }
      
      const meuIndiceAtual = melhorOrigem;
      const isUltimaParada = meuIndiceAtual === paradasNormalizadas.length - 1;
      
      if (isUltimaParada) {
        setAlertaMsg({ texto: 'Você está na última parada. Não é possível embarcar.', severidade: 'warning' });
        return;
      }
      
      let papel;
      try {
        papel = await entrarNaViagem(tripId, usuario, origem, destino, itinerario);
        console.log("[Embarque] Papel retornado:", papel);
      } catch (e) {
        console.error("[Embarque] Erro ao entrar na viagem:", e);
        setAlertaMsg({ texto: 'Erro ao confirmar embarque: ' + e.message, severidade: 'error' });
        return;
      }
      
      if (papel === 'bloqueado') {
        setAlertaMsg({ texto: 'Você já está em outra viagem ativa!', severidade: 'warning' });
        return;
      }
      
      await setDoc(doc(db, "viagens_ativas", tripId), {
        ultimaParada: origem,
        indiceParada: meuIndiceAtual,
        atualizadoEm: serverTimestamp(),
      }, { merge: true });
      
      const isRastreador = papel === 'rastreador' || papel === 'reserva_prioritaria';
      setIsRastreador(isRastreador);
      setStatusFluxo('votando');
      setAlertaMsg({ texto: `✅ Embarque confirmado! Você está no ônibus para ${traduzirSigla(destino)}.`, severidade: 'success' });
      
    } catch (error) {
      console.error("[Embarque] Erro geral:", error);
      setAlertaMsg({ texto: 'Erro ao confirmar embarque. Tente novamente.', severidade: 'error' });
    } finally {
      setEmbarcando(false);
    }
  }, [auth, itinerario, origem, destino, tripId, setIsRastreador, setStatusFluxo, embarcando]);

  // ==================== EMBARQUE AUTOMÁTICO ====================
  
  const { status: statusEmbarqueAuto, distancia: distanciaAuto, velocidade: velocidadeAuto, tempoRestante } = useEmbarqueAutomatico({
    ativo: embarqueAutomaticoAtivo && !modoApenasConsulta && statusFluxo === 'inicial' && !!position && !!coordsParadaOrigem,
    position,
    paradaOrigem: origem,
    paradaCoords: coordsParadaOrigem,
    onEmbarqueConfirmado: async () => {
      setAlertaMsg({ texto: `Embarque automático detectado! Você está no ônibus para ${traduzirSigla(destino)}.`, severidade: 'success' });
      setTimeout(() => setAlertaMsg(null), 5000);
      await handleConfirmarEmbarque();
      setEmbarqueAutomaticoAtivo(false);
    },
  });

  // ==================== PERSISTÊNCIA ====================
  
  useEffect(() => {
    if (statusFluxo !== 'inicial' && statusFluxo !== 'expulso' && tripId) {
      setViagemIdPersistida(tripId);
    }
  }, [statusFluxo, tripId, setViagemIdPersistida]);

  // ==================== CARREGAMENTO DE DADOS ====================
  
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
        if (dados.lat && dados.lng) {
          setPosicaoOnibus({ lat: dados.lat, lng: dados.lng });
        }
      } else {
        setViagemAtiva(null);
        setPosicaoOnibus(null);
      }
    });
    
    return () => { mounted = false; unsub(); };
  }, [tripId]);

  useEffect(() => {
    const carregarGeometriasFixas = async () => {
      if (!itinerario?.id) return;
      
      const paradasLista = itinerario.paradas.map(p => 
        (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
      );
      
      const geometrias = {};
      
      for (let i = 0; i < paradasLista.length - 1; i++) {
        const paradaA = paradasLista[i];
        const paradaB = paradasLista[i + 1];
        const docId = `${itinerario.id}_${paradaA}-${paradaB}`;
        
        try {
          const docSnap = await getDoc(doc(db, "rotas_geometricas", docId));
          if (docSnap.exists()) {
            const geo = docSnap.data().geometria;
            if (geo && geo.length >= 2) {
              geometrias[docId] = geo;
            }
          }
        } catch (err) {
          console.error(`Erro ao carregar ${docId}:`, err);
        }
      }
      
      setGeometriaRotas(geometrias);
    };
    
    carregarGeometriasFixas();
  }, [itinerario]);

  useEffect(() => {
    const carregarRotasTempo = async () => {
      if (!itinerario?.id) return;
      
      const paradasLista = itinerario.paradas.map(p => 
        (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
      );
      
      const tempos = {};
      
      for (let i = 0; i < paradasLista.length - 1; i++) {
        const paradaA = paradasLista[i];
        const paradaB = paradasLista[i + 1];
        const docId = `${itinerario.id}_${paradaA}-${paradaB}`;
        
        const docSnap = await getDoc(doc(db, "rotas_aprendidas", docId));
        if (docSnap.exists()) {
          tempos[docId] = {
            tempoMedioSegundos: docSnap.data().tempoMedioSegundos || 180,
            totalAmostras: docSnap.data().totalAmostras || 0
          };
        } else {
          tempos[docId] = { tempoMedioSegundos: 180, totalAmostras: 0 };
        }
      }
      
      setRotasAprendidas(tempos);
    };
    
    carregarRotasTempo();
  }, [itinerario]);

  // ==================== RECONEXÃO E VALIDAÇÕES ====================
  
  useEffect(() => {
    const agora = Date.now();
    const deveReconectar = isPageVisible && statusFluxo !== 'inicial' && statusFluxo !== 'expulso' && !reconectando && (agora - ultimaReconexaoRef.current) > 5000;
    
    if (deveReconectar) {
      ultimaReconexaoRef.current = agora;
      setReconectando(true);
      getDoc(doc(db, "viagens_ativas", tripId))
        .then(snap => {
          if (snap.exists()) {
            const dados = snap.data();
            setViagemAtiva(dados);
            if (dados.lat && dados.lng) {
              setPosicaoOnibus({ lat: dados.lat, lng: dados.lng });
            }
          }
          setReconectando(false);
        })
        .catch(() => setReconectando(false));
    }
  }, [isPageVisible, statusFluxo, tripId, reconectando]);

  useEffect(() => {
    const oriKey = origem?.toLowerCase().trim();
    if (position && paradasData[oriKey]) {
      const coords = getCoords(oriKey);
      if (coords) {
        setDistanciaAteParada(calculateDistance(position.lat, position.lng, coords[0], coords[1]));
      }
    }
  }, [position, paradasData, origem, getCoords]);

  useEffect(() => {
    if (modoApenasConsulta || !itinerario?.duracaoEstimada || !horario) return;
    
    const verificarExpiracao = async () => {
      const [horas, minutos] = horario.split(':').map(Number);
      const agora = new Date();
      const horarioInicio = new Date();
      horarioInicio.setHours(horas, minutos, 0, 0);
      const horarioTermino = new Date(horarioInicio.getTime() + (itinerario.duracaoEstimada + 10) * 60000);
      
      if (agora > horarioTermino) {
        await deleteDoc(doc(db, "viagens_ativas", tripId));
        voltar();
      }
    };
    
    verificarExpiracao();
    const interval = setInterval(verificarExpiracao, 60000);
    return () => clearInterval(interval);
  }, [itinerario, horario, voltar, modoApenasConsulta, tripId]);

  // ==================== FUNÇÕES DE INTERAÇÃO DO USUÁRIO ====================
  
  const handleExpulsar = useCallback((motivo) => {
    const mensagens = { 
      destino: 'Você chegou ao destino! Boa aula!',
      desvio: 'Você saiu da rota. Viagem encerrada.',
      rebaixado: 'Outro passageiro assumiu o rastreamento.',
      cancelada: 'Viagem encerrada pelo sistema.'
    };
    setAlertaMsg({ texto: mensagens[motivo] || 'Viagem encerrada.', severidade: motivo === 'destino' ? 'success' : 'warning' });
    setStatusFluxo('expulso');
    setTimeout(() => voltar(), 3000);
  }, [voltar, setStatusFluxo]);

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
    isRastreador,
    viagemId: tripId,
    itinerario,
    horario,
    paradaOrigem: origem || '',
    paradaDestino: destino || '',
    paradasData,
    rotasAprendidas,
    onExpulsar: handleExpulsar,
    onReativarGpsPassageiro: () => {
      if (!isRastreador && statusFluxo === 'rastreando' && !gpsPassageiroAtivo) {
        setGpsPassageiroAtivo(true);
        setAlertaMsg({ 
          texto: `Atenção! Você está chegando perto do seu destino (${traduzirSigla(destino)}). Prepare-se para descer.`, 
          severidade: 'info' 
        });
        setTimeout(() => setAlertaMsg(null), 5000);
      }
    },
  });

  // ==================== FUNÇÕES DE FORMATAÇÃO E CÁLCULO ====================
  
  const formatarRelativo = (timestamp) => {
    if (!timestamp) return "...";
    const agora = new Date();
    const dataPost = timestamp.toDate();
    const difSegundos = Math.floor((agora - dataPost) / 1000);
    if (difSegundos < 60) return "Agora mesmo";
    return `Há ${Math.floor(difSegundos / 60)} min`;
  };

  const infoLotacao = useMemo(() => {
    if (!viagemAtiva?.historicoLotacao || viagemAtiva.historicoLotacao.length === 0) return null;
    
    const agoraMs = Date.now();
    const cincoMinutosMs = 5 * 60 * 1000;
    
    const votosRecentes = viagemAtiva.historicoLotacao.filter(voto => {
      const dataVoto = voto.data?.toDate ? voto.data.toDate().getTime() : (voto.data?.seconds * 1000 || agoraMs);
      return (agoraMs - dataVoto) <= cincoMinutosMs;
    });
    
    if (votosRecentes.length === 0) return null;
    
    const soma = votosRecentes.reduce((acc, curr) => acc + curr.valor, 0);
    const media = parseFloat((soma / votosRecentes.length).toFixed(1));
    
    let label = "Vazio", cor = "#0EA503";
    if (media > 4.0) { label = "Lotado"; cor = "#C4151C"; }
    else if (media > 2.5) { label = "Médio"; cor = "#FF8A31"; }
    
    return { media, label, cor };
  }, [viagemAtiva]);

  const paradasTrecho = useMemo(() => {
    if (!itinerario?.paradas) return [];
    
    const lista = itinerario.paradas.map(p => 
      (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
    );
    
    if (modoApenasConsulta) return lista;
    
    const origemNormalizada = origem?.toLowerCase().trim();
    const destinoNormalizada = destino?.toLowerCase().trim();
    
    if (!origemNormalizada || !destinoNormalizada) return lista;
    
    const idxsO = [];
    const idxsD = [];
    lista.forEach((p, i) => {
      if (p === origemNormalizada) idxsO.push(i);
      if (p === destinoNormalizada) idxsD.push(i);
    });
    
    let melhorDiff = Infinity;
    let melhorIdxO = -1, melhorIdxD = -1;
    for (const o of idxsO) {
      for (const d of idxsD) {
        if (o < d && (d - o) < melhorDiff) {
          melhorDiff = d - o;
          melhorIdxO = o;
          melhorIdxD = d;
        }
      }
    }
    
    if (melhorIdxO !== -1 && melhorIdxD !== -1) {
      return lista.slice(melhorIdxO, melhorIdxD + 1);
    }
    
    return lista;
  }, [itinerario, origem, destino, modoApenasConsulta]);

  const coords = useMemo(() => paradasTrecho.map(getCoords).filter(c => c !== null), [paradasTrecho, getCoords]);

  const progressoEmbarque = useMemo(() => {
    if (statusEmbarqueAuto !== 'proximo' || !tempoRestante) return 0;
    return ((TEMPO_CONFIRMACAO_MS - tempoRestante) / TEMPO_CONFIRMACAO_MS) * 100;
  }, [statusEmbarqueAuto, tempoRestante]);

  // ==================== RENDERIZAÇÃO DO MAPA ====================
  
  const renderGradiente = () => {
    if (paradasTrecho.length < 2) return null;
    
    return paradasTrecho.map((id, i) => {
      if (i === paradasTrecho.length - 1) return null;
      
      const idA = id;
      const idB = paradasTrecho[i + 1];
      const chave = `${itinerario.id}_${idA}-${idB}`;
      
      let geometria = geometriaRotas[chave];
      
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
      
      const distInicio = calculateDistance(c1[0], c1[1], positions[0][0], positions[0][1]);
      if (distInicio > 20) {
        positions = [c1, ...positions];
      }
      
      const distFim = calculateDistance(c2[0], c2[1], positions[positions.length-1][0], positions[positions.length-1][1]);
      if (distFim > 20) {
        positions = [...positions, c2];
      }
      
      const totalTrechos = paradasTrecho.length - 1;
      const ratio = i / totalTrechos; 
      
      const r = Math.round(14 + (255 - 14) * ratio);
      const g = Math.round(165 - (165 - 3) * ratio);
      const b = Math.round(3 + (49 - 3) * ratio);
      
      return (
        <Polyline 
          key={i} 
          positions={positions} 
          pathOptions={{ 
            color: `rgb(${r},${g},${b})`, 
            weight: isEstimada ? 2 : 6, 
            opacity: isEstimada ? 0.4 : 0.6,
            dashArray: isEstimada ? '8, 6' : undefined,
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

  // ==================== RENDERIZAÇÃO CONDICIONAL ====================
  
  if (loading || reconectando) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <CircularProgress />
      <Typography variant="body2" color="textSecondary">{reconectando ? 'Reconectando...' : 'Carregando...'}</Typography>
    </Box>
  );

  // ==================== RENDERIZAÇÃO PRINCIPAL ====================
  return (
    <Box sx={{ height: '100dvh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      
      {/* HEADER */}
      <Paper elevation={2} sx={{ pt: 'calc(15px + env(safe-area-inset-top))', pb: 2, zIndex: 1100, borderRadius: 0, backgroundColor: '#f9f9f9', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <Typography variant="h6" fontWeight="bold" color="primary">{categoria || "Rota"} - {horario}</Typography>
        
        {!modoApenasConsulta && (
          <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
            {viagemAtiva ? (
              <>Visto em: <b>{traduzirSigla(viagemAtiva.ultimaParada)}</b> {formatarRelativo(viagemAtiva.atualizadoEm)}</>
            ) : "Aguardando atualização..."}
          </Typography>
        )}
        
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          
          {/* TEMPO PARA ÔNIBUS CHEGAR ATÉ VOCÊ (antes de embarcar) */}
          {statusFluxo === 'inicial' && tempoParaOnibusChegar && !modoApenasConsulta && !carregandoTempo && (
            <Chip 
              icon={<AccessTimeIcon sx={{ fontSize: 14 }} />} 
              label={`🚌 Chega em ${tempoParaOnibusChegar.minutos} min`}
              color="primary" 
              size="small" 
              sx={{ fontWeight: 'bold' }} 
            />
          )}
          
          {/* TEMPO PARA CHEGAR AO DESTINO (após embarcar) */}
          {statusFluxo !== 'inicial' && tempoAteDestino && !modoApenasConsulta && !carregandoTempo && (
            <Chip 
              icon={<AccessTimeIcon sx={{ fontSize: 14 }} />} 
              label={`Chegada em ${tempoAteDestino.minutos} min`}
              color="secondary" 
              size="small" 
              sx={{ fontWeight: 'bold' }} 
            />
          )}
          
          {carregandoTempo && !modoApenasConsulta && (
            <Chip 
              label="⏳ Calculando..." 
              size="small" 
              sx={{ fontWeight: 'bold', bgcolor: '#FFF3E0', color: '#E65100' }} 
            />
          )}
          
          {/* HORÁRIO DE CHEGADA DO ÔNIBUS ATÉ VOCÊ (antes de embarcar) */}
          {!modoApenasConsulta && horarioChegadaOnibus && !carregandoEstimativa && statusFluxo === 'inicial' && horarioChegadaOnibus.status === 'chegando' && (
            <Chip 
              label={`⏰ Ônibus chega às ${horarioChegadaOnibus.horarioEstimado}`} 
              size="small" 
              sx={{ 
                fontWeight: 'bold', 
                bgcolor: '#E3F2FD', 
                color: '#0D47A1',
                '& .MuiChip-label': { fontWeight: 'bold' }
              }} 
            />
          )}
          
          {/* HORÁRIO ESTIMADO DE CHEGADA AO DESTINO (após embarcar) */}
          {!modoApenasConsulta && horarioEstimadoDestino && !carregandoEstimativa && statusFluxo !== 'inicial' && (
            <Chip 
              label={`⏰ Previsto destino: ${horarioEstimadoDestino.horarioEstimado}`} 
              size="small" 
              sx={{ 
                fontWeight: 'bold', 
                bgcolor: '#E8F5E9', 
                color: '#2E7D32',
                '& .MuiChip-label': { fontWeight: 'bold' }
              }} 
            />
          )}
          
          {carregandoEstimativa && !modoApenasConsulta && (
            <Chip 
              label="⏰ Calculando..." 
              size="small" 
              sx={{ fontWeight: 'bold', bgcolor: '#FFF3E0', color: '#E65100' }} 
            />
          )}
          
          {infoLotacao && (
            <Chip label={`${infoLotacao.label} (${infoLotacao.media})`} size="small" sx={{ fontWeight: 'bold', color: 'white', backgroundColor: infoLotacao.cor }} />
          )}
          {statusFluxo === 'rastreando' && isRastreador && (
            <Chip icon={<DirectionsBusIcon sx={{ fontSize: 14 }} />} label="Rastreando" size="small" sx={{ fontWeight: 'bold', bgcolor: '#00418F', color: 'white' }} />
          )}
          {!isPageVisible && statusFluxo === 'rastreando' && (
            <Chip label="App em segundo plano" size="small" sx={{ fontWeight: 'bold', bgcolor: '#FF8A31', color: 'white' }} />
          )}
        </Stack>

        {!modoApenasConsulta && (
          <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'green' }} />
              <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666' }}>INÍCIO</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'red' }} />
              <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666' }}>FIM</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 16, height: 3, borderTop: '3px dashed #999' }} />
              <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#999' }}>estimada</Typography>
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 16, height: 3, bgcolor: '#999' }} />
              <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#999' }}>real</Typography>
            </Box>
          </Stack>
        )}
      </Paper>
      
      {/* MAPA */}
      <Box sx={{ flexGrow: 1, position: 'relative', width: '100%' }}>
        <IconButton onClick={voltar} sx={{ position: 'absolute', top: 16, left: 16, zIndex: 1100, bgcolor: 'white', boxShadow: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        
        <MapContainer center={coords[0] || [-31.76, -52.33]} zoom={15} zoomControl={false} style={{ height: '100%', width: '100%', zIndex: 1 }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
          {renderGradiente()}
          
          {posicaoOnibus && viagemAtiva && !modoApenasConsulta && (
            <Marker 
              position={[posicaoOnibus.lat, posicaoOnibus.lng]} 
              icon={iconOnibus}
            >
              <Popup>
                <Typography variant="body2" fontWeight="bold">
                  🚌 Ônibus em movimento
                  {viagemAtiva.velocidade !== undefined && (
                    <Typography variant="caption" display="block" color="textSecondary">
                      {viagemAtiva.velocidade} km/h
                    </Typography>
                  )}
                </Typography>
              </Popup>
            </Marker>
          )}
          
          {paradasTrecho.map((id, i) => {
            if (id.startsWith('int_')) return null;
            const c = getCoords(id);
            if (!c) return null;
            return (
              <Marker 
                key={i} 
                position={c} 
                icon={id === origem?.toLowerCase().trim() ? iconEmbarque : iconIntermediario}
              >
                <Popup><Typography variant="body2" fontWeight="bold">{traduzirSigla(id)}</Typography></Popup>
              </Marker>
            );
          })}
        </MapContainer>
        
        {/* BOTÕES DE AÇÃO */}
<Box sx={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 1100, width: '90%', maxWidth: '400px', pointerEvents: 'none' }}>
  <Box sx={{ pointerEvents: 'auto' }}>
    
    {!modoApenasConsulta && statusFluxo === 'inicial' && (
      <Box sx={{ width: '100%' }}>
        {/* Barra de progresso do embarque automático - só mostra se estiver "proximo" e parado */}
        {embarqueAutomaticoAtivo && statusEmbarqueAuto === 'proximo' && velocidadeAuto < 1 && tempoRestante && (
          <Paper elevation={3} sx={{ mb: 1.5, p: 1.5, borderRadius: '16px', bgcolor: '#f0f7ff' }}>
            <Stack spacing={1}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={16} sx={{ color: '#0EA503' }} />
                  <Typography variant="caption" color="secondary" fontWeight="bold">
                    Embarque em {Math.ceil(tempoRestante / 1000)}s...
                  </Typography>
                </Box>
                <Typography variant="caption" fontWeight="bold" sx={{ color: '#00418F' }}>
                  {velocidadeAuto.toFixed(1)} km/h
                </Typography>
              </Stack>
              <LinearProgress 
                variant="determinate" 
                value={Math.min(progressoEmbarque, 100)} 
                sx={{ 
                  height: 6, 
                  borderRadius: 3, 
                  bgcolor: '#e0e0e0', 
                  '& .MuiLinearProgress-bar': { bgcolor: '#0EA503' } 
                }} 
              />
            </Stack>
          </Paper>
        )}
        
        <Button 
          variant="contained" 
          disabled={embarcando || (distanciaAteParada || distanciaAuto || 999) > 50} 
          onClick={async () => { 
            if (embarqueAutomaticoAtivo) setEmbarqueAutomaticoAtivo(false); 
            await handleConfirmarEmbarque(); 
          }} 
          sx={{ borderRadius: '50px', bgcolor: '#C4151C', color: 'white', width: '100%', height: '60px', fontWeight: 'bold', boxShadow: 3 }}
        >
          {embarcando 
            ? 'Processando...' 
            : ((distanciaAteParada || distanciaAuto || 999) > 50 
                ? `Longe (${Math.round(distanciaAteParada || distanciaAuto || 0)}m)` 
                : (embarqueAutomaticoAtivo && statusEmbarqueAuto === 'proximo' 
                    ? `Aguardando (${Math.ceil(tempoRestante / 1000)}s)...` 
                    : 'Confirmar Embarque Manual'))}
        </Button>
        
        {statusEmbarqueAuto !== 'confirmado' && (
          <Button size="small" onClick={() => setEmbarqueAutomaticoAtivo(!embarqueAutomaticoAtivo)} sx={{ mt: 1, textTransform: 'none', color: '#00418F', width: '100%' }}>
            {embarqueAutomaticoAtivo ? 'Usar embarque manual' : 'Reativar embarque automático'}
          </Button>
        )}
      </Box>
    )}
            
            {statusFluxo === 'votando' && (
              <Paper elevation={4} sx={{ p: 2, borderRadius: '15px', textAlign: 'center' }}>
                <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1.5 }}>Lotação do Ônibus:</Typography>
                <Stack direction="row" spacing={1} justifyContent="center">
                  <Button size="small" variant="contained" sx={{ bgcolor: '#0EA503' }} onClick={() => handleVotarLotacao('vazio')}>Vazio</Button>
                  <Button size="small" variant="contained" sx={{ bgcolor: '#FF8A31' }} onClick={() => handleVotarLotacao('medio')}>Médio</Button>
                  <Button size="small" variant="contained" sx={{ bgcolor: '#C4151C' }} onClick={() => handleVotarLotacao('lotado')}>Cheio</Button>
                </Stack>
              </Paper>
            )}
            
            {statusFluxo === 'rastreando' && (
              <Paper elevation={2} sx={{ p: 1.5, borderRadius: '15px', textAlign: 'center', bgcolor: 'rgba(255,255,255,0.92)' }}>
                <Typography variant="caption" color="textSecondary">
                  {isRastreador ? 'Você está contribuindo com a rota em tempo real' : gpsPassageiroAtivo ? 'GPS ativado para desembarque' : 'Acompanhando o ônibus...'}
                </Typography>
              </Paper>
            )}
          </Box>
        </Box>
      </Box>
      
      <Snackbar open={!!alertaMsg} autoHideDuration={4000} onClose={handleCloseAlert} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={handleCloseAlert} severity={alertaMsg?.severidade || 'info'} sx={{ width: '100%', fontWeight: 'bold' }}>
          {alertaMsg?.texto}
        </Alert>
      </Snackbar>
    </Box>
  );
}