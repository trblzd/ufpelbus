import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../services/firebase';
import { collection, onSnapshot, doc } from 'firebase/firestore';
import { useLocation } from '../hooks/useLocation'; 
import MainPage from '../components/MainPage'; 
import { traduzirSigla, nomesExtenso, getFavoritos } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import { 
  Container, Box, Tabs, Tab, Paper, Typography, Menu,
  Button, MenuItem, Select, FormControl, InputLabel, ToggleButtonGroup, ToggleButton, CircularProgress, createTheme, ThemeProvider, List, Chip, ListItemButton
} from '@mui/material';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import LogoutIcon from '@mui/icons-material/Logout';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import EditIcon from '@mui/icons-material/Edit';
import PersonalizationPage from './PersonalizationPage';


const theme = createTheme({
  palette: {
    primary: { main: '#154370' }, 
    secondary: { main: '#0EA503' }, 
    warning: { main: '#FF8A31' }, 
    error: { main: '#C4151C' },
    background: { default: '#F9F9F9' },
    text: { primary: '#154370' },
  },
  shape: { borderRadius: 16 },
});

const BusItem = ({ opt, onClick, safeTraduzir }) => {
  const [viagemInfo, setViagemInfo] = useState({ lastStop: null, lotacao: null });

  useEffect(() => {
    const tripId = `${opt.it.id}_${opt.horario.replace(':', '')}`;
    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) {
        const data = d.data();
        setViagemInfo({ 
          lastStop: data.ultimaParada, 
          lotacao: data.lotacaoAtual 
        });
      } else {
        // Reseta se a viagem não estiver mais ativa
        setViagemInfo({ lastStop: null, lotacao: null });
      }
    });
    return () => unsub();
  }, [opt]);

  const getEmojiLotacao = (nivel) => {
    switch (nivel) {
      case 'lotado': return '🔴';
      case 'medio': return '🟡';
      case 'vazio': return '🟢';
      default: return '🟡';
    }
  };

  return (
    <Paper elevation={0} sx={{ mb: 2, border: '1px solid #eee', borderRadius: '16px', overflow: 'hidden' }}>
      <ListItemButton onClick={onClick} sx={{ p: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
  <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1.2 }}>
    {opt.cat}
  </Typography>
  <Typography 
    variant="caption" 
    sx={{ 
      fontSize: '0.6rem', 
      color: '#666',
      fontWeight: '400' 
    }}
  >
  {getEmojiLotacao(viagemInfo.lotacao)}
  </Typography>
  
</Box>
          
          <Typography variant="body2" color="secondary" fontWeight="500">
            {viagemInfo.lastStop 
              ? `Visto por último em: ${safeTraduzir(viagemInfo.lastStop)}` 
              : "Sem Informações"}
          </Typography>
{opt.maisRapida && (
    <Chip 
      label="MAIS RÁPIDO" 
      size="small" 
      color="secondary" 
      sx={{ fontSize: '0.6rem', height: 18, fontWeight: 'bold' }} 
    />
  )}
        </Box>
        <Typography variant="h5" fontWeight="900" color="primary">
          {opt.horario}
        </Typography>
      </ListItemButton>
    </Paper>
  );
};

