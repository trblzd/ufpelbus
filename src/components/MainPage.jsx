// components/MainPage.jsx
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, serverTimestamp, onSnapshot, deleteDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { Box, Button, Typography, Paper, CircularProgress, Stack, Chip, IconButton, Snackbar, Alert } from '@mui/material';
import { traduzirSigla } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import { useLocation } from '../hooks/useLocation';
import { useRastreamento } from '../hooks/useRastreamento';
import { entrarNaViagem, carregarRotasAprendidas } from '../services/transporteService';
import { getAuth } from 'firebase/auth';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
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

export default function MainPage({ itinerario, horario, origem, destino, modoApenasConsulta, voltar, categoria }) {
  const { position } = useLocation();
  const auth = getAuth();

  const [paradasData, setParadasData]               = useState({});
  const [loading, setLoading]                        = useState(true);
  const [viagemAtiva, setViagemAtiva]                = useState(null);
  // statusFluxo: 'inicial' | 'votando' | 'confirmado' | 'rastreando' | 'expulso'
  const [statusFluxo, setStatusFluxo]                = useState('inicial');
  const [distanciaAteParada, setDistanciaAteParada]  = useState(null);
  const [isRastreador, setIsRastreador]              = useState(false);
  const [rotasAprendidas, setRotasAprendidas]        = useState({});
  const [alertaMsg, setAlertaMsg]                    = useState(null); // { texto, severidade }

  // ── getCoords com useCallback para estabilidade nas dependências ──────────
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

  // ── Carrega paradas + listener da viagem ativa ────────────────────────────
  useEffect(() => {
    getDocs(collection(db, "paradas")).then(s => {
      const mapeamento = {};
      s.docs.forEach(d => { mapeamento[d.id.toLowerCase().trim()] = d.data(); });
      setParadasData(mapeamento);
      setLoading(false);
    });

    const tripId = `${itinerario.id}_${horario.replace(':', '')}`;
    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) setViagemAtiva(d.data());
      else setViagemAtiva(null);
    });
    return () => unsub();
  }, [itinerario, horario]);

  // ── Carrega rotas aprendidas do itinerário ────────────────────────────────
  useEffect(() => {
    if (!itinerario?.id) return;
    carregarRotasAprendidas(itinerario.id).then(setRotasAprendidas);
  }, [itinerario]);

  // ── Distância até a parada de origem ─────────────────────────────────────
  useEffect(() => {
    const oriKey = origem?.toLowerCase().trim();
    if (position && paradasData[oriKey]) {
      const coords = getCoords(oriKey);
      if (coords) {
        const d = calculateDistance(position.lat, position.lng, coords[0], coords[1]);
        setDistanciaAteParada(d); 
      }
    }
  }, [position, paradasData, origem, getCoords]);

  // ── Verifica expiração da rota por tempo ──────────────────────────────────
  useEffect(() => {
    if (modoApenasConsulta || !itinerario?.duracaoEstimada || !horario) return;

    const verificarExpiracao = async () => {
      const [horas, minutos] = horario.split(':').map(Number);
      const agora = new Date();
      
      const horarioInicio = new Date();
      horarioInicio.setHours(horas, minutos, 0, 0);

      const margemSeguranca = 10;
      const horarioTermino = new Date(horarioInicio.getTime() + (itinerario.duracaoEstimada + margemSeguranca) * 60000);

      if (agora > horarioTermino) {
        const tripId = `${itinerario.id}_${horario.replace(':', '')}`;
        try {
          await deleteDoc(doc(db, "viagens_ativas", tripId));
          console.log("Rota encerrada por tempo limite atingido.");
          voltar();
        } catch (e) {
          console.error("Erro ao encerrar rota expirada:", e);
        }
      }
    };

    verificarExpiracao();
    const interval = setInterval(verificarExpiracao, 60000);
    return () => clearInterval(interval);
  }, [itinerario, horario, voltar, modoApenasConsulta]);

  // ── Callback de expulsão (vindo do useRastreamento) ───────────────────────
  const handleExpulsar = useCallback((motivo) => {
    const mensagens = {
      destino: 'Você chegou ao destino! Boa aula! 🎓',
      desvio:  'Você saiu da rota. Viagem encerrada.',
    };
    setAlertaMsg({ texto: mensagens[motivo] || 'Viagem encerrada.', severidade: motivo === 'destino' ? 'success' : 'warning' });
    setStatusFluxo('expulso');
    // Volta para a tela anterior após 3 segundos
    setTimeout(() => voltar(), 3000);
  }, [voltar]);

  // ── Hook de rastreamento ativo ────────────────────────────────────────────
  // Só ativa após o usuário confirmar embarque E votar na lotação ('rastreando')
  useRastreamento({
    ativo:           statusFluxo === 'rastreando' && !modoApenasConsulta,
    isRastreador,
    itinerario,
    horario,
    paradaOrigem:    origem || '',
    paradaDestino:   destino || '',
    paradasData,
    rotasAprendidas,
    onExpulsar:      handleExpulsar,
  });

  // ── Helpers de UI ─────────────────────────────────────────────────────────
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

  const estimativaChegada = useMemo(() => {
    if (!viagemAtiva || !origem || !itinerario || modoApenasConsulta || Object.keys(paradasData).length === 0) return null;
    
    const lista = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
    const idxAt = viagemAtiva.indiceParada || 0;
    const meuDestino = origem.toLowerCase().trim();
    const idxEu = lista.indexOf(meuDestino, idxAt);

    // Bug fix: >= substituído por > para não retornar null quando idxAt === idxEu
    if (idxAt === -1 || idxEu === -1 || idxAt > idxEu) return null;

    let distanciaTotalMetros = 0;
    for (let i = idxAt; i < idxEu; i++) {
      const p1 = getCoords(lista[i]);
      const p2 = getCoords(lista[i + 1]);
      if (p1 && p2) {
        distanciaTotalMetros += calculateDistance(p1[0], p1[1], p2[0], p2[1]);
      }
    }

    return Math.ceil(distanciaTotalMetros / 333) + (idxEu - idxAt);
  }, [viagemAtiva, origem, itinerario, modoApenasConsulta, paradasData, getCoords]);

  // ── Confirmar embarque ────────────────────────────────────────────────────
  const handleConfirmarEmbarque = async () => {
    const usuario = auth.currentUser;
    if (!usuario) return;

    const paradasNormalizadas = itinerario.paradas.map(p =>
      (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
    );

    const indiceAnterior  = viagemAtiva?.indiceParada || 0;
    const meuIndiceAtual  = paradasNormalizadas.indexOf(origem.toLowerCase().trim(), indiceAnterior);

    // Bug fix: guarda contra índice -1
    if (meuIndiceAtual === -1) {
      console.warn("Parada de origem não encontrada no itinerário.");
      setAlertaMsg({ texto: 'Parada não encontrada no itinerário.', severidade: 'error' });
      return;
    }

    // Usa entrarNaViagem com verificação de viagem dupla e eleição de rastreador
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

    // Atualiza indiceParada no documento da viagem
    const tripId = `${itinerario.id}_${horario.replace(':', '')}`;
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

    // Marca se é rastreador para o hook useRastreamento
    setIsRastreador(papel === 'rastreador' || papel === 'reserva_prioritaria');
    setStatusFluxo('votando');
  };

  // ── Votar na lotação ──────────────────────────────────────────────────────
  const handleVotarLotacao = async (status) => {
    const tripId = `${itinerario.id}_${horario.replace(':', '')}`;
    const valores = { 'vazio': 1, 'medio': 3, 'lotado': 5 };
    await updateDoc(doc(db, "viagens_ativas", tripId), {
      historicoLotacao: arrayUnion({ valor: valores[status], data: new Date() }),
      atualizadoEm:     serverTimestamp()
    });
    // Após votar, ativa o rastreamento GPS
    setStatusFluxo('rastreando');
  };

  // ── Paradas e coordenadas do trecho ───────────────────────────────────────
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

  // ── renderGradiente com suporte a rotas aprendidas ────────────────────────
  // Para cada segmento entre duas paradas consecutivas:
  //   1. Verifica se existe rota aprendida com pontos suficientes
  //   2. Se sim → usa esses pontos como waypoints da Polyline (segue as ruas)
  //   3. Se não → usa a linha reta entre as paradas como fallback
  const renderGradiente = () => {
    if (paradasTrecho.length < 2) return null;

    return paradasTrecho.map((id, i) => {
      if (i === paradasTrecho.length - 1) return null;

      const idA = id;
      const idB = paradasTrecho[i + 1];
      const c1  = getCoords(idA);
      const c2  = getCoords(idB);
      if (!c1 || !c2) return null;

      // Cor do gradiente (verde → laranja ao longo da rota)
      const ratio = i / (paradasTrecho.length - 1);
      const r = Math.round(14  + (255 - 14)  * ratio);
      const g = Math.round(165 + (138 - 165) * ratio);
      const b = Math.round(3   + (49  - 3)   * ratio);
      const cor = `rgb(${r},${g},${b})`;

      // Tenta usar rota aprendida
      const chave       = `${itinerario.id}_${idA}-${idB}`;
      const rotaTrecho  = rotasAprendidas[chave];
      const temRotaReal = rotaTrecho && rotaTrecho.length >= 3;

      // Posições da polyline: rota aprendida com paradas nos extremos para fechar gaps
      const positions = temRotaReal
        ? [c1, ...rotaTrecho, c2]
        : [c1, c2];

      return (
        <Polyline
          key={i}
          positions={positions}
          pathOptions={{
            color:   cor,
            weight:  temRotaReal ? 5 : 8, // Linha mais fina quando é aprendida (mais precisa)
            opacity: 0.75,
            // Linha tracejada enquanto ainda é estimativa (menos de 3 pontos distintos)
            dashArray: temRotaReal ? undefined : '8, 6',
          }}
        />
      );
    });
  };

  if (loading) return (
    <Box sx={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress />
    </Box>
  );

  return (
    <Box sx={{ height: '100dvh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>

      {/* CABEÇALHO */}
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

        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {estimativaChegada && (
            <Chip label={`Estimativa: ${estimativaChegada} minutos`} color="secondary" size="small" sx={{ fontWeight: 'bold', fontSize: '0.75rem' }} />
          )}
          {infoLotacao && (
            <Chip label={`${infoLotacao.label} (${infoLotacao.media})`} size="small" sx={{ fontWeight: 'bold', color: 'white', backgroundColor: infoLotacao.cor }} />
          )}
          {/* Badge indicando que a rota está sendo aprendida */}
          {statusFluxo === 'rastreando' && isRastreador && (
            <Chip label="📡 Rastreando" size="small" sx={{ fontWeight: 'bold', bgcolor: '#00418F', color: 'white', fontSize: '0.65rem' }} />
          )}
        </Stack>

        <Stack direction="row" spacing={2} sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'rgb(14, 165, 3)' }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666' }}>INÍCIO</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'rgb(255, 138, 49)' }} />
            <Typography variant="caption" sx={{ fontSize: '0.65rem', fontWeight: 'bold', color: '#666' }}>FIM</Typography>
          </Box>
          {/* Legenda: linha tracejada = estimada, contínua = aprendida */}
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

      {/* MAPA */}
      <Box sx={{ flexGrow: 1, position: 'relative', width: '100%' }}>
        <IconButton
          onClick={voltar}
          sx={{ position: 'absolute', top: 16, left: 16, zIndex: 1100, bgcolor: 'white', boxShadow: 2, '&:hover': { bgcolor: '#f0f0f0' } }}
        >
          <ArrowBackIcon />
        </IconButton>

        <MapContainer
          center={coords[0] || [-31.76, -52.33]}
          zoom={15}
          zoomControl={false}
          style={{ height: '100%', width: '100%', zIndex: 1 }}
        >
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
          {renderGradiente()}
          {paradasTrecho.map((id, i) => {
            const c = getCoords(id);
            if (!c) return null;
            return (
              <Marker key={i} position={c} icon={id === origem?.toLowerCase().trim() ? iconEmbarque : iconIntermediario}>
                <Popup>
                  <Typography variant="body2" fontWeight="bold">{traduzirSigla(id)}</Typography>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {/* BOTÕES DE AÇÃO */}
        <Box sx={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 1100, width: '90%', maxWidth: '400px', pointerEvents: 'none' }}>
          <Box sx={{ pointerEvents: 'auto' }}>

            {/* Estado inicial: botão de embarque */}
            {!modoApenasConsulta && statusFluxo === 'inicial' && (
              <Button
                variant="contained"
                disabled={distanciaAteParada > 80}
                onClick={handleConfirmarEmbarque}
                sx={{ borderRadius: '50px', bgcolor: '#C4151C', color: 'white', width: '100%', height: '60px', fontWeight: 'bold', boxShadow: 3 }}
              >
                {distanciaAteParada > 80
                  ? `Longe (${Math.round(distanciaAteParada)}m)`
                  : 'Confirmar Embarque'}
              </Button>
            )}

            {/* Estado votando: escolha de lotação */}
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

            {/* Estado rastreando: info discreta */}
            {statusFluxo === 'rastreando' && (
              <Paper elevation={2} sx={{ p: 1.5, borderRadius: '15px', textAlign: 'center', bgcolor: 'rgba(255,255,255,0.92)' }}>
                <Typography variant="caption" color="textSecondary">
                  {isRastreador
                    ? '📡 Você está contribuindo com a rota em tempo real'
                    : '🚌 Acompanhando o ônibus...'}
                </Typography>
              </Paper>
            )}
          </Box>
        </Box>
      </Box>

      {/* SNACKBAR de alertas (bloqueio, expulsão, erros) */}
      <Snackbar
        open={!!alertaMsg}
        autoHideDuration={4000}
        onClose={() => setAlertaMsg(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setAlertaMsg(null)}
          severity={alertaMsg?.severidade || 'info'}
          sx={{ width: '100%', fontWeight: 'bold' }}
        >
          {alertaMsg?.texto}
        </Alert>
      </Snackbar>
    </Box>
  );
}
