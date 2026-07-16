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
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import 'leaflet/dist/leaflet.css';
import './MainPage.css';

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

const iconDestino = new L.DivIcon({ 
  className: 'custom-stop-icon', 
  html: `<div style="background-color: #0EA503; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #0EA503;"></div>`, 
  iconSize: [14, 14], 
  iconAnchor: [7, 7] 
});

const iconOnibus = new L.DivIcon({
  className: 'custom-bus-icon',
  html: `<div style="
    background-color: #1E58FF; 
    width: 20px; 
    height: 20px; 
    border-radius: 50%; 
    border: 3px solid white;
    box-shadow: 0 0 10px rgba(30,88,255,0.5);
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
        const resultado = await calcularTempoParaOnibusChegarAteVoce(
          viagemAtiva, itinerario, origem, horario
        );
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
  }, [viagemAtiva, itinerario, horario, origem, destino, statusFluxo, modoApenasConsulta]);

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
        } catch (err) {}
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

  const handleExpulsar = useCallback((motivo) => {
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
      return (agoraMs - dataVoto) <= 5 * 60 * 1000;
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
  const estimativaTexto = useMemo(() => {
    if (carregandoTempo) return "Calculando...";
    if (statusFluxo === 'inicial' && tempoParaOnibusChegar) return `${tempoParaOnibusChegar.minutos} min`;
    if (statusFluxo !== 'inicial' && tempoAteDestino) return `${tempoAteDestino.minutos} min`;
    return "--";
  }, [carregandoTempo, statusFluxo, tempoParaOnibusChegar, tempoAteDestino]);

  // ==================== RENDER DOS TRAÇOS DO MAPA COM GRADIENTE ====================
  const renderGradiente = () => {
    if (paradasTrecho.length < 2) return null;
    
    // Determinar índices de origem e destino
    const oriIdx = origem ? paradasTrecho.findIndex(p => p === origem.toLowerCase().trim()) : -1;
    const dstIdx = destino ? paradasTrecho.findIndex(p => p === destino.toLowerCase().trim()) : -1;
    
    // Se não tiver origem e destino definidos, usar toda a rota
    const startIdx = (oriIdx !== -1 && dstIdx !== -1) ? oriIdx : 0;
    const endIdx = (oriIdx !== -1 && dstIdx !== -1) ? dstIdx : paradasTrecho.length - 1;
    const totalTramos = endIdx - startIdx;
    
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
      
      // Determinar se este trecho está entre origem e destino
      const isActiveSegment = (oriIdx !== -1 && dstIdx !== -1) 
        ? (i >= oriIdx && i < dstIdx)
        : true; // Se não tem origem/destino, mostrar toda a rota
      
      // Calcular cor baseada na posição no trecho (gradiente vermelho -> verde)
      let cor = '#444444';
      let weight = 2;
      let opacity = 0.3;
      
      if (isActiveSegment) {
        // Calcular progresso apenas nos trechos ativos
        const progresso = totalTramos > 0 ? (i - startIdx) / totalTramos : 0;
        
        // Gradiente direto: vermelho (início) -> verde (fim)
        // Usando interpolação linear simples entre vermelho e verde
        const r = Math.round(255 * (1 - progresso));
        const g = Math.round(255 * progresso);
        const b = 0; // Sem azul para gradiente puro vermelho->verde
        
        cor = `rgb(${r}, ${g}, ${b})`;
        weight = isEstimada ? 4 : 6;
        opacity = 0.5;
      }
      
      return (
        <Polyline 
          key={i} 
          positions={positions} 
          pathOptions={{ 
            color: cor,
            weight: weight,
            opacity: opacity,
            dashArray: isEstimada && isActiveSegment ? '10, 8' : undefined,
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

  if (loading || reconectando) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 2, bgcolor: '#1A1A1A' }}>
      <CircularProgress />
      <Typography variant="body2" color="#A1A1AA">{reconectando ? 'Reconectando...' : 'Carregando...'}</Typography>
    </Box>
  );

  return (
    <div className="mainpage-wrapper">
      
      {/* MAPA AO FUNDO */}
      <div className="map-container-full">
        <MapContainer center={coords[0] || [-31.76, -52.33]} zoom={15} zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
          {renderGradiente()}
          
          {posicaoOnibus && viagemAtiva && !modoApenasConsulta && (
            <Marker position={[posicaoOnibus.lat, posicaoOnibus.lng]} icon={iconOnibus} />
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
                <Popup><Typography variant="body2" fontWeight="bold" sx={{ color: 'black' }}>{traduzirSigla(id)}</Typography></Popup>
              </Marker>
            );
          })}
        </MapContainer>
      </div>

      {/* BOTÃO FECHAR/VOLTAR (X) */}
      <button className="map-top-close-btn" onClick={voltar}>
        X
      </button>

      {/* BADGE SUPERIOR - Visto por Último */}
      {!modoApenasConsulta && viagemAtiva && (
        <div className="map-top-badge-container">
          <div className="map-top-badge">
            <span className="map-badge-title">Visto por Último em:</span>
            <span className="map-badge-value">{traduzirSigla(viagemAtiva.ultimaParada)}</span>
          </div>
        </div>
      )}

      {/* CONTAINER INFERIOR (Ações e Informações) */}
      <div className="map-bottom-wrapper">
        
        {/* ÁREA DE AÇÕES */}
        <div className="map-actions-area">
          
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
              <button className="btn-lotacao vazio" onClick={() => handleVotarLotacao('vazio')}>Vazio</button>
              <button className="btn-lotacao medio" onClick={() => handleVotarLotacao('medio')}>Médio</button>
              <button className="btn-lotacao lotado" onClick={() => handleVotarLotacao('lotado')}>Lotado</button>
            </div>
          )}

          {/* Badges de Status */}
          <div className="dark-status-chips">
            {infoLotacao && statusFluxo !== 'votando' && (
              <Chip label={`${infoLotacao.label} (${infoLotacao.media})`} size="small" sx={{ fontWeight: 'bold', color: 'white', backgroundColor: infoLotacao.cor }} />
            )}
            {statusFluxo === 'rastreando' && isRastreador && (
              <Chip icon={<DirectionsBusIcon sx={{ fontSize: 14 }} />} label="Rastreando" size="small" sx={{ fontWeight: 'bold', bgcolor: '#1E58FF', color: 'white' }} />
            )}
          </div>

          {/* Botão de Embarque Inicial */}
          {!modoApenasConsulta && statusFluxo === 'inicial' && (
            <Box sx={{ width: '100%' }}>
              {embarqueAutomaticoAtivo && statusEmbarqueAuto === 'proximo' && velocidadeAuto < 1 && tempoRestante && (
                <Paper elevation={3} sx={{ mb: 1.5, p: 1.5, borderRadius: '16px', bgcolor: '#2a2a2a' }}>
                  <Stack spacing={1}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="caption" sx={{ color: '#0EA503', fontWeight: 'bold' }}>
                        Embarque em {Math.ceil(tempoRestante / 1000)}s...
                      </Typography>
                    </Stack>
                    <LinearProgress variant="determinate" value={Math.min(progressoEmbarque, 100)} sx={{ height: 6, borderRadius: 3, bgcolor: '#4A4A4A', '& .MuiLinearProgress-bar': { bgcolor: '#0EA503' } }} />
                  </Stack>
                </Paper>
              )}
              
        {/* BOTÃO DISTANCIA PARADA METROS */}
              <Button 
                variant="contained" 
                className="dark-action-btn"
                disabled={embarcando || (distanciaAteParada || distanciaAuto || 999) > 50} 
                onClick={async () => { if (embarqueAutomaticoAtivo) setEmbarqueAutomaticoAtivo(false); await handleConfirmarEmbarque(); }} 
                sx={{ width: '100%' }}
              >
                {embarcando ? 'Processando...' : ((distanciaAteParada || distanciaAuto || 999) > 50 ? `Longe (${Math.round(distanciaAteParada || distanciaAuto || 0)}m)` : (embarqueAutomaticoAtivo && statusEmbarqueAuto === 'proximo' ? `Aguardando (${Math.ceil(tempoRestante / 1000)}s)...` : 'Confirmar Embarque'))}
              </Button>
            </Box>
          )}
        </div>

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
          
          {/* Legenda do Gradiente */}
          <div className="map-legend">
            <div className="map-legend-item">
              <div className="map-legend-color" style={{ backgroundColor: '#FF0000' }}></div>
              <span className="map-legend-label">Início</span>
            </div>
            <span className="map-legend-divider">→</span>
            <div className="map-legend-item">
              <div className="map-legend-color" style={{ 
                background: 'linear-gradient(to right, #FF0000, #00FF00)',
                width: '30px',
                height: '4px',
                borderRadius: '2px'
              }}></div>
              <span className="map-legend-label">Rota</span>
            </div>
            <span className="map-legend-divider">→</span>
            <div className="map-legend-item">
              <div className="map-legend-color" style={{ backgroundColor: '#00FF00' }}></div>
              <span className="map-legend-label">Destino</span>
            </div>
          </div>
        </div>

      </div>
      
      {/* SNACKBAR DE ALERTAS */}
      <Snackbar open={!!alertaMsg} autoHideDuration={4000} onClose={handleCloseAlert} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} sx={{ mt: 10 }}>
        <Alert onClose={handleCloseAlert} severity={alertaMsg?.severidade || 'info'} sx={{ width: '100%', fontWeight: 'bold' }}>
          {alertaMsg?.texto}
        </Alert>
      </Snackbar>
    </div>
  );
}