export default function HomePage({ onLogout }) {
  const { position } = useLocation(); 
  const [modo, setModo] = useState('embarcar'); 
  const [todosItinerarios, setTodosItinerarios] = useState([]);
  const [paradasCoordenadas, setParadasCoordenadas] = useState({});
  const [idsParadasUnicas, setIdsParadasUnicas] = useState([]);
  const [tabLinha, setTabLinha] = useState('Anglo');
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [opcoesEncontradas, setOpcoesEncontradas] = useState([]); 
  const [itinerarioSelecionado, setItinerarioSelecionado] = useState(null);
  const [horarioSelecionado, setHorarioSelecionado] = useState('');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('config');
  const [viagensAtivasData, setViagensAtivasData] = useState({});
  const [anchorEl, setAnchorEl] = useState(null);
  const [siglaSelecionada, setSiglaSelecionada] = useState(null);

  const categorias = {
    teste: ['teste'],
    Anglo: ['anglo', 'anglo21', 'anglo2145', 'anglo730', 'anglo8', 'angloru'],
    Capão: ['anglocapao', 'capaoanglo', 'capaodireito', 'capaodireitobr', 'capaofamedanglo', 'capaolyceu', 'cotadacapao', 'direitocapao', 'famedcapao', 'lyceucapao'],
    ESEF: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira7', 'madeireira9'],
    FaMed: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira18', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira22', 'madeireira7', 'madeireira9', 'anglofamed', 'anglocapao', 'capaofamedanglo', 'cotadacapao', 'direitocapao', 'lyceucapao'],  
    Palma: ['palmacp', 'palmapm']
  };

  const safeTraduzir = (valor) => {
    if (!valor) return "---";
    const siglaStr = typeof valor === 'object' ? valor.nome : valor;
    return traduzirSigla(siglaStr.toString());
  };

  const normalizarNome = (p) => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim();

  const handleOpenMenu = (event) => setAnchorEl(event.currentTarget);
  const handleCloseMenu = () => {
    setAnchorEl(null);
    setSiglaSelecionada(null);
  };

  const handleSalvarNome = (sigla, nome) => {
    const apelidos = JSON.parse(localStorage.getItem("user_apelidos") || "{}");
    apelidos[sigla] = nome;
    localStorage.setItem("user_apelidos", JSON.stringify(apelidos));
    handleCloseMenu();
    window.location.reload();
  };

  useEffect(() => {
    const unsubIt = onSnapshot(collection(db, "itinerarios"), (snap) => {
      const its = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setTodosItinerarios(its);
      const idsSet = new Set();
      its.forEach(it => it.paradas?.forEach(p => idsSet.add(normalizarNome(p))));
      setIdsParadasUnicas(Array.from(idsSet).sort());
      setLoading(false);
    });

    const unsubParadas = onSnapshot(collection(db, "paradas"), (snap) => {
      const coords = {};
      snap.docs.forEach(d => {
        const data = d.data();
        const idMap = d.id.toLowerCase().trim();
        if (data.location) {
          coords[idMap] = {
            lat: data.location.latitude || data.location._lat,
            lng: data.location.longitude || data.location._long
          };
        }
      });
      setParadasCoordenadas(coords);
    });

    const unsubViagens = onSnapshot(collection(db, "viagens_ativas"), (snap) => {
      const data = {};
      snap.docs.forEach(doc => { data[doc.id] = doc.data(); });
      setViagensAtivasData(data);
    });

    return () => { unsubIt(); unsubParadas(); unsubViagens(); };
  }, []);

  useEffect(() => {
    if (position && Object.keys(paradasCoordenadas).length > 0 && idsParadasUnicas.length > 0 && !origemId) {
      let menorDist = Infinity;
      let paradaVencedora = '';
      idsParadasUnicas.forEach(idSelect => {
        const coord = paradasCoordenadas[idSelect];
        if (coord) {
          const d = calculateDistance(position.lat, position.lng, coord.lat, coord.lng);
          if (d < menorDist) {
            menorDist = d;
            paradaVencedora = idSelect;
          }
        }
      });
      if (paradaVencedora && menorDist < 2.5) setOrigemId(paradaVencedora);
    }
  }, [position, paradasCoordenadas, idsParadasUnicas, origemId]);

  const agrupamentoHorarios = useMemo(() => {
    const gruposNormal = {};
    const gruposRU = {};
    const itinerariosDaCategoria = todosItinerarios.filter(it => categorias[tabLinha]?.includes(it.id));

    itinerariosDaCategoria.forEach(it => {
      const paradas = it.paradas.map(normalizarNome);
      const origem = paradas[0];
      const destino = paradas[paradas.length - 1];
      let label = (tabLinha === 'ESEF' || (tabLinha === 'FaMed' && origem.includes('anglo') && destino.includes('anglo')))
        ? `${safeTraduzir(origem)} - ${tabLinha} - ${safeTraduzir(destino)}`
        : `${safeTraduzir(origem)} - ${safeTraduzir(destino)}`;

      const chave = `${origem}-${destino}-${it.passaNoRU}-${label}`;
      const alvo = it.passaNoRU ? gruposRU : gruposNormal;
      if (!alvo[chave]) alvo[chave] = { label, horarios: [] };
      it.horariosaida.forEach(h => {
        if (!alvo[chave].horarios.some(ex => ex.h === h)) alvo[chave].horarios.push({ h, it });
      });
    });

    const ordenar = (g) => Object.values(g).sort((a, b) => {
        const hA = a.horarios.map(x => x.h).sort()[0] || "99:99";
        const hB = b.horarios.map(x => x.h).sort()[0] || "99:99";
        return hA.localeCompare(hB);
    });

    return { gruposNormal: ordenar(gruposNormal), gruposRU: ordenar(gruposRU) };
  }, [tabLinha, todosItinerarios]);

  const handleBusca = () => {
    if (!origemId || !destinoId) return;
    const ori = origemId.toLowerCase().trim();
    const des = destinoId.toLowerCase().trim();
    const agora = new Date();
    const tempoAtualMin = agora.getHours() * 60 + agora.getMinutes();

    let matches = [];
    todosItinerarios.forEach(it => {
      const paradas = it.paradas.map(normalizarNome);
      const idxO = paradas.indexOf(ori);
      const idxD = paradas.indexOf(des, idxO);
      
      if (idxO !== -1 && idxD !== -1 && idxO < idxD) {
        it.horariosaida.forEach(horario => {
          const [h, m] = horario.split(':').map(Number);
          const tempoSaidaMin = (h * 60 + m);
          const duracao = Number(it.duracaoEstimada) || 60;
          const tempoExpiracao = tempoSaidaMin + duracao + 10;

          if (tempoAtualMin > tempoExpiracao) return;

          const tripId = `${it.id}_${horario.replace(':', '')}`;
          const viagem = viagensAtivasData[tripId];
          if (viagem && viagem.ultimaParada) {
            const lastStopIdx = paradas.lastIndexOf(viagem.ultimaParada.toLowerCase().trim());
            if (lastStopIdx > idxO && (tempoAtualMin - tempoSaidaMin) > (duracao * 0.7)) return;
          }

          if (tempoSaidaMin + (idxO * 2) >= tempoAtualMin - 20) {
            matches.push({ 
              it, horario, 
              numParadas: idxD - idxO, 
              tempoRef: tempoSaidaMin, 
              cat: Object.keys(categorias).find(c => categorias[c].includes(it.id)) || "Rota" 
            });
          }
        });
      }
    });

    if (matches.length > 0) {
      const minP = Math.min(...matches.map(m => m.numParadas));
      setOpcoesEncontradas(matches.sort((a, b) => a.tempoRef - b.tempoRef).map(m => ({ ...m, maisRapida: m.numParadas === minP })).slice(0, 5));
    }
  };

