import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, serverTimestamp, onSnapshot, deleteDoc, updateDoc, arrayUnion } from 'firebase/firestore';
import { Box, Button, Typography, Paper, CircularProgress, Stack, Chip, IconButton } from '@mui/material';
import { traduzirSigla } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import { useLocation } from '../hooks/useLocation';
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
  const [paradasData, setParadasData] = useState({});
  const [loading, setLoading] = useState(true);
  const [viagemAtiva, setViagemAtiva] = useState(null);
  const [statusFluxo, setStatusFluxo] = useState('inicial'); 
  const [distanciaAteParada, setDistanciaAteParada] = useState(null);

  const getCoords = (idRaw) => {
    if (!idRaw) return null;
    const id = (typeof idRaw === 'object' ? idRaw.nome : idRaw).toString().toLowerCase().trim();
    const info = paradasData[id];
    if (info?.location) {
      let lat = Number(info.location.latitude || info.location._lat);
      let lng = Number(info.location.longitude || info.location._long);
      return [lat > 0 ? lat * -1 : lat, lng > 0 ? lng * -1 : lng];
    }
    return null;
  };

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

  useEffect(() => {
    const oriKey = origem?.toLowerCase().trim();
    if (position && paradasData[oriKey]) {
      const coords = getCoords(oriKey);
      if (coords) {
        const d = calculateDistance(position.lat, position.lng, coords[0], coords[1]);
        setDistanciaAteParada(d); 
      }
    }
  }, [position, paradasData, origem]);

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

    if (idxAt === -1 || idxEu === -1 || idxAt >= idxEu) return null;

    let distanciaTotalMetros = 0;
    for (let i = idxAt; i < idxEu; i++) {
      const p1 = getCoords(lista[i]);
      const p2 = getCoords(lista[i + 1]);
      if (p1 && p2) {
        distanciaTotalMetros += calculateDistance(p1[0], p1[1], p2[0], p2[1]);
      }
    }

    return Math.ceil(distanciaTotalMetros / 333) + (idxEu - idxAt);
  }, [viagemAtiva, origem, itinerario, modoApenasConsulta, paradasData]);

  const handleConfirmarEmbarque = async () => {
    const tripId = `${itinerario.id}_${horario.replace(':', '')}`;
    const paradasNormalizadas = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
    
    const indiceAnterior = viagemAtiva?.indiceParada || 0;

    const meuIndiceAtual = paradasNormalizadas.indexOf(origem.toLowerCase().trim(), indiceAnterior);

    const isUltimaParadaAbsoluta = meuIndiceAtual === paradasNormalizadas.length - 1;

    if (isUltimaParadaAbsoluta) {
      await deleteDoc(doc(db, "viagens_ativas", tripId));
      voltar();
    } else {
      await setDoc(doc(db, "viagens_ativas", tripId), { 
        ultimaParada: origem,
        indiceParada: meuIndiceAtual,
        atualizadoEm: serverTimestamp() 
      }, { merge: true });
      setStatusFluxo('votando');
    }
  };

  const handleVotarLotacao = async (status) => {
    const tripId = `${itinerario.id}_${horario.replace(':', '')}`;
    const valores = { 'vazio': 1, 'medio': 3, 'lotado': 5 };
    await updateDoc(doc(db, "viagens_ativas", tripId), {
      historicoLotacao: arrayUnion({ valor: valores[status], data: new Date() }),
      atualizadoEm: serverTimestamp()
    });
    setStatusFluxo('confirmado');
  };

  const paradasTrecho = useMemo(() => {
    const lista = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
    if (modoApenasConsulta) return lista;
    const idxO = lista.indexOf(origem.toLowerCase().trim());
    const idxD = lista.indexOf(destino.toLowerCase().trim(), idxO);
    return (idxO !== -1 && idxD !== -1) ? lista.slice(idxO, idxD + 1) : lista;
  }, [itinerario, origem, destino, modoApenasConsulta]);

  const coords = useMemo(() => paradasTrecho.map(getCoords).filter(c => c !== null), [paradasTrecho, paradasData]);

  const renderGradiente = () => {
    if (coords.length < 2) return null;
    return coords.map((c, i) => {
      if (i === coords.length - 1) return null;
      const ratio = i / (coords.length - 1);
      const r = Math.round(14 + (255 - 14) * ratio);
      const g = Math.round(165 + (138 - 165) * ratio);
      const b = Math.round(3 + (49 - 3) * ratio);
      return <Polyline key={i} positions={[coords[i], coords[i+1]]} pathOptions={{ color: `rgb(${r},${g},${b})`, weight: 8, opacity: 0.7 }} />;
    });
  };

  if (loading) return <Box sx={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;
return (
    <Box sx={{ height: '100dvh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      
      {/* CABEÇALHO ALTERADO COM HIFEN (-) E REGRAS DE EXIBIÇÃO CONDICIONAIS */}
      <Paper elevation={2} sx={{ pt: 'calc(15px + env(safe-area-inset-top))', pb: 2, zIndex: 1100, borderRadius: 0, backgroundColor: '#f9f9f9', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <Typography variant="h6" fontWeight="bold" color="primary">
          {categoria || "Rota"} - {horario}
        </Typography>

        {/* EXIBIÇÃO CONDICIONAL: Só renderiza se NÃO for o modo unicamente de consulta */}
        {!modoApenasConsulta && (
          <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
              {viagemAtiva ? (
                <>Visto em: <b>{traduzirSigla(viagemAtiva.ultimaParada)}</b> {formatarRelativo(viagemAtiva.atualizadoEm)}</>
              ) : "Aguardando atualização..."}
          </Typography>
        )}
        
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {/* ALTERADO: Texto alterado para 'Estimativa: X minutos' */}
          {estimativaChegada && (
            <Chip label={`Estimativa: ${estimativaChegada} minutos`} color="secondary" size="small" sx={{ fontWeight: 'bold', fontSize: '0.75rem' }} />
          )}
          {infoLotacao && <Chip label={`${infoLotacao.label} (${infoLotacao.media})`} size="small" sx={{ fontWeight: 'bold', color: 'white', backgroundColor: infoLotacao.cor }} />}
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
              <Marker key={i} position={c} icon={id === origem.toLowerCase().trim() ? iconEmbarque : iconIntermediario}>
                <Popup><Typography variant="body2" fontWeight="bold">{traduzirSigla(id)}</Typography></Popup>
              </Marker>
            );
          })}
        </MapContainer>

        <Box sx={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 1100, width: '90%', maxWidth: '400px', pointerEvents: 'none' }}>
          <Box sx={{ pointerEvents: 'auto' }}>
            {!modoApenasConsulta && statusFluxo === 'inicial' && (
              <Button 
                variant="contained" 
                disabled={distanciaAteParada > 80} 
                onClick={handleConfirmarEmbarque} 
                sx={{ borderRadius: '50px', bgcolor: '#C4151C', color: 'white', width: '100%', height: '60px', fontWeight: 'bold', boxShadow: 3 }}
              >
                {distanciaAteParada > 80 ? `Longe (${Math.round(distanciaAteParada)}m)` : 'Confirmar Embarque'}
              </Button>
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
          </Box>
        </Box>
      </Box>
    </Box>
  );
}