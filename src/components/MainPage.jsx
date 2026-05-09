import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { Box, Button, Typography, Paper, CircularProgress } from '@mui/material';
import { traduzirSigla } from '../utils/dicionarioParadas';
import 'leaflet/dist/leaflet.css';

// --- CONTROLE DE CÂMERA ---
function RecenterMap({ centro, jaCentralizou }) {
  const map = useMap();
  useEffect(() => {
    if (centro && !jaCentralizou) {
      map.setView(centro, 16);
      setTimeout(() => map.invalidateSize(), 200);
    }
  }, [centro, jaCentralizou, map]);
  return null;
}

function MapInteractionHandler({ setJaCentralizou }) {
  useMapEvents({
    dragstart: () => setJaCentralizou(true),
    zoomstart: () => setJaCentralizou(true),
    touchstart: () => setJaCentralizou(true),
  });
  return null;
}

// --- ÍCONES ---
const iconSaida = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const iconIntermediario = new L.DivIcon({
  className: 'custom-stop-icon',
  html: `<div style="background-color: white; width: 10px; height: 10px; border-radius: 50%; border: 2.5px solid #64748b; box-shadow: 0 0 5px rgba(0,0,0,0.1);"></div>`,
  iconSize: [10, 10], iconAnchor: [5, 5]
});

export default function MainPage({ itinerario, horario, origem, destino, modoApenasConsulta, voltar }) {
  const [paradasData, setParadasData] = useState({});
  const [loading, setLoading] = useState(true);
  const [jaCentralizou, setJaCentralizou] = useState(false);

  useEffect(() => {
    getDocs(collection(db, "paradas")).then(s => {
      const mapeamento = {};
      s.docs.forEach(d => { mapeamento[d.id] = d.data(); });
      setParadasData(mapeamento);
      setLoading(false);
    });
  }, []);

  const extrairId = (p) => (typeof p === 'object' ? p.nome : p);

  const getCoords = (idRaw) => {
    const id = extrairId(idRaw);
    const info = paradasData[id];
    return info?.location ? [info.location.latitude, info.location.longitude] : null;
  };

  // IDs e Coordenadas processadas
  const IDsExibidos = useMemo(() => {
    if (!itinerario?.paradas) return [];
    const listaTotal = itinerario.paradas.map(extrairId);
    if (modoApenasConsulta) return listaTotal;
    const idxIn = listaTotal.indexOf(extrairId(origem));
    const idxOut = listaTotal.indexOf(extrairId(destino));
    return listaTotal.slice(idxIn !== -1 ? idxIn : 0, idxOut !== -1 ? idxOut + 1 : undefined);
  }, [itinerario, origem, destino, modoApenasConsulta]);

  const paradasCoords = IDsExibidos.map(getCoords).filter(c => c !== null);

  // --- LÓGICA DE DIVISÃO POR CORES (ODONTO) ---
  const renderizarLinhasBicolores = () => {
    if (paradasCoords.length < 2) return null;

    const idxOdonto = IDsExibidos.indexOf('odonto');

    // Se não houver Odonto no trajeto, renderiza cor única
    if (idxOdonto === -1) {
      return <Polyline positions={paradasCoords} pathOptions={{ color: '#3D3B8E', weight: 6, opacity: 0.5 }} />;
    }

    const trecho1 = paradasCoords.slice(0, idxOdonto + 1);
    const trecho2 = paradasCoords.slice(idxOdonto);

    return (
      <>
        {/* Trecho Inicial -> Odonto (Azul) */}
        <Polyline positions={trecho1} pathOptions={{ color: '#3D3B8E', weight: 6, opacity: 0.5, lineCap: 'round' }} />
        {/* Odonto -> Final (Laranja/Dourado para contraste) */}
        <Polyline positions={trecho2} pathOptions={{ color: '#58BC82', weight: 6, opacity: 0.5, lineCap: 'round' }} />
      </>
    );
  };

  const idPartida = IDsExibidos[0];
  const coordenadasPartida = getCoords(idPartida);

  if (loading) return <Box sx={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;

  return (
    <Box sx={{ height: '100vh', width: '100vw', position: 'relative' }}>
      <Button 
        onClick={voltar} 
        variant="contained" 
        sx={{ position: 'absolute', top: 20, left: 20, zIndex: 1000, bgcolor: 'white', color: 'black', borderRadius: '12px' }}
      >
       voltar
      </Button>

      <MapContainer 
        center={coordenadasPartida || [-31.765, -52.380]} 
        zoom={15} 
        style={{ height: '100%', width: '100%' }}
        zoomControl={false}
      >
        <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
        
        <RecenterMap centro={coordenadasPartida} jaCentralizou={jaCentralizou} />
        <MapInteractionHandler setJaCentralizou={setJaCentralizou} />

        {/* Linhas Retas com Divisão na Odonto */}
        {renderizarLinhasBicolores()}

        {IDsExibidos.map((id, i) => {
          const coords = getCoords(id);
          if (!coords) return null;
          const ehPartida = i === 0;
          const ehOdonto = id === 'odonto';

          return (
            <Marker key={`${id}-${i}`} position={coords} icon={ehPartida ? iconSaida : iconIntermediario}>
              <Popup>
                <Typography variant="body2" fontWeight="bold">
                  {ehOdonto ? "🦷 " : ""}{traduzirSigla(id)}
                </Typography>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <Paper 
        elevation={0}
        sx={{ 
          position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)', 
          p: 2.5, zIndex: 1000, width: '85%', maxWidth: '380px', 
          borderRadius: '24px', textAlign: 'center',
          bgcolor: '#F9F9F9', backdropFilter: 'blur(10px)',
          boxShadow: '0 10px 40px #504B3A'
        }}
      >
        <Typography variant="h5" fontWeight="900" color="primary">{horario}</Typography>
        <Typography variant="body2" color="text.secondary" fontWeight="600">
          {traduzirSigla(idPartida)} - {traduzirSigla(IDsExibidos[IDsExibidos.length - 1])}
        </Typography>
        
        {/* Legenda de Cores */}
        <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, mt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#3D3B8E', opacity: 0.5 }} />
            <Typography variant="caption">Direção Centro</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: '#58BC82', opacity: 0.5 }} />
            <Typography variant="caption">Direção Anglo</Typography>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}