if (loading) return <Box sx={{ display: 'flex', height: '100dvh', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>;
  if (view === 'mapa') return <MainPage itinerario={itinerarioSelecionado} horario={horarioSelecionado} origem={origemId} destino={destinoId} modoApenasConsulta={modo === 'verificar'} voltar={() => setView('config')} categoria={tabLinha} />;

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ 
        minHeight: '100dvh', 
        bgcolor: '#E2E8F0', 
        display: 'flex', 
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <Container 
          maxWidth="sm" 
          disableGutters 
          sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            bgcolor: 'white', 
            height: '100dvh', 
            maxHeight: '100dvh',
            width: '100%',
            p: 3, 
            boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
            overflow: 'hidden'
          }}
        >
          <Typography variant="h4" fontWeight="900" color="primary" sx={{ mb: 2, textAlign: 'center', flexShrink: 0 }}>BusUFPel</Typography>
          
          <ToggleButtonGroup 
            value={modo} 
            exclusive 
            onChange={(e, v) => v && setModo(v)} 
            fullWidth 
            sx={{ mb: 2, flexShrink: 0 }}
          >
            <ToggleButton value="embarcar" sx={{ fontWeight: 'bold' }}>IR PARA</ToggleButton>
            <ToggleButton value="verificar" sx={{ fontWeight: 'bold' }}>HORÁRIOS</ToggleButton>
          </ToggleButtonGroup>

          <Box sx={{ 
            flexGrow: 1, 
            overflowY: 'auto', 
            pr: 0.5,
            display: 'flex', // Adicionado para permitir alinhamento interno
            flexDirection: 'column',
            '&::-webkit-scrollbar': { width: '4px' },
            '&::-webkit-scrollbar-thumb': { backgroundColor: '#eee', borderRadius: '10px' }
          }}>
            {modo === 'embarcar' ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, justifyContent: 'center' }}>
                {opcoesEncontradas.length === 0 ? (
                  <>
                    <FormControl fullWidth variant="outlined">
                      <InputLabel id="label-origem" sx={{ backgroundColor: '#FFFFFF', px: 1 }}>Subir em</InputLabel>
                      <Select 
                        labelId="label-origem"
                        value={origemId} 
                        onChange={e => setOrigemId(e.target.value)} 
                        sx={{ borderRadius: '12px' }}
                      >
                        {idsParadasUnicas.map(id => (
                          <MenuItem key={id} value={id}>{safeTraduzir(id)}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <FormControl fullWidth variant="outlined">
                      <InputLabel id="label-destino" sx={{ backgroundColor: '#FFFFFF', px: 1 }}>Descer em</InputLabel>
                      <Select 
                        labelId="label-destino"
                        value={destinoId} 
                        onChange={e => setDestinoId(e.target.value)} 
                        sx={{ borderRadius: '12px' }}
                      >
                        {idsParadasUnicas.map(id => (
                          <MenuItem key={id} value={id}>{safeTraduzir(id)}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>

                    <Button fullWidth variant="contained" onClick={handleBusca} sx={{ py: 2, fontWeight: 'bold', borderRadius: '12px' }}>VERIFICAR ÔNIBUS DISPONÍVEIS</Button>
                  </>
                ) : (
                  <List>
                    {opcoesEncontradas.map((opt, i) => (
                      <BusItem key={i} opt={opt} safeTraduzir={safeTraduzir} onClick={() => { setItinerarioSelecionado(opt.it); setHorarioSelecionado(opt.horario); setView('mapa'); }} />
                    ))}
                    <Button fullWidth onClick={() => setOpcoesEncontradas([])} sx={{ mt: 1, fontWeight: 'bold' }}>VOLTAR PARA BUSCA</Button>
                  </List>
                )}
              </Box>
            ) : (
              <Box>
                <Tabs value={tabLinha} onChange={(e, v) => setTabLinha(v)} variant="scrollable" sx={{ mb: 2, flexShrink: 0 }}>
                  {Object.keys(categorias).map(cat => <Tab key={cat} label={cat} value={cat} sx={{ fontWeight: 'bold' }} />)}
                </Tabs>
                {agrupamentoHorarios.gruposRU.map((g, i) => (
                  <Box key={i} sx={{ mb: 3, p: 2, bgcolor: '#fff9f2', borderRadius: '16px', border: '1px solid #FF8A31' }}>
                    <Typography variant="subtitle2" color="warning.main" fontWeight="bold" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}><RestaurantIcon fontSize="small" /> RU</Typography>
                    <Typography variant="caption" color="textSecondary" fontWeight="bold">{g.label}</Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                      {g.horarios.map((obj, j) => <Button key={j} size="small" variant="contained" color="warning" onClick={() => { setItinerarioSelecionado(obj.it); setHorarioSelecionado(obj.h); setView('mapa'); }}>{obj.h}</Button>)}
                    </Box>
                  </Box>
                ))}
                {agrupamentoHorarios.gruposNormal.map((g, i) => (
                  <Box key={i} sx={{ mb: 3 }}>
                    <Typography variant="subtitle2" color="primary" fontWeight="bold">{g.label}</Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                      {g.horarios.map((obj, j) => <Button key={j} size="small" variant="outlined" sx={{ fontWeight: 'bold', borderRadius: '8px' }} onClick={() => { setItinerarioSelecionado(obj.it); setHorarioSelecionado(obj.h); setView('mapa'); }}>{obj.h}</Button>)}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          <Box sx={{ mt: 2, pt: 1, borderTop: '1px solid #eee', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <Button 
              onClick={handleOpenMenu} 
              startIcon={<EditIcon />} 
              sx={{ color: '#154370', fontWeight: 'bold', textTransform: 'none', fontSize: '0.85rem' }}
            >
              Renomear paradas
            </Button>

            <Menu anchorEl={anchorEl} open={Boolean(anchorEl) && !siglaSelecionada} onClose={handleCloseMenu}>
              {Object.keys(nomesExtenso).map((sigla) => (
                <MenuItem key={sigla} onClick={() => setSiglaSelecionada(sigla)}>{sigla.toUpperCase()}</MenuItem>
              ))}
            </Menu>

            <Menu anchorEl={anchorEl} open={Boolean(siglaSelecionada)} onClose={handleCloseMenu}>
              <MenuItem disabled sx={{ fontWeight: 'bold', color: 'primary.main' }}>Escolha o nome para {siglaSelecionada?.toUpperCase()}:</MenuItem>
              {siglaSelecionada && nomesExtenso[siglaSelecionada].map((nome) => (
                <MenuItem key={nome} onClick={() => handleSalvarNome(siglaSelecionada, nome)}>{nome}</MenuItem>
              ))}
            </Menu>

            <Button 
              onClick={onLogout} 
              variant="outlined" 
              color="error" 
              startIcon={<LogoutIcon />} 
              sx={{ borderRadius: '12px', px: 4, fontWeight: 'bold', textTransform: 'none', width: '100%' }}
            >
              Sair
            </Button>
          </Box>
        </Container>
      </Box>
    </ThemeProvider>
  );
}