// components/MainPage.jsx
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, serverTimestamp, onSnapshot, deleteDoc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { Box, Button, Typography, Paper, CircularProgress, Stack, Chip, IconButton, Snackbar, Alert, LinearProgress } from '@mui/material';
import { traduzirSigla } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import { useLocation } from '../hooks/useLocation';
import { useRastreamento } from '../hooks/useRastreamento';
import { entrarNaViagem, carregarRotasAprendidas } from '../services/transporteService';
import { usePersistViagem } from '../hooks/usePersistViagem';
import { useEmbarqueAutomatico } from '../hooks/useEmbarqueAutomatico';
import { usePageVisibility } from '../hooks/usePageVisibility';
import { getAuth } from 'firebase/auth';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import 'leaflet/dist/leaflet.css';

const iconEmbarque = new L.Icon({ 
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', 
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34]
});

const iconIntermediario = new L.DivIcon({ 
  className: 'custom-stop-icon', 
  html: `<div style="background-color: white; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #154370;"></div>`, 
  iconSize: [14, 14], iconAnchor: [7, 7] 
});

const TEMPO_CONFIRMACAO_MS = 5000;

// Função para calcular minutos restantes baseado nos tempos aprendidos
const calcularMinutosRestantes = (viagemAtiva, itinerario, rotasAprendidas, minhaParada) => {
  if (!viagemAtiva || !rotasAprendidas || !minhaParada || !itinerario) return null;

  const paradas = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toLowerCase().trim());
  const idxOnibus = viagemAtiva.indiceParada ?? 0;
  const idxUsuario = paradas.indexOf(minhaParada.toLowerCase().trim());

  if (idxOnibus === -1 || idxUsuario === -1) return null;
  if (idxOnibus >= idxUsuario) return 0;

  let segundosSomados = 0;
  let trechosPercorridos = [];

  for (let i = idxOnibus; i < idxUsuario; i++) {
    const chaveTrecho = `${itinerario.id}_${paradas[i]}-${paradas[i+1]}`;
    const dadosTrecho = rotasAprendidas[chaveTrecho];
    const tempoTrecho = dadosTrecho?.tempoMedio ?? 180;
    segundosSomados += tempoTrecho;
    trechosPercorridos.push({
      de: paradas[i],
      para: paradas[i+1],
      tempo: tempoTrecho
    });
  }

  return {
    minutos: Math.ceil(segundosSomados / 60),
    segundos: segundosSomados,
    detalhes: trechosPercorridos
  };
};

