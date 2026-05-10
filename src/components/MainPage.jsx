import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, serverTimestamp, onSnapshot, deleteDoc } from 'firebase/firestore';
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
    });
    return () => unsub();
  }, [itinerario, horario]);

  useEffect(() => {
    const oriKey = origem?.toLowerCase().trim();
    if (position && paradasData[oriKey]) {
      const p = paradasData[oriKey].location;
      const d = calculateDistance(position.lat, position.lng, p.latitude || p._lat, p.longitude || p._long);
      setDistanciaAteParada(d * 1000); 
    }
  }, [position, paradasData, origem]);

  // MOVIDA PARA CIMA PARA EVITAR O ERRO DE INICIALIZAÇÃO
  const getCoords = (idRaw) => {
    const id = (typeof idRaw === 'object' ? idRaw.nome : idRaw).toString().toLowerCase().trim();
    const info = paradasData[id];
    if (info?.location) {
      let lat = info.location.latitude || info.location._lat;
      let lng = info.location.longitude || info.location._long;
      return [lat > 0 ? lat * -1 : lat, lng > 0 ? lng * -1 : lng];
    }
    return null;
  };

  const formatarRelativo = (timestamp) => {
    if (!timestamp) return "...";
    const agora = new Date();
    const dataPost = timestamp.toDate();
    const difSegundos = Math.floor((agora - dataPost) / 1000);
    if (difSegundos < 60) return "Agora mesmo";
    const minutos = Math.floor(difSegundos / 60);
    return `Há ${minutos} min`;
  };

// Dentro da MainPage.jsx, substitua o useMemo da estimativaChegada:

