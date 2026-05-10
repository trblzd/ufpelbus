import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, serverTimestamp, onSnapshot, deleteDoc } from 'firebase/firestore';
import { Box, Button, Typography, Paper, CircularProgress, Stack, Chip } from '@mui/material';
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

  // Lógica de Tempo Relativo (Atualizado há X min)
  const formatarRelativo = (timestamp) => {
    if (!timestamp) return "...";
    const agora = new Date();
    const dataPost = timestamp.toDate();
    const difSegundos = Math.floor((agora - dataPost) / 1000);
    if (difSegundos < 60) return "Agora mesmo";
    const minutos = Math.floor(difSegundos / 60);
    return `Há ${minutos} min`;
  };

  // Lógica de Estimativa (Chega em X min)
  const estimativaChegada = useMemo(() => {
    if (!viagemAtiva || !origem || !itinerario || modoApenasConsulta) return null;
    const lista = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim());
    const idxAt = lista.indexOf(viagemAtiva.ultimaParada.toLowerCase().trim());
    const idxEu = lista.indexOf(origem.toLowerCase().trim());
    if (idxAt === -1 || idxEu === -1 || idxAt >= idxEu) return null;
    return (idxEu - idxAt) * 4; // 4 min médios por parada
  }, [viagemAtiva, origem, itinerario, modoApenasConsulta]);

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
    <Box sx={{ height: '100vh', width: '100vw', position: 'relative' }}>
      
      {/* LEGENDA DE CORES (INÍCIO -> FIM) */}
      <Paper elevation={3} sx={{ position: 'absolute', top: 20, left: 20, zIndex: 1000, p: 1.5, borderRadius: '12px', display: 'flex', flexDirection: 'column', gap: 1, bgcolor: 'rgba(255,255,255,0.9)' }}>
        <Typography variant="caption" fontWeight="bold" color="primary">SENTIDO DA ROTA</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" sx={{ color: '#0EA503', fontWeight: 'bold' }}>Início</Typography>
          <Box sx={{ width: 60, height: 6, borderRadius: '3px', background: 'linear-gradient(to right, #0EA503, #FF8A31)' }} />
          <Typography variant="caption" sx={{ color: '#FF8A31', fontWeight: 'bold' }}>Fim</Typography>
        </Box>
      </Paper>

      <Button onClick={voltar} variant="contained" startIcon={<ArrowBackIcon />} sx={{ position: 'absolute', top: 20, right: 20, zIndex: 1000, bgcolor: 'white', color: '#154370', borderRadius: '12px', textTransform: 'none', fontWeight: 'bold' }}>Voltar</Button>
      
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
        <Box sx={{ position: 'absolute', bottom: 155, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '90%' }}>
          <Button variant="contained" disabled={distanciaAteParada > 150} onClick={handleConfirmarEmbarque} sx={{ borderRadius: '50px', bgcolor: '#C4151C', color: 'white', width: '100%', height: '55px', fontWeight: 'bold' }}>
            CONFIRMAR EMBARQUE
          </Button>
        </Box>
      )}

      {statusFluxo === 'votando' && (
        <Box sx={{ position: 'absolute', bottom: 155, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, width: '90%' }}>
          <Paper elevation={10} sx={{ p: 2, borderRadius: '20px', textAlign: 'center', border: '2px solid #FF8A31' }}>
            <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1.5 }}>LOTAÇÃO DO ÔNIBUS:</Typography>
            <Stack direction="row" spacing={1} justifyContent="center">
              <Button size="small" variant="contained" sx={{ bgcolor: '#0EA503' }} onClick={() => handleVotarLotacao('vazio')}>Vazio</Button>
              <Button size="small" variant="contained" sx={{ bgcolor: '#FF8A31' }} onClick={() => handleVotarLotacao('medio')}>Médio</Button>
              <Button size="small" variant="contained" sx={{ bgcolor: '#C4151C' }} onClick={() => handleVotarLotacao('lotado')}>Cheio</Button>
            </Stack>
          </Paper>
        </Box>
      )}

      <Paper elevation={4} sx={{ position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', p: 2, zIndex: 1000, width: '90%', borderRadius: '20px', textAlign: 'center', border: '2px solid #154370' }}>
        <Typography variant="h6" fontWeight="bold" color="primary">{categoria} • {horario}</Typography>
        
        <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
            {viagemAtiva ? (
              <>Visto em: <b>{traduzirSigla(viagemAtiva.ultimaParada)}</b> • <span style={{color: '#FF8A31', fontWeight: 'bold'}}>{formatarRelativo(viagemAtiva.atualizadoEm)}</span></>
            ) : "Aguardando primeiro embarque..."}
        </Typography>

        {estimativaChegada && (
          <Chip label={`Chega em aprox. ${estimativaChegada} min`} color="secondary" size="small" sx={{ mt: 1, fontWeight: 'bold' }} />
        )}
      </Paper>
    </Box>
  );
}