export default function MainPage({ itinerario, horario, origem, destino, modoApenasConsulta, voltar, categoria }) {
  const { position } = useLocation();
  const auth = getAuth();
  const isPageVisible = usePageVisibility();
  const [reconectando, setReconectando] = useState(false);
  const ultimaReconexaoRef = useRef(0);
  
  const [embarqueAutomaticoAtivo, setEmbarqueAutomaticoAtivo] = useState(true);

  // Estados persistidos
  const [statusFluxoPersistido, setStatusFluxoPersistido, clearStatusFluxo] = usePersistViagem('statusFluxo', 'inicial');
  const [isRastreadorPersistido, setIsRastreadorPersistido, clearIsRastreador] = usePersistViagem('isRastreador', false);
  const [viagemIdPersistida, setViagemIdPersistida, clearViagemId] = usePersistViagem('viagemId', null);
  const [gpsPassageiroAtivoPersistido, setGpsPassageiroAtivoPersistido, clearGpsPassageiro] = usePersistViagem('gpsPassageiroAtivo', false);

  // Estados locais
  const [paradasData, setParadasData] = useState({});
  const [loading, setLoading] = useState(true);
  const [viagemAtiva, setViagemAtiva] = useState(null);
  const [distanciaAteParada, setDistanciaAteParada] = useState(null);
  const [rotasAprendidas, setRotasAprendidas] = useState({});
  const [alertaMsg, setAlertaMsg] = useState(null);
  
  // Estados para estimativa de tempo real
  const [estimativaTempoReal, setEstimativaTempoReal] = useState(null);
  
  const snackbarTimerRef = useRef(null);
  const intervalEstimativaRef = useRef(null);
  
  const tripId = `${itinerario.id}_${horario.replace(':', '')}`;

  // Definir setters com useCallback
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

  // getCoords
  const getCoords = useCallback((idRaw) => {
    if (!idRaw) return null;
    const id = (typeof idRaw === 'object' ? idRaw.nome : idRaw).toString().toLowerCase().trim();
    const info = paradasData[id];
    if (info?.location) {
      let lat = Number(info.location.latitude  || info.location._lat);
      let lng = Number(info.location.longitude || info.location._long);
      return [lat > 0 ? lat * -1 : lat, lng > 0 ? lng * -1 : lng];
    }
    return null;
  }, [paradasData]);

  // Coordenadas da parada de origem
  const coordsParadaOrigem = useMemo(() => {
    if (!origem || !paradasData) return null;
    return getCoords(origem);
  }, [origem, paradasData, getCoords]);

  // handleConfirmarEmbarque
  const handleConfirmarEmbarque = useCallback(async () => {
    const usuario = auth.currentUser;
    if (!usuario) return;

    const paradasNormalizadas = itinerario.paradas.map(p =>
      (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
    );

    const indiceAnterior  = viagemAtiva?.indiceParada || 0;
    const meuIndiceAtual  = paradasNormalizadas.indexOf(origem.toLowerCase().trim(), indiceAnterior);

    if (meuIndiceAtual === -1) {
      console.warn("Parada de origem não encontrada no itinerário.");
      setAlertaMsg({ texto: 'Parada não encontrada no itinerário.', severidade: 'error' });
      return;
    }

    let papel;
    try {
      papel = await entrarNaViagem(
        itinerario.id,
        horario,
        usuario,
        origem,
        destino,
        itinerario,
      );
    } catch (e) {
      console.error("Erro ao entrar na viagem:", e);
      setAlertaMsg({ texto: 'Erro ao confirmar embarque. Tente novamente.', severidade: 'error' });
      return;
    }

    if (papel === 'bloqueado') {
      setAlertaMsg({ texto: 'Você já está em outra viagem ativa!', severidade: 'warning' });
      return;
    }

    const isUltimaParada = meuIndiceAtual === paradasNormalizadas.length - 1;

    if (isUltimaParada) {
      await deleteDoc(doc(db, "viagens_ativas", tripId));
      voltar();
      return;
    }

    await setDoc(doc(db, "viagens_ativas", tripId), {
      ultimaParada: origem,
      indiceParada: meuIndiceAtual,
      atualizadoEm: serverTimestamp(),
    }, { merge: true });

    setIsRastreador(papel === 'rastreador' || papel === 'reserva_prioritaria');
    setStatusFluxo('votando');
  }, [auth, itinerario, origem, destino, viagemAtiva, tripId, voltar, setIsRastreador, setStatusFluxo]);

  // Hook de embarque automático
  const { 
    status: statusEmbarqueAuto, 
    distancia: distanciaAuto, 
    velocidade: velocidadeAuto,
    tempoRestante
  } = useEmbarqueAutomatico({
    ativo: embarqueAutomaticoAtivo && !modoApenasConsulta && statusFluxo === 'inicial' && !!position && !!coordsParadaOrigem,
    position,
    paradaOrigem: origem,
    paradaCoords: coordsParadaOrigem,
    onEmbarqueConfirmado: async () => {
      console.log('[EmbarqueAuto] Confirmando embarque automático...');
      setAlertaMsg({
        texto: `Embarque automático detectado! Você está no ônibus para ${traduzirSigla(destino)}.`,
        severidade: 'success'
      });
      setTimeout(() => setAlertaMsg(null), 5000);
      await handleConfirmarEmbarque();
      setEmbarqueAutomaticoAtivo(false);
    },
  });

  // Atualizar estimativa de tempo real
  const atualizarEstimativaTempoReal = useCallback(() => {
    if (!viagemAtiva || !origem || modoApenasConsulta) return;
    const resultado = calcularMinutosRestantes(viagemAtiva, itinerario, rotasAprendidas, origem);
    if (resultado) setEstimativaTempoReal(resultado);
  }, [viagemAtiva, origem, itinerario, rotasAprendidas, modoApenasConsulta]);

  useEffect(() => {
    atualizarEstimativaTempoReal();
  }, [atualizarEstimativaTempoReal]);

  useEffect(() => {
    if (statusFluxo !== 'inicial' && !modoApenasConsulta) {
      intervalEstimativaRef.current = setInterval(atualizarEstimativaTempoReal, 30000);
      return () => { if (intervalEstimativaRef.current) clearInterval(intervalEstimativaRef.current); };
    }
  }, [statusFluxo, modoApenasConsulta, atualizarEstimativaTempoReal]);

  // Salvar ID da viagem
  useEffect(() => {
    if (statusFluxo !== 'inicial' && statusFluxo !== 'expulso' && tripId) {
      setViagemIdPersistida(tripId);
    }
  }, [statusFluxo, tripId, setViagemIdPersistida]);

  // Verificar viagem existente ao recarregar (APENAS NA CARGA INICIAL)
  useEffect(() => {
    let isMounted = true;
    const verificarViagemExistente = async () => {
      if (viagemIdPersistida && statusFluxo !== 'inicial' && statusFluxo !== 'expulso') {
        console.log("[MainPage] Verificando viagem existente:", viagemIdPersistida);
        const viagemRef = doc(db, "viagens_ativas", viagemIdPersistida);
        const snap = await getDoc(viagemRef);
        if (!snap.exists() && isMounted) {
          console.log("[MainPage] Viagem não existe mais, limpando estado");
          clearStatusFluxo();
          clearIsRastreador();
          clearViagemId();
          clearGpsPassageiro();
          voltar();
          return;
        }
        if (snap.exists() && isMounted) {
          const dados = snap.data();
          setViagemAtiva(dados);
          const usuario = auth.currentUser;
          if (usuario && dados.rastreadorAtual?.uid !== usuario.uid) setIsRastreador(false);
        }
      }
    };
    verificarViagemExistente();
    return () => { isMounted = false; };
  }, []); // Executa apenas uma vez na montagem

  // Reconectar quando página voltar (com throttle para evitar loop)
  useEffect(() => {
    const agora = Date.now();
    const deveReconectar = isPageVisible && 
                           statusFluxo !== 'inicial' && 
                           statusFluxo !== 'expulso' && 
                           !reconectando &&
                           (agora - ultimaReconexaoRef.current) > 5000;
    
    if (deveReconectar) {
      console.log("[MainPage] Reconectando à viagem...");
      ultimaReconexaoRef.current = agora;
      setReconectando(true);
      
      const viagemRef = doc(db, "viagens_ativas", tripId);
      getDoc(viagemRef).then(snap => {
        if (snap.exists()) {
          setViagemAtiva(snap.data());
          console.log("[MainPage] Reconectado com sucesso");
        } else {
          console.log("[MainPage] Viagem não encontrada na reconexão");
        }
        setReconectando(false);
      }).catch((err) => {
        console.error("[MainPage] Erro na reconexão:", err);
        setReconectando(false);
      });
    }
  }, [isPageVisible, statusFluxo, tripId, reconectando]);

  // Carregar dados das paradas
  useEffect(() => {
    getDocs(collection(db, "paradas")).then(s => {
      const mapeamento = {};
      s.docs.forEach(d => { mapeamento[d.id.toLowerCase().trim()] = d.data(); });
      setParadasData(mapeamento);
      setLoading(false);
    });

    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) setViagemAtiva(d.data());
      else setViagemAtiva(null);
    });
    return () => unsub();
  }, [tripId]);

  // Carregar rotas aprendidas
  useEffect(() => {
    if (!itinerario?.id) return;
    carregarRotasAprendidas(itinerario.id).then(setRotasAprendidas);
  }, [itinerario]);

  // Distância até a parada
  useEffect(() => {
    const oriKey = origem?.toLowerCase().trim();
    if (position && paradasData[oriKey]) {
      const coords = getCoords(oriKey);
      if (coords) {
        setDistanciaAteParada(calculateDistance(position.lat, position.lng, coords[0], coords[1]));
      }
    }
  }, [position, paradasData, origem, getCoords]);

  // Verificar expiração da rota
  useEffect(() => {
    if (modoApenasConsulta || !itinerario?.duracaoEstimada || !horario) return;
    const verificarExpiracao = async () => {
      const [horas, minutos] = horario.split(':').map(Number);
      const agora = new Date();
      const horarioInicio = new Date();
      horarioInicio.setHours(horas, minutos, 0, 0);
      const horarioTermino = new Date(horarioInicio.getTime() + (itinerario.duracaoEstimada + 10) * 60000);
      if (agora > horarioTermino) {
        try {
          await deleteDoc(doc(db, "viagens_ativas", tripId));
          voltar();
        } catch (e) { console.error(e); }
      }
    };
    verificarExpiracao();
    const interval = setInterval(verificarExpiracao, 60000);
    return () => clearInterval(interval);
  }, [itinerario, horario, voltar, modoApenasConsulta, tripId]);

  const handleExpulsar = useCallback((motivo) => {
    const mensagens = {
      destino: 'Você chegou ao destino! Boa aula!',
      desvio: 'Você saiu da rota. Viagem encerrada.',
      rebaixado: 'Outro passageiro assumiu o rastreamento.',
      cancelada: 'Viagem encerrada pelo sistema.',
    };
    setAlertaMsg({ texto: mensagens[motivo] || 'Viagem encerrada.', severidade: motivo === 'destino' ? 'success' : 'warning' });
    setStatusFluxo('expulso');
    setTimeout(() => voltar(), 3000);
  }, [voltar, setStatusFluxo]);

  const handleVotarLotacao = useCallback(async (status) => {
    const valores = { 'vazio': 1, 'medio': 3, 'lotado': 5 };
    await updateDoc(doc(db, "viagens_ativas", tripId), {
      historicoLotacao: arrayUnion({ valor: valores[status], data: new Date() }),
      atualizadoEm: serverTimestamp()
    });
    setStatusFluxo('rastreando');
  }, [tripId, setStatusFluxo]);

  useRastreamento({
    ativo: (statusFluxo === 'rastreando' && isRastreador && !modoApenasConsulta) || 
           (statusFluxo === 'rastreando' && gpsPassageiroAtivo),
    isRastreador,
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
    let label = "Vazio"; let cor = "#0EA503";
    if (media > 4.0) { label = "Lotado"; cor = "#C4151C"; }
    else if (media > 2.5) { label = "Médio"; cor = "#FF8A31"; }
    return { media, label, cor };
  }, [viagemAtiva]);

  const paradasTrecho = useMemo(() => {
    const lista = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
    if (modoApenasConsulta) return lista;
    const idxO = lista.indexOf(origem.toLowerCase().trim());
    const idxD = lista.indexOf(destino.toLowerCase().trim(), idxO);
    return (idxO !== -1 && idxD !== -1) ? lista.slice(idxO, idxD + 1) : lista;
  }, [itinerario, origem, destino, modoApenasConsulta]);

  const coords = useMemo(
    () => paradasTrecho.map(getCoords).filter(c => c !== null),
    [paradasTrecho, getCoords]
  );

  const renderGradiente = () => {
    if (paradasTrecho.length < 2) return null;
    return paradasTrecho.map((id, i) => {
      if (i === paradasTrecho.length - 1) return null;
      const idA = id;
      const idB = paradasTrecho[i + 1];
      const c1 = getCoords(idA);
      const c2 = getCoords(idB);
      if (!c1 || !c2) return null;
      const ratio = i / (paradasTrecho.length - 1);
      const r = Math.round(14 + (255 - 14) * ratio);
      const g = Math.round(165 + (138 - 165) * ratio);
      const b = Math.round(3 + (49 - 3) * ratio);
      const cor = `rgb(${r},${g},${b})`;
      const chave = `${itinerario.id}_${idA}-${idB}`;
      const rotaTrecho = rotasAprendidas[chave];
      const temRotaReal = rotaTrecho && rotaTrecho.coordenadas?.length >= 3;
      const positions = temRotaReal ? [c1, ...rotaTrecho.coordenadas, c2] : [c1, c2];
      return (
        <Polyline
          key={i}
          positions={positions}
          pathOptions={{
            color: cor,
            weight: temRotaReal ? 5 : 8,
            opacity: 0.75,
            dashArray: temRotaReal ? undefined : '8, 6',
          }}
        />
      );
    });
  };

  const handleCloseAlert = () => {
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    setAlertaMsg(null);
  };

  const progressoEmbarque = useMemo(() => {
    if (statusEmbarqueAuto !== 'proximo' || !tempoRestante) return 0;
    return ((TEMPO_CONFIRMACAO_MS - tempoRestante) / TEMPO_CONFIRMACAO_MS) * 100;
  }, [statusEmbarqueAuto, tempoRestante]);

  if (loading || reconectando) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <CircularProgress />
      <Typography variant="body2" color="textSecondary">
        {reconectando ? 'Reconectando à viagem...' : 'Carregando...'}
      </Typography>
    </Box>
  );

  return (
    <Box sx={{ height: '100dvh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      <Paper elevation={2} sx={{ pt: 'calc(15px + env(safe-area-inset-top))', pb: 2, zIndex: 1100, borderRadius: 0, backgroundColor: '#f9f9f9', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <Typography variant="h6" fontWeight="bold" color="primary">
          {categoria || "Rota"} - {horario}
        </Typography>

        {!modoApenasConsulta && (
          <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
            {viagemAtiva ? (
              <>Visto em: <b>{traduzirSigla(viagemAtiva.ultimaParada)}</b> {formatarRelativo(viagemAtiva.atualizadoEm)}</>
            ) : "Aguardando atualização..."}
          </Typography>
        )}

        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          {statusFluxo !== 'inicial' && estimativaTempoReal && !modoApenasConsulta && (
            <Chip icon={<AccessTimeIcon sx={{ fontSize: 14 }} />} label={`Chegada em ${estimativaTempoReal.minutos} min`} color="secondary" size="small" sx={{ fontWeight: 'bold', fontSize: '0.75rem' }} />
          )}
          {infoLotacao && <Chip label={`${infoLotacao.label} (${infoLotacao.media})`} size="small" sx={{ fontWeight: 'bold', color: 'white', backgroundColor: infoLotacao.cor }} />}
          {statusFluxo === 'rastreando' && isRastreador && <Chip icon={<DirectionsBusIcon sx={{ fontSize: 14 }} />} label="Rastreando" size="small" sx={{ fontWeight: 'bold', bgcolor: '#00418F', color: 'white', fontSize: '0.65rem' }} />}
          {!isPageVisible && statusFluxo === 'rastreando' && <Chip label="App em segundo plano" size="small" sx={{ fontWeight: 'bold', bgcolor: '#FF8A31', color: 'white', fontSize: '0.65rem' }} />}
        </Stack>

        {statusFluxo !== 'inicial' && estimativaTempoReal?.detalhes && !modoApenasConsulta && estimativaTempoReal.detalhes.length > 0 && (
          <Typography variant="caption" color="textSecondary" sx={{ mt: 0.5, fontSize: '0.6rem' }}>
            Baseado em {estimativaTempoReal.detalhes.length} trecho(s) aprendidos
          </Typography>
        )}

        <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'rgb(14, 165, 3)' }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666' }}>INÍCIO</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'rgb(255, 138, 49)' }} />
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
      </Paper>

      <Box sx={{ flexGrow: 1, position: 'relative', width: '100%' }}>
        <IconButton onClick={voltar} sx={{ position: 'absolute', top: 16, left: 16, zIndex: 1100, bgcolor: 'white', boxShadow: 2, '&:hover': { bgcolor: '#f0f0f0' } }}>
          <ArrowBackIcon />
        </IconButton>

        <MapContainer center={coords[0] || [-31.76, -52.33]} zoom={15} zoomControl={false} style={{ height: '100%', width: '100%', zIndex: 1 }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
          {renderGradiente()}
          {paradasTrecho.map((id, i) => {
            const c = getCoords(id);
            if (!c) return null;
            return (
              <Marker key={i} position={c} icon={id === origem?.toLowerCase().trim() ? iconEmbarque : iconIntermediario}>
                <Popup><Typography variant="body2" fontWeight="bold">{traduzirSigla(id)}</Typography></Popup>
              </Marker>
            );
          })}
        </MapContainer>

        <Box sx={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 1100, width: '90%', maxWidth: '400px', pointerEvents: 'none' }}>
          <Box sx={{ pointerEvents: 'auto' }}>
            
            {!modoApenasConsulta && statusFluxo === 'inicial' && (
              <Box sx={{ width: '100%' }}>
                {/* Barra de progresso do embarque automático (só aparece durante contagem) */}
                {embarqueAutomaticoAtivo && statusEmbarqueAuto === 'proximo' && velocidadeAuto > 5 && tempoRestante && (
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
                        sx={{ height: 6, borderRadius: 3, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { bgcolor: '#0EA503' } }}
                      />
                    </Stack>
                  </Paper>
                )}
                
                {/* Botão principal de embarque (unificado) */}
                <Button
                  variant="contained"
                  disabled={(distanciaAteParada || distanciaAuto || 999) > 80}
                  onClick={async () => {
                    if (embarqueAutomaticoAtivo) {
                      setEmbarqueAutomaticoAtivo(false);
                    }
                    await handleConfirmarEmbarque();
                  }}
                  sx={{ borderRadius: '50px', bgcolor: '#C4151C', color: 'white', width: '100%', height: '60px', fontWeight: 'bold', boxShadow: 3 }}
                >
                  {(distanciaAteParada || distanciaAuto || 999) > 80
                    ? `Longe (${Math.round(distanciaAteParada || distanciaAuto || 0)}m)`
                    : (embarqueAutomaticoAtivo ? 'Aguardando ônibus...' : 'Confirmar Embarque Manual')}
                </Button>
                
                {/* Botão para alternar entre modo automático e manual */}
                {statusEmbarqueAuto !== 'confirmado' && (
                  <Button
                    size="small"
                    onClick={() => setEmbarqueAutomaticoAtivo(!embarqueAutomaticoAtivo)}
                    sx={{ mt: 1, textTransform: 'none', color: '#00418F', width: '100%' }}
                  >
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
                  {isRastreador
                    ? 'Você está contribuindo com a rota em tempo real'
                    : gpsPassageiroAtivo
                      ? 'GPS ativado para desembarque'
                      : 'Acompanhando o ônibus...'}
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