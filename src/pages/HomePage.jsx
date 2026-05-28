import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../services/firebase';
import { collection, onSnapshot, doc, setDoc } from 'firebase/firestore';
import { useLocation } from '../hooks/useLocation'; 
import MainPage from '../components/MainPage'; 
import { traduzirSigla, nomesExtenso } from '../utils/dicionarioParadas';
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
import { getAuth, signOut } from 'firebase/auth';

const theme = createTheme({
  palette: {
    primary: { main: '#00418F' }, 
    secondary: { main: '#0EA503' }, 
    warning: { main: '#FF8A31' }, 
    error: { main: '#C4151C' },
    background: { default: '#F9F9F9' },
    text: { primary: '#00418F' },
  },
  shape: { borderRadius: 16 },
});

const BusItem = ({ opt, onClick, safeTraduzir }) => {
  const [viagemInfo, setViagemInfo] = useState({ lastStop: null, lotacao: null, atualizadoEm: null });

  useEffect(() => {
    const tripId = `${opt.it.id}_${opt.horario.replace(':', '')}`;
    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) {
        const data = d.data();
        setViagemInfo({ 
          lastStop: data.ultimaParada, 
          lotacao: data.lotacaoAtual,
          atualizadoEm: data.atualizadoEm
        });
      } else {
        setViagemInfo({ lastStop: null, lotacao: null, atualizadoEm: null });
      }
    });
    return () => unsub();
  }, [opt]);

  const isExpirado = useMemo(() => {
    if (!viagemInfo.atualizadoEm || !opt.it?.duracaoEstimada) return false;
    
    const agora = new Date();
    const dataPost = viagemInfo.atualizadoEm.toDate 
      ? viagemInfo.atualizadoEm.toDate() 
      : new Date(viagemInfo.atualizadoEm.seconds * 1000);
      
    const diferencaMinutos = Math.floor((agora - dataPost) / 60000);
    return diferencaMinutos > Number(opt.it.duracaoEstimada);
  }, [viagemInfo.atualizadoEm, opt.it]);

  const formatarRelativo = (timestamp) => {
    if (!timestamp) return "";
    const agora = new Date();
    const dataPost = timestamp.toDate ? timestamp.toDate() : new Date(timestamp.seconds * 1000);
    const difSegundos = Math.floor((agora - dataPost) / 1000);
    if (difSegundos < 60) return "há menos de 1 minuto";
    return `há ${Math.floor(difSegundos / 60)} minutos`;
  };

  const getEmojiLotacao = (nivel) => {
    if (isExpirado) return '🟡'; 
    switch (nivel) {
      case 'lotado': return '🔴';
      case 'medio': return '🟡';
      case 'vazio': return '🟢';
      default: return '🟡';
    }
  };

  const temInformacaoAtiva = viagemInfo.lastStop && !isExpirado;

  return (
    <Paper elevation={0} sx={{ mb: 2, border: '1px solid #eee', borderRadius: '16px', overflow: 'hidden' }}>
      <ListItemButton onClick={onClick} sx={{ p: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
            <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1.2 }}>
              {opt.cat}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#666', fontWeight: '400' }}>
              {getEmojiLotacao(viagemInfo.lotacao)}
            </Typography>
          </Box>
          
          <Typography variant="body2" color="secondary" fontWeight="500">
            {temInformacaoAtiva
              ? `Visto em: ${safeTraduzir(viagemInfo.lastStop)} ${formatarRelativo(viagemInfo.atualizadoEm)}` 
              : "Sem Informações"}
          </Typography>

          {opt.maisRapida && temInformacaoAtiva && (
            <Chip 
              label="MAIS RÁPIDO" 
              size="small" 
              color="secondary" 
              sx={{ fontSize: '0.6rem', height: 18, fontWeight: 'bold', mt: 0.5 }} 
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
  const [categoriaSelecionada, setCategoriaSelecionada] = useState('Anglo');
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('config');
  const [viagensAtivasData, setViagensAtivasData] = useState({});
  const [favoritos, setFavoritos] = useState([]);

  const auth = getAuth();
  const usuarioLogado = auth.currentUser;

  const categoriesConfig = {
    Anglo: ['anglo', 'anglo2145', 'anglo730', 'anglo8', 'angloru'],
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

  const handleFirebaseLogout = async () => {
    try {
      await signOut(auth);
      if (onLogout) onLogout();
    } catch (error) {
      console.error("Erro ao realizar logout no Firebase:", error);
    }
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

    let unsubFavoritos = () => {};
    if (usuarioLogado) {
      unsubFavoritos = onSnapshot(doc(db, "usuarios", usuarioLogado.uid, "favoritos", "dados"), (docSnap) => {
        if (docSnap.exists()) {
          setFavoritos(docSnap.data().lista || []);
        } else {
          const locais = JSON.parse(localStorage.getItem("user_favoritos") || "[]");
          setFavoritos(locais);
        }
      });
    }

    return () => { unsubIt(); unsubParadas(); unsubViagens(); unsubFavoritos(); };
  }, [usuarioLogado]);

  // CORREÇÃO GEOGRÁFICA: Compara as distâncias de forma estrita assim que as coordenadas e a localização entram no estado
  useEffect(() => {
    if (position && position.lat && position.lng && Object.keys(paradasCoordenadas).length > 0 && idsParadasUnicas.length > 0) {
      let menorDist = Infinity;
      let paradaVencedora = '';

      idsParadasUnicas.forEach(idSelect => {
        const coord = paradasCoordenadas[idSelect];
        if (coord && coord.lat && coord.lng) {
          const d = calculateDistance(position.lat, position.lng, coord.lat, coord.lng);
          if (d < menorDist) {
            menorDist = d;
            paradaVencedora = idSelect;
          }
        }
      });

      if (paradaVencedora && paradaVencedora !== origemId) {
        setOrigemId(paradaVencedora);
      }
    }
  }, [position, paradasCoordenadas, idsParadasUnicas]);

  const agrupamentoHorarios = useMemo(() => {
    const gruposNormal = {};
    const gruposRU = {};
    const itinerariosDaCategoria = todosItinerarios.filter(it => categoriesConfig[tabLinha]?.includes(it.id));

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
              cat: Object.keys(categoriesConfig).find(c => categoriesConfig[c].includes(it.id)) || "Rota" 
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

  if (loading || !position || !position.lat || !position.lng) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh', alignItems: 'center', justifyContent: 'center', gap: 2, bgcolor: '#E2E8F0' }}>
        <CircularProgress />
        <Typography variant="body2" color="textSecondary" fontWeight="500">Obtendo sua localização...</Typography>
      </Box>
    );
  }
  if (view === 'mapa') return <MainPage itinerario={itinerarioSelecionado} horario={horarioSelecionado} origem={origemId} destino={destinoId} modoApenasConsulta={modo === 'verificar'} voltar={() => setView('config')} categoria={categoriaSelecionada} />;
  if (view === 'personalizar') return <PersonalizationPage idsParadas={idsParadasUnicas} onVoltar={() => setView('config')} />;

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
          <Typography variant="h4" fontWeight="900" color="primary" sx={{ mb: 2, textAlign: 'center', flexShrink: 0 }}>busepel</Typography>
          
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
            display: 'flex',
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
                        {idsParadasUnicas.map(id => {
                          const isFav = favoritos.includes(id);
                          return (
                            <MenuItem 
                              key={id} 
                              value={id}
                              sx={{ 
                                backgroundColor: isFav ? '#EBF4FF' : 'transparent',
                                fontWeight: isFav ? 'bold' : 'normal',
                                '&:hover': {
                                  backgroundColor: isFav ? '#D1E6FF' : '#F5F5F5'
                                }
                              }}
                            >
                              {safeTraduzir(id)} {isFav && '⭐'}
                            </MenuItem>
                          );
                        })}
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
                        {idsParadasUnicas.map(id => {
                          const isFav = favoritos.includes(id);
                          return (
                            <MenuItem 
                              key={id} 
                              value={id}
                              sx={{ 
                                backgroundColor: isFav ? '#EBF4FF' : 'transparent',
                                fontWeight: isFav ? 'bold' : 'normal',
                                '&:hover': {
                                  backgroundColor: isFav ? '#D1E6FF' : '#F5F5F5'
                                }
                              }}
                            >
                              {safeTraduzir(id)} {isFav && '⭐'}
                            </MenuItem>
                          );
                        })}
                      </Select>
                    </FormControl>

                    <Button fullWidth variant="contained" onClick={handleBusca} sx={{ py: 2, fontWeight: 'bold', borderRadius: '12px' }}>VERIFICAR ÔNIBUS DISPONÍVEIS</Button>
                  </>
                ) : (
                  <List>
                    {opcoesEncontradas.map((opt, i) => (
                      <BusItem 
                        key={i} 
                        opt={opt} 
                        safeTraduzir={safeTraduzir} 
                        onClick={() => { 
                          setItinerarioSelecionado(opt.it); 
                          setHorarioSelecionado(opt.horario); 
                          setCategoriaSelecionada(opt.cat); 
                          setView('mapa'); 
                        }} 
                      />
                    ))}
                    <Button fullWidth onClick={() => setOpcoesEncontradas([])} sx={{ mt: 1, fontWeight: 'bold' }}>VOLTAR PARA BUSCA</Button>
                  </List>
                )}
              </Box>
            ) : (
              <Box>
                <Tabs value={tabLinha} onChange={(e, v) => setTabLinha(v)} variant="scrollable" sx={{ mb: 2, flexShrink: 0 }}>
                  {Object.keys(categoriesConfig).map(cat => <Tab key={cat} label={cat} value={cat} sx={{ fontWeight: 'bold' }} />)}
                </Tabs>
                {agrupamentoHorarios.gruposRU.map((g, i) => (
                  <Box key={i} sx={{ mb: 3, p: 2, bgcolor: '#fff9f2', borderRadius: '16px', border: '1px solid #FF8A31' }}>
                    <Typography variant="subtitle2" color="warning.main" fontWeight="bold" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}><RestaurantIcon fontSize="small" /> RU</Typography>
                    <Typography variant="caption" color="textSecondary" fontWeight="bold">{g.label}</Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                      {g.horarios.map((obj, j) => (
                        <Button 
                          key={j} 
                          size="small" 
                          variant="contained" 
                          color="warning" 
                          onClick={() => { 
                            setItinerarioSelecionado(obj.it); 
                            setHorarioSelecionado(obj.h); 
                            setCategoriaSelecionada(tabLinha); 
                            setView('mapa'); 
                          }}
                        >
                          {obj.h}
                        </Button>
                      ))}
                    </Box>
                  </Box>
                ))}
                {agrupamentoHorarios.gruposNormal.map((g, i) => (
                  <Box key={i} sx={{ mb: 3 }}>
                    <Typography variant="subtitle2" color="primary" fontWeight="bold">{g.label}</Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                      {g.horarios.map((obj, j) => (
                        <Button 
                          key={j} 
                          size="small" 
                          variant="outlined" 
                          sx={{ fontWeight: 'bold', borderRadius: '8px' }} 
                          onClick={() => { 
                            setItinerarioSelecionado(obj.it); 
                            setHorarioSelecionado(obj.h); 
                            setCategoriaSelecionada(tabLinha); 
                            setView('mapa'); 
                          }}
                        >
                          {obj.h}
                        </Button>
                      ))}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          <Box sx={{ mt: 2, pt: 1, borderTop: '1px solid #eee', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, flexShrink: 0 }}>
            <Button 
              onClick={() => setView('personalizar')} 
              startIcon={<EditIcon />} 
              sx={{ color: '#00418F', fontWeight: 'bold', textTransform: 'none', fontSize: '0.85rem' }}
            >
              Personalizar
            </Button>

            <Button 
              onClick={handleFirebaseLogout} 
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