const estimativaChegada = useMemo(() => {
  if (!viagemAtiva || !origem || !itinerario || modoApenasConsulta || Object.keys(paradasData).length === 0) return null;

  const lista = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
  const idxAt = lista.indexOf(viagemAtiva.ultimaParada.toLowerCase().trim());
  const idxEu = lista.indexOf(origem.toLowerCase().trim());

  // Se o ônibus já passou da minha parada ou não mapeado
  if (idxAt === -1 || idxEu === -1 || idxAt >= idxEu) return null;

  let distanciaTotalMetros = 0;

  // Soma a distância entre todas as paradas do local atual do bus até a minha origem
  for (let i = idxAt; i < idxEu; i++) {
    const p1 = getCoords(lista[i]);
    const p2 = getCoords(lista[i + 1]);
    
    if (p1 && p2) {
      distanciaTotalMetros += calculateDistance(p1[0], p1[1], p2[0], p2[1]);
    }
  }

  // Fallback: se o cálculo de distância falhar, usa a média de 4 min por parada
  if (distanciaTotalMetros === 0) return (idxEu - idxAt) * 4;

  // Conversão: Distância / Velocidade Média
  // 333 metros/minuto ≈ 20km/h (considerando trânsito e paradas rápidas)
  const tempoEstimado = Math.ceil(distanciaTotalMetros / 333);
  
  // Adiciona uma margem de segurança de 2 minutos
  return tempoEstimado + 2; 
}, [viagemAtiva, origem, itinerario, modoApenasConsulta, paradasData]);

  const handleConfirmarEmbarque = async () => {
    const tripId = `${itinerario.id}_${horario.replace(':', '')}`;
    const paradasNormalizadas = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
    const isUltimaParada = paradasNormalizadas[paradasNormalizadas.length - 1] === origem.toLowerCase().trim();

    if (isUltimaParada) {
      await deleteDoc(doc(db, "viagens_ativas", tripId));
      voltar();
    } else {
      await setDoc(doc(db, "viagens_ativas", tripId), { 
        ultimaParada: origem, 
        atualizadoEm: serverTimestamp() 
      }, { merge: true });
      setStatusFluxo('votando');
    }
  };

  const handleVotarLotacao = async (nivel) => {
    const tripId = `${itinerario.id}_${horario.replace(':', '')}`;
    await setDoc(doc(db, "viagens_ativas", tripId), { lotacaoAtual: nivel, atualizadoEm: serverTimestamp() }, { merge: true });
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

  const getCorLotacao = (nivel) => {
    if (nivel === 'vazio') return '#0EA503';
    if (nivel === 'medio') return '#FF8A31';
    if (nivel === 'lotado') return '#C4151C';
    return '#757575';
  };

  if (loading) return <Box sx={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;

  return (
    <Box sx={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      
      <Paper elevation={2} sx={{ pt: 'calc(15px + env(safe-area-inset-top))', pb: 2, zIndex: 1100, width: '100%', borderRadius: 0, backgroundColor: '#f9f9f9', boxShadow: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <Typography variant="h6" fontWeight="bold" color="primary">
          {categoria} • {horario}
        </Typography>
        
        <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
            {viagemAtiva ? (
              <>Visto em: <b>{traduzirSigla(viagemAtiva.ultimaParada)}</b> • <span style={{color: '#FF8A31', fontWeight: 'bold'}}>{formatarRelativo(viagemAtiva.atualizadoEm)}</span></>
            ) : "Aguardando atualização..."}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          {estimativaChegada && (
            <Chip label={`Estimativa: em até ${estimativaChegada} min`} color="secondary" size="small" sx={{ fontWeight: 'bold' }} />
          )}

          {viagemAtiva?.lotacaoAtual && (
            <Chip label="Lotação" size="small" sx={{ fontWeight: 'bold', color: 'white', backgroundColor: getCorLotacao(viagemAtiva.lotacaoAtual), '& .MuiChip-label': { px: 2 } }} />
          )}
        </Stack>
      </Paper>

      <Box sx={{ flexGrow: 1, position: 'relative', width: '100%' }}>
        <Box sx={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', width: '92%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 1100, pointerEvents: 'none' }}>
          <IconButton onClick={voltar} sx={{ bgcolor: 'white', color: '#154370', borderRadius: '12px', boxShadow: 2, width: '40px', height: '40px', pointerEvents: 'auto', '&:hover': { bgcolor: '#f5f5f5' } }}>
            <ArrowBackIcon />
          </IconButton>

          <Paper elevation={2} sx={{ p: 1, borderRadius: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5, bgcolor: 'rgba(255,255,255,0.95)', pointerEvents: 'auto' }}>
            <Typography variant="caption" fontWeight="bold" color="primary" sx={{ fontSize: '0.7rem' }}>Sentido da Rota</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ color: '#0EA503', fontWeight: 'bold', fontSize: '0.65rem' }}>Início</Typography>
              <Box sx={{ width: 40, height: 4, borderRadius: '2px', background: 'linear-gradient(to right, #0EA503, #FF8A31)' }} />
              <Typography variant="caption" sx={{ color: '#FF8A31', fontWeight: 'bold', fontSize: '0.65rem' }}>Fim</Typography>
            </Box>
          </Paper>
        </Box>

        <MapContainer center={coords[0] || [-31.76, -52.33]} zoom={15} zoomControl={false} style={{ height: '100%', width: '100%' }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
          {renderGradiente()}
          {paradasTrecho.map((id, i) => {
            const c = getCoords(id);
            if (!c) return null;
            const eOrigem = id === origem.toLowerCase().trim();
            return (
              <Marker key={i} position={c} icon={eOrigem ? iconEmbarque : iconIntermediario}>
                <Popup><Typography variant="body2" fontWeight="bold">{traduzirSigla(id)}</Typography></Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {!modoApenasConsulta && statusFluxo === 'inicial' && (
          <Box sx={{ position: 'absolute', bottom: 'calc(20px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '90%' }}>
            <Button variant="contained" disabled={distanciaAteParada > 150} onClick={handleConfirmarEmbarque} sx={{ borderRadius: '50px', bgcolor: '#C4151C', color: 'white', width: '100%', height: '55px', fontWeight: 'bold' }}>
              Confirmar Embarque
            </Button>
          </Box>
        )}
        
        {statusFluxo === 'votando' && (
          <Box sx={{ position: 'absolute', bottom: 'calc(20px + env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '90%' }}>
            <Paper elevation={3} sx={{ p: 2, borderRadius: '15px', textAlign: 'center', width: '100%', maxWidth: '300px', margin: '0 auto' }}>
              <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1.5 }}>Lotação do Ônibus:</Typography>
              <Stack direction="row" spacing={1} justifyContent="center">
                <Button size="small" variant="contained" sx={{ bgcolor: '#0EA503' }} onClick={() => handleVotarLotacao('vazio')}>Vazio</Button>
                <Button size="small" variant="contained" sx={{ bgcolor: '#FF8A31' }} onClick={() => handleVotarLotacao('medio')}>Médio</Button>
                <Button size="small" variant="contained" sx={{ bgcolor: '#C4151C' }} onClick={() => handleVotarLotacao('lotado')}>Cheio</Button>
              </Stack>
            </Paper>
          </Box>
        )}
      </Box>
    </Box>
  );
}