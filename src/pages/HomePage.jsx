import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../services/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { useLocation } from '../hooks/useLocation';
import MainPage from '../components/MainPage'; 
import { traduzirSigla, nomesExtenso, salvarApelido } from '../utils/dicionarioParadas'; 
import { calculateDistance } from '../utils/geoUtils';
import { 
  Container, Box, Tabs, Tab, Paper, Typography, IconButton, Modal,
  Button, MenuItem, Select, FormControl, InputLabel, ToggleButtonGroup, ToggleButton, CircularProgress, createTheme, ThemeProvider, Alert
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import CloseIcon from '@mui/icons-material/Close';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';

const theme = createTheme({
  palette: {
    primary: { main: '#3D3B8E' },
    secondary: { main: '#58BC82' },
    background: { default: '#FFFFFF', paper: '#F9F9F9' },
    text: { primary: '#504B3A' },
  },
  shape: { borderRadius: 16 },
});

export default function HomePage() {
  const { position, error: gpsError } = useLocation();
  const [modo, setModo] = useState('embarcar'); 
  const [todosItinerarios, setTodosItinerarios] = useState([]);
  const [paradasCoords, setParadasCoords] = useState([]);
  const [idsParadasUnicas, setIdsParadasUnicas] = useState([]);
  const [tabLinha, setTabLinha] = useState('Anglo');
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [itinerarioSelecionado, setItinerarioSelecionado] = useState(null);
  const [horarioSelecionado, setHorarioSelecionado] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('config');
  const [openModal, setOpenModal] = useState(false);
  const [renderTrigger, setRenderTrigger] = useState(0);

  const categorias = {
    Anglo: ['anglo', 'anglo21', 'anglo2145', 'anglo730', 'anglo8', 'angloru'],
    Capão: ['anglocapao', 'capaoanglo', 'capaodireito', 'capaodireitobr', 'capaofamedanglo', 'capaolyceu', 'cotadacapao', 'direitocapao', 'famedcapao', 'lyceucapao'],
    ESEF: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira7', 'madeireira9'],
    FaMed: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira18', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira22', 'madeireira7', 'madeireira9', 'anglofamed', 'anglocapao', 'capaofamedanglo', 'cotadacapao', 'direitocapao', 'lyceucapao'],  
    Madeireira: ['anglo21', 'angloru', 'madeireira7', 'madeireira9', 'madeireira11', 'madeireira15', 'madeireira16'],
    Palma: ['palmacp', 'palmapm']
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [itinerariosSnap, paradasSnap] = await Promise.all([
          getDocs(collection(db, "itinerarios")),
          getDocs(collection(db, "paradas"))
        ]);

        const listaIt = itinerariosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        const listaPa = paradasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        
        setTodosItinerarios(listaIt);
        setParadasCoords(listaPa);

        const idsSet = new Set();
        listaIt.forEach(it => {
          it.paradas?.forEach(p => {
            const id = (typeof p === 'object' ? p.nome : p)?.toLowerCase().trim();
            if (id && id !== "undefined") idsSet.add(id);
          });
        });
        setIdsParadasUnicas(Array.from(idsSet).sort());
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    };
    fetchData();
  }, []);

  // BUSCA DA PARADA MAIS PRÓXIMA (CORRIGIDA)
  useEffect(() => {
    if (position && paradasCoords.length > 0 && !origemId) {
      let melhorParada = null;
      let menorDistancia = Infinity;

      paradasCoords.forEach(parada => {
        // Tentamos ler todas as formas possíveis de latitude/longitude que podem estar no Firebase
        const lat = parada.location?.latitude || parada.location?._lat;
        const lng = parada.location?.longitude || parada.location?._long;

        if (lat && lng) {
          const dist = calculateDistance(position.lat, position.lng, lat, lng);
          
          // Debug para você ver no console qual distância ele está pegando
          // console.log(`Distância até ${parada.id}: ${dist.toFixed(0)}m`);

          if (dist < menorDistancia) {
            menorDistancia = dist;
            melhorParada = parada.id.toLowerCase().trim();
          }
        }
      });

      if (melhorParada) {
        setOrigemId(melhorParada);
      }
    }
  }, [position, paradasCoords, origemId]);

  const itinerariosAgrupados = useMemo(() => {
    const filtrados = todosItinerarios.filter(it => categorias[tabLinha]?.includes(it.id));
    const grupos = {};
    filtrados.forEach(it => {
      if (!it.paradas || it.paradas.length === 0) return;
      const p0 = (typeof it.paradas[0] === 'object' ? it.paradas[0].nome : it.paradas[0])?.toLowerCase();
      const pF = (typeof it.paradas[it.paradas.length-1] === 'object' ? it.paradas[it.paradas.length-1].nome : it.paradas[it.paradas.length-1])?.toLowerCase();
      if (!p0 || !pF) return;
      const chave = `${p0}-${pF}-${it.passaNoRU ? 'RU' : 'DIR'}`;
      if (!grupos[chave]) {
        grupos[chave] = { 
          nome: it.passaNoRU ? `${traduzirSigla(p0)} - RU - ${traduzirSigla(pF)}` : `${traduzirSigla(p0)} - ${traduzirSigla(pF)}`,
          horarios: [], primeiro: '' 
        };
      }
      it.horariosaida.forEach(h => grupos[chave].horarios.push({ hora: h, it }));
    });
    return Object.values(grupos).map(g => {
      g.horarios.sort((a,b) => a.hora.localeCompare(b.hora));
      g.primeiro = g.horarios[0]?.hora || '99:99';
      return g;
    }).sort((a,b) => a.primeiro.localeCompare(b.primeiro));
  }, [todosItinerarios, tabLinha, renderTrigger]);

  if (view === 'mapa') return <MainPage itinerario={itinerarioSelecionado} horario={horarioSelecionado} origem={origemId} destino={destinoId} modoApenasConsulta={modo === 'verificar'} voltar={() => setView('config')} />;

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 4 }}>
        <Container maxWidth="sm">
          <Box sx={{ position: 'relative', mb: 4, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <Typography variant="h4" fontWeight="900" color="primary">BusUFPel</Typography>
            <IconButton onClick={() => setOpenModal(true)} sx={{ position: 'absolute', right: 0, color: 'secondary.main' }}><EditIcon /></IconButton>
          </Box>
          
          <Paper sx={{ p: 3, borderRadius: '24px', boxShadow: '0 12px 40px rgba(80,75,58,0.1)', border: '1px solid #EEE' }}>
            <ToggleButtonGroup value={modo} exclusive onChange={(e, v) => v && setModo(v)} fullWidth sx={{ mb: 3, bgcolor: '#F5F5F5', p: 0.5, borderRadius: '16px' }}>
              <ToggleButton value="embarcar" sx={{ borderRadius: '12px', border: 'none' }}>EMBARCAR</ToggleButton>
              <ToggleButton value="verificar" sx={{ borderRadius: '12px', border: 'none' }}>HORÁRIOS</ToggleButton>
            </ToggleButtonGroup>

            {gpsError && <Alert severity="warning" sx={{ mb: 2, borderRadius: '12px' }}>Ative o GPS para sugestão de partida.</Alert>}

            {loading ? <Box sx={{ textAlign: 'center', p: 4 }}><CircularProgress /></Box> : modo === 'embarcar' ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <FormControl fullWidth>
                  <InputLabel>Onde você está?</InputLabel>
                  <Select 
                    value={origemId} 
                    label="Onde você está?" 
                    onChange={e => setOrigemId(e.target.value)}
                    sx={{ borderRadius: '16px' }}
                    startAdornment={position && <GpsFixedIcon sx={{ mr: 1, color: 'secondary.main', fontSize: 20 }} />}
                  >
                    {idsParadasUnicas.map(id => <MenuItem key={id} value={id}>{traduzirSigla(id)}</MenuItem>)}
                  </Select>
                </FormControl>
                
                <FormControl fullWidth>
                  <InputLabel>Para onde vai?</InputLabel>
                  <Select value={destinoId} label="Para onde vai?" onChange={e => setDestinoId(e.target.value)} sx={{ borderRadius: '16px' }}>
                    {idsParadasUnicas.map(id => <MenuItem key={id} value={id}>{traduzirSigla(id)}</MenuItem>)}
                  </Select>
                </FormControl>
                
                <Button 
                  fullWidth variant="contained" 
                  disabled={!origemId || !destinoId} 
                  onClick={() => { setView('mapa'); setHorarioSelecionado('Em tempo real'); }} 
                  sx={{ py: 2, fontWeight: 'bold', mt: 1, borderRadius: '16px' }}
                >
                  Localizar Ônibus
                </Button>
              </Box>
            ) : (
              <Box>
                <Tabs value={tabLinha} onChange={(e, v) => setTabLinha(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2 }}>
                  {Object.keys(categorias).map(cat => <Tab key={cat} label={cat} value={cat} sx={{ fontWeight: 'bold' }} />)}
                </Tabs>
                <Box sx={{ maxHeight: '60vh', overflowY: 'auto' }}>
                  {itinerariosAgrupados.map((grupo, i) => (
                    <Paper key={i} sx={{ p: 2, mb: 2, borderRadius: '16px', bgcolor: 'background.paper', border: '1px solid #F0F0F0' }}>
                      <Typography variant="subtitle2" fontWeight="800" color="primary" sx={{ mb: 1 }}>{grupo.nome}</Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {grupo.horarios.map((h, j) => (
                          <Button key={j} size="small" variant="outlined" onClick={() => { setItinerarioSelecionado(h.it); setHorarioSelecionado(h.hora); setView('mapa'); }}>{h.hora}</Button>
                        ))}
                      </Box>
                    </Paper>
                  ))}
                </Box>
              </Box>
            )}
          </Paper>

          {/* MODAL DE APELIDOS */}
          <Modal open={openModal} onClose={() => setOpenModal(false)}>
            <Box sx={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '90%', maxWidth: '400px', bgcolor: 'white', borderRadius: '24px', p: 4, maxHeight: '80vh', overflowY: 'auto' }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}><Typography variant="h6" fontWeight="bold">Configurar Nomes</Typography><IconButton onClick={() => setOpenModal(false)}><CloseIcon /></IconButton></Box>
              {idsParadasUnicas.map(sigla => {
                const opcoes = nomesExtenso[sigla] || [sigla.toUpperCase()];
                const salvo = JSON.parse(localStorage.getItem('user_apelidos') || '{}')[sigla] || opcoes[0];
                return (
                  <FormControl key={sigla} fullWidth sx={{ mb: 2 }} variant="standard">
                    <Typography variant="caption" fontWeight="bold" color="secondary">{sigla.toUpperCase()}</Typography>
                    <Select value={salvo} onChange={(e) => { salvarApelido(sigla, e.target.value); setRenderTrigger(v => v + 1); }}>
                      {opcoes.map(o => <MenuItem key={o} value={o}>{o}</MenuItem>)}
                    </Select>
                  </FormControl>
                );
              })}
            </Box>
          </Modal>
        </Container>
      </Box>
    </ThemeProvider>
  );
}