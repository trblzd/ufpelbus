import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { useLocation } from '../hooks/useLocation';
import { traduzirSigla } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import { 
  calcularHorarioEstimadoParada, 
  calcularTempoParaOnibusChegarAteVoce,
  calcularHorarioChegadaOnibusAteVoce 
} from '../services/transporteService';
import { 
  Container, Box, Tabs, Tab, Paper, Typography, Button, 
  MenuItem, Select, FormControl, InputLabel, ToggleButtonGroup, 
  ToggleButton, CircularProgress, createTheme, ThemeProvider, 
  List, Chip, ListItemButton 
} from '@mui/material';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import LogoutIcon from '@mui/icons-material/Logout';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import EditIcon from '@mui/icons-material/Edit';
import { getAuth, signOut } from 'firebase/auth';
import { useAppData } from '../App';

// ==================== CONFIGURAÇÕES ====================

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

const PARADAS_IGNORADAS = ['int_', 'ponto-indefinido'];

// ==================== COMPONENTE DE ITEM DE ÔNIBUS ====================

const BusItem = ({ opt, onClick, safeTraduzir }) => {
  const [viagemInfo, setViagemInfo] = useState({ lastStop: null, lotacao: null, atualizadoEm: null });
  const [horarioEstimado, setHorarioEstimado] = useState(null);
  const [carregandoEstimativa, setCarregandoEstimativa] = useState(false);
  const [tempoParaOnibusChegar, setTempoParaOnibusChegar] = useState(null);
  const [carregandoTempo, setCarregandoTempo] = useState(false);
  const [horarioChegadaOnibus, setHorarioChegadaOnibus] = useState(null);
  
  // Buscar informações da viagem ativa
  useEffect(() => {
    if (!opt?.it?.id || !opt?.horario) return;
    
    const dataAtual = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const tripId = `${opt.it.id}_${opt.horario.replace(':', '')}_${dataAtual}`;
    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) {
        setViagemInfo(d.data());
      } else {
        setViagemInfo({ lastStop: null, lotacao: null, atualizadoEm: null });
      }
    });
    
    return () => unsub();
  }, [opt]);

  // Buscar horário de chegada do ônibus até você
  useEffect(() => {
    const buscarHorarioChegadaOnibus = async () => {
      if (!opt?.it?.id || !opt?.horario || !opt?.origem || !opt?.paradasLista) return;
      if (!viagemInfo || viagemInfo.indiceParada === undefined) return;
      
      try {
        const paradasLista = opt.paradasLista || [];
        const indiceAtualOnibus = viagemInfo.indiceParada || 0;
        
        // Encontrar todas as ocorrências da origem
        const idxsOrigem = [];
        paradasLista.forEach((p, i) => {
          if (p === opt.origem) idxsOrigem.push(i);
        });
        
        // Verificar se o ônibus já passou de todas as ocorrências
        let passouTodas = true;
        for (const idx of idxsOrigem) {
          if (idx > indiceAtualOnibus) {
            passouTodas = false;
            break;
          }
        }
        
        if (passouTodas && idxsOrigem.length > 0) {
          setHorarioChegadaOnibus({
            horarioEstimado: null,
            status: 'passou',
            mensagem: 'O ônibus já passou da sua parada!'
          });
          return;
        }
        
        const resultado = await calcularHorarioChegadaOnibusAteVoce(
          opt.it.id,
          paradasLista,
          opt.horario,
          opt.origem,
          indiceAtualOnibus
        );
        
        if (resultado) {
          setHorarioChegadaOnibus(resultado);
        }
      } catch (e) {
        console.warn("Erro ao buscar horário de chegada:", e);
      }
    };
    
    buscarHorarioChegadaOnibus();
  }, [opt, viagemInfo]);

  // Buscar tempo para ônibus chegar até você
  useEffect(() => {
    const buscarTempoEstimado = async () => {
      if (!opt?.it?.id || !opt?.horario || !opt?.origem || !opt?.idxO) return;
      if (!viagemInfo || viagemInfo.indiceParada === undefined) return;
      
      setCarregandoTempo(true);
      try {
        // Criar objeto viagemAtiva com o índice atual do ônibus
        const viagemAtiva = { indiceParada: viagemInfo.indiceParada || 0 };
        
        const resultado = await calcularTempoParaOnibusChegarAteVoce(
          viagemAtiva,
          opt.it,
          opt.origem,
          opt.horario
        );
        if (resultado) {
          setTempoParaOnibusChegar(resultado);
        }
      } catch (e) {
        console.warn("Erro ao buscar tempo estimado:", e);
      } finally {
        setCarregandoTempo(false);
      }
    };
    
    buscarTempoEstimado();
  }, [opt, viagemInfo]);

  // Buscar horário estimado de chegada ao destino
  useEffect(() => {
    const buscarHorarioEstimado = async () => {
      if (!opt?.it?.id || !opt?.horario || !opt?.destino || !opt?.paradasLista) {
        return;
      }
      
      setCarregandoEstimativa(true);
      try {
        const resultado = await calcularHorarioEstimadoParada(
          opt.it.id,
          opt.paradasLista,
          opt.horario,
          opt.destino
        );
        if (resultado) {
          setHorarioEstimado(resultado);
        }
      } catch (e) {
        console.warn("Erro ao buscar horário estimado:", e);
      } finally {
        setCarregandoEstimativa(false);
      }
    };
    
    buscarHorarioEstimado();
  }, [opt]);

  const isExpirado = useMemo(() => {
    if (!viagemInfo.atualizadoEm || !opt.it?.duracaoEstimada) return false;
    const agora = new Date();
    const dataPost = viagemInfo.atualizadoEm.toDate?.() || new Date(viagemInfo.atualizadoEm.seconds * 1000);
    return Math.floor((agora - dataPost) / 60000) > Number(opt.it.duracaoEstimada);
  }, [viagemInfo.atualizadoEm, opt.it]);

  const formatarRelativo = (timestamp) => {
    if (!timestamp) return "";
    const dataPost = timestamp.toDate?.() || new Date(timestamp.seconds * 1000);
    const difSegundos = Math.floor((Date.now() - dataPost) / 1000);
    if (difSegundos < 60) return "há menos de 1 minuto";
    return `há ${Math.floor(difSegundos / 60)} minutos`;
  };

  const getEmojiLotacao = (nivel) => {
    if (isExpirado) return '🟡';
    if (nivel === 'lotado') return '🔴';
    if (nivel === 'medio') return '🟡';
    if (nivel === 'vazio') return '🟢';
    return '🟡';
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
            <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#666' }}>
              {getEmojiLotacao(viagemInfo.lotacao)}
            </Typography>
          </Box>
          
          {/* Última parada conhecida */}
          <Typography variant="body2" color="secondary" fontWeight="500">
            {temInformacaoAtiva 
              ? `Visto em: ${safeTraduzir(viagemInfo.lastStop)} ${formatarRelativo(viagemInfo.atualizadoEm)}` 
              : "Sem Informações"}
          </Typography>
          
          {/* HORÁRIO DE CHEGADA DO ÔNIBUS ATÉ VOCÊ */}
          {horarioChegadaOnibus && horarioChegadaOnibus.status === 'chegando' && (
            <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 0.5, fontWeight: 'bold' }}>
              ⏰ Chega às {horarioChegadaOnibus.horarioEstimado} ({horarioChegadaOnibus.paradasRestantes} paradas)
            </Typography>
          )}
          {horarioChegadaOnibus && horarioChegadaOnibus.status === 'aqui' && (
            <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.5, fontWeight: 'bold' }}>
              🚌 Ônibus está na sua parada!
            </Typography>
          )}
          {horarioChegadaOnibus && horarioChegadaOnibus.status === 'passou' && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, fontWeight: 'bold' }}>
              ⚠️ Ônibus já passou da sua parada
            </Typography>
          )}
          
          {/* TEMPO PARA ÔNIBUS CHEGAR ATÉ VOCÊ */}
          {carregandoTempo ? (
            <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
              ⏳ Calculando tempo de chegada...
            </Typography>
          ) : tempoParaOnibusChegar && tempoParaOnibusChegar.status === 'chegando' ? (
            <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 0.5, fontWeight: 'bold' }}>
              🚌 Chega em você em {tempoParaOnibusChegar.minutos} min ({tempoParaOnibusChegar.paradasRestantes} paradas)
            </Typography>
          ) : tempoParaOnibusChegar && tempoParaOnibusChegar.status === 'aqui' ? (
            <Typography variant="caption" color="success.main" sx={{ display: 'block', mt: 0.5, fontWeight: 'bold' }}>
              🚌 Ônibus está na sua parada!
            </Typography>
          ) : tempoParaOnibusChegar && tempoParaOnibusChegar.status === 'passou' ? (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5, fontWeight: 'bold' }}>
              ⚠️ Ônibus já passou da sua parada
            </Typography>
          ) : null}
          
          {/* Horário estimado de chegada ao destino */}
          {carregandoEstimativa ? (
            <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
              ⏰ Calculando horário estimado...
            </Typography>
          ) : horarioEstimado ? (
            <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
              ⏰ Chegada prevista: <strong style={{ color: '#00418F' }}>{horarioEstimado.horarioEstimado}</strong>
              {horarioEstimado.tempoTotalSegundos && (
                <span style={{ fontSize: '0.7rem', color: '#888', marginLeft: 4 }}>
                  ({Math.round(horarioEstimado.tempoTotalSegundos / 60)} min)
                </span>
              )}
            </Typography>
          ) : null}
          
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

// ==================== COMPONENTE PRINCIPAL ====================

export default function HomePage({ onLogout }) {
  const navigate = useNavigate();
  
  const { todosItinerarios, paradasCoordenadas, idsParadasUnicas, favoritos, loading: appLoading } = useAppData();
  
  const [gpsAtivo, setGpsAtivo] = useState(true);
  const { position } = useLocation({ ativo: gpsAtivo });
  const jaPreencheuParadaRef = useRef(false);
  const [modo, setModo] = useState('embarcar');
  const [tabLinha, setTabLinha] = useState('Anglo');
  const [origemId, setOrigemId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [opcoesEncontradas, setOpcoesEncontradas] = useState([]);
  const [buscando, setBuscando] = useState(false);
  
  const cacheViagensRef = useRef({});
  
  const auth = getAuth();

  const categoriesConfig = {
    Anglo: ['anglo', 'anglo21', 'anglo2145', 'anglo730', 'anglo8', 'angloru'],
    Capão: ['anglocapao', 'capaoanglo', 'capaodireito', 'capaodireitobr', 'capaofamedanglo', 'capaolyceu', 'cotadacapao', 'direitocapao', 'famedcapao', 'lyceucapao'],
    ESEF: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira7', 'madeireira9'],
    FaMed: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira18', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira22', 'madeireira7', 'madeireira9', 'anglofamed', 'anglocapao', 'capaofamedanglo', 'cotadacapao', 'direitocapao', 'lyceucapao'],
    Madeireira: ['anglru', 'anglo21', 'madeireira7', 'madeireira9', 'madeireira11', 'madeireira15', 'madeireira16'],
    Palma: ['palmacp', 'palmapm']
  };

  const safeTraduzir = (valor) => {
    if (!valor) return "---";
    const siglaStr = typeof valor === 'object' ? valor.nome : valor;
    return traduzirSigla(siglaStr.toString());
  };

  const normalizarNome = (p) => {
    return (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim();
  };

  const handleFirebaseLogout = async () => { 
    await signOut(auth); 
    if (onLogout) onLogout(); 
  };

  const handleReativarGPS = () => { 
    setGpsAtivo(true); 
    jaPreencheuParadaRef.current = false; 
    setOrigemId(''); 
  };

  const navegarParaMapa = (it, horario, origem, destino, cat, modoAtual) => {
    const itinerarioStr = encodeURIComponent(JSON.stringify(it));
    const params = new URLSearchParams({ 
      itinerario: itinerarioStr, 
      horario, 
      origem: origem || '', 
      destino: destino || '', 
      categoria: cat, 
      modo: modoAtual 
    });
    navigate(`/mapa?${params.toString()}`);
  };

  // ==================== EFEITOS ====================
  
  useEffect(() => {
    if (origemId && origemId !== '' && gpsAtivo && !jaPreencheuParadaRef.current) {
      jaPreencheuParadaRef.current = true;
      setTimeout(() => setGpsAtivo(false), 3000);
    }
    
    if ((!origemId || origemId === '') && !gpsAtivo) { 
      setGpsAtivo(true); 
      jaPreencheuParadaRef.current = false; 
    }
  }, [origemId, gpsAtivo]);

  useEffect(() => {
    if (!gpsAtivo) return;
    
    if (position && position.lat && position.lng && 
        Object.keys(paradasCoordenadas).length > 0 && 
        idsParadasUnicas.length > 0) {
      
      let menorDist = Infinity;
      let paradaVencedora = '';
      
      for (const idSelect of idsParadasUnicas) {
        const coord = paradasCoordenadas[idSelect];
        if (coord && coord.lat && coord.lng) {
          const d = calculateDistance(position.lat, position.lng, coord.lat, coord.lng);
          if (d < menorDist) { 
            menorDist = d; 
            paradaVencedora = idSelect; 
          }
        }
      }
      
      if (paradaVencedora && paradaVencedora !== origemId) {
        setOrigemId(paradaVencedora);
      }
    }
  }, [position, paradasCoordenadas, idsParadasUnicas, gpsAtivo, origemId]);

  const agrupamentoHorarios = useMemo(() => {
    const gruposNormal = {};
    const gruposRU = {};
    const categoriaIds = categoriesConfig[tabLinha];
    
    if (!categoriaIds) return { gruposNormal: [], gruposRU: [] };
    
    const itinerariosDaCategoria = todosItinerarios.filter(it => categoriaIds.includes(it?.id));
    
    for (const it of itinerariosDaCategoria) {
      if (!it.paradas || !Array.isArray(it.paradas)) continue;
      
      const paradas = it.paradas.map(normalizarNome);
      const origem = paradas[0];
      const destino = paradas[paradas.length - 1];
      
      let label;
      if (tabLinha === 'ESEF' || (tabLinha === 'FaMed' && origem?.includes('anglo') && destino?.includes('anglo'))) {
        label = `${safeTraduzir(origem)} - ${tabLinha} - ${safeTraduzir(destino)}`;
      } else {
        label = `${safeTraduzir(origem)} - ${safeTraduzir(destino)}`;
      }
      
      const chave = `${origem}-${destino}-${it.passaNoRU}-${label}`;
      const alvo = it.passaNoRU ? gruposRU : gruposNormal;
      
      if (!alvo[chave]) {
        alvo[chave] = { label, horarios: [] };
      }
      
      if (it.horariosaida && Array.isArray(it.horariosaida)) {
        for (const h of it.horariosaida) {
          if (!alvo[chave].horarios.some(ex => ex.h === h)) {
            alvo[chave].horarios.push({ h, it });
          }
        }
      }
    }
    
    const ordenar = (g) => {
      return Object.values(g)
        .map(grupo => ({ 
          ...grupo, 
          horarios: grupo.horarios.sort((a, b) => a.h.localeCompare(b.h)) 
        }))
        .sort((a, b) => (a.horarios[0]?.h || "99:99").localeCompare(b.horarios[0]?.h || "99:99"));
    };
    
    return { gruposNormal: ordenar(gruposNormal), gruposRU: ordenar(gruposRU) };
  }, [tabLinha, todosItinerarios]);

  // ==================== HANDLE BUSCA OTIMIZADO ====================
  
  const handleBusca = useCallback(async () => {
    if (!origemId || !destinoId) return;
    if (buscando) return;

    setBuscando(true);

    try {
      const ori = origemId.toLowerCase().trim();
      const des = destinoId.toLowerCase().trim();
      const agora = new Date();
      const tempoAtualMin = agora.getHours() * 60 + agora.getMinutes();
      const dataAtual = agora.toISOString().slice(0, 10).replace(/-/g, '');

      const hoje = agora.toISOString().slice(0, 10);
      if (cacheViagensRef.current.data !== hoje) {
        cacheViagensRef.current = { data: hoje, viagens: {} };
      }

      const matchesPotenciais = [];

      for (const it of todosItinerarios) {
        if (!it.paradas || !Array.isArray(it.paradas)) continue;

        const paradas = it.paradas.map(normalizarNome);

        const idxsO = [];
        const idxsD = [];
        paradas.forEach((p, i) => {
          if (p === ori) idxsO.push(i);
          if (p === des) idxsD.push(i);
        });

        let melhorDiff = Infinity;
        let melhorIdxO = -1, melhorIdxD = -1;
        for (const o of idxsO) {
          for (const d of idxsD) {
            if (o < d && (d - o) < melhorDiff) {
              melhorDiff = d - o;
              melhorIdxO = o;
              melhorIdxD = d;
            }
          }
        }

        if (melhorIdxO === -1) continue;

        const idxO = melhorIdxO;
        const idxD = melhorIdxD;

        if (!it.horariosaida || !Array.isArray(it.horariosaida)) continue;

        for (const horario of it.horariosaida) {
          const [h, m] = horario.split(':').map(Number);
          const tempoSaidaMin = h * 60 + m;
          const duracao = Number(it.duracaoEstimada) || 60;
          const tempoExpiracao = tempoSaidaMin + duracao + 15;

          if (tempoAtualMin > tempoExpiracao) continue;
          if (tempoSaidaMin + (idxO * 1.5) >= tempoAtualMin - 20) {
            const tripId = `${it.id}_${horario.replace(':', '')}_${dataAtual}`;
            matchesPotenciais.push({
              it,
              horario,
              numParadas: idxD - idxO,
              tempoRef: tempoSaidaMin,
              cat: Object.keys(categoriesConfig).find(c => categoriesConfig[c].includes(it.id)) || "Rota",
              tripId,
              idxO,
              origem: ori,
              destino: des,
              paradasLista: paradas,
            });
          }
        }
      }

      if (matchesPotenciais.length === 0) {
        setOpcoesEncontradas([]);
        setBuscando(false);
        return;
      }

      const matchesParaBuscar = [];
      const matchesEmCache = [];
      
      for (const match of matchesPotenciais) {
        if (cacheViagensRef.current.viagens[match.tripId] !== undefined) {
          matchesEmCache.push({
            match,
            indiceAtualOnibus: cacheViagensRef.current.viagens[match.tripId]
          });
        } else {
          matchesParaBuscar.push(match);
        }
      }

      let resultadosBusca = [];
      if (matchesParaBuscar.length > 0) {
        const viagensPromises = matchesParaBuscar.map(async (match) => {
          try {
            const viagemRef = doc(db, "viagens_ativas", match.tripId);
            const snap = await getDoc(viagemRef);
            let indice = 0;
            if (snap.exists()) {
              indice = snap.data().indiceParada ?? 0;
            }
            cacheViagensRef.current.viagens[match.tripId] = indice;
            return { match, indiceAtualOnibus: indice };
          } catch (e) {
            console.warn("Erro ao buscar viagem ativa", e);
            cacheViagensRef.current.viagens[match.tripId] = 0;
            return { match, indiceAtualOnibus: 0 };
          }
        });

        resultadosBusca = await Promise.all(viagensPromises);
      }

      const todosResultados = [...matchesEmCache, ...resultadosBusca];

      const matchesFiltrados = todosResultados
        .filter(({ match, indiceAtualOnibus }) => indiceAtualOnibus <= match.idxO)
        .map(({ match }) => match);

      if (matchesFiltrados.length > 0) {
        const minP = Math.min(...matchesFiltrados.map(m => m.numParadas));
        setOpcoesEncontradas(
          matchesFiltrados
            .sort((a, b) => a.tempoRef - b.tempoRef)
            .map(m => ({ ...m, maisRapida: m.numParadas === minP }))
            .slice(0, 8)
        );
      } else {
        setOpcoesEncontradas([]);
      }
    } catch (error) {
      console.error("Erro na busca:", error);
      setOpcoesEncontradas([]);
    } finally {
      setBuscando(false);
    }
  }, [origemId, destinoId, todosItinerarios, buscando]);

  // Timer para atualizar a lista a cada 30 segundos
useEffect(() => {
  if (opcoesEncontradas.length === 0) return;
  const interval = setInterval(() => {
    handleBusca();
  }, 30000); // 30 segundos
  return () => clearInterval(interval);
}, [opcoesEncontradas.length, handleBusca]);

  // ==================== RENDERIZAÇÃO ====================
  
  if (appLoading || !position || !position.lat || !position.lng) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100dvh', alignItems: 'center', justifyContent: 'center', gap: 2, bgcolor: '#E2E8F0' }}>
        <CircularProgress />
        <Typography variant="body2" color="textSecondary" fontWeight="500">
          Obtendo sua localização...
        </Typography>
      </Box>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <Box sx={{ minHeight: '100dvh', bgcolor: '#E2E8F0', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <Container maxWidth="sm" disableGutters sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          bgcolor: 'white', 
          height: '100dvh', 
          maxHeight: '100dvh', 
          width: '100%', 
          p: 3, 
          boxShadow: '0 4px 20px rgba(0,0,0,0.1)', 
          overflow: 'hidden' 
        }}>
          
          <Typography variant="h4" fontWeight="900" color="primary" sx={{ mb: 2, textAlign: 'center', flexShrink: 0 }}>
            busepel
          </Typography>
          
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
          
          <Box sx={{ flexGrow: 1, overflowY: 'auto', pr: 0.5, display: 'flex', flexDirection: 'column' }}>
            
            {modo === 'embarcar' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, justifyContent: 'center' }}>
                {opcoesEncontradas.length === 0 ? (
                  <>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <FormControl fullWidth variant="outlined">
                        <InputLabel id="label-origem" sx={{ backgroundColor: '#FFFFFF', px: 1 }}>Subir em</InputLabel>
                        <Select 
                          labelId="label-origem" 
                          value={origemId} 
                          onChange={e => setOrigemId(e.target.value)} 
                          sx={{ borderRadius: '12px' }}
                        >
                          {idsParadasUnicas.map(id => (
                            <MenuItem 
                              key={id} 
                              value={id} 
                              sx={{ 
                                backgroundColor: favoritos.includes(id) ? '#EBF4FF' : 'transparent', 
                                fontWeight: favoritos.includes(id) ? 'bold' : 'normal' 
                              }}
                            >
                              {safeTraduzir(id)} {favoritos.includes(id) && '⭐'}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      
                      <Button 
                        size="small" 
                        onClick={handleReativarGPS} 
                        startIcon={<MyLocationIcon />} 
                        sx={{ minWidth: 'auto', px: 2, py: 1.5, borderRadius: '12px' }} 
                        title="Atualizar localização"
                      >
                        🔄
                      </Button>
                    </Box>
                    
                    <FormControl fullWidth variant="outlined">
                      <InputLabel id="label-destino" sx={{ backgroundColor: '#FFFFFF', px: 1 }}>Descer em</InputLabel>
                      <Select 
                        labelId="label-destino" 
                        value={destinoId} 
                        onChange={e => setDestinoId(e.target.value)} 
                        sx={{ borderRadius: '12px' }}
                      >
                        {idsParadasUnicas.map(id => (
                          <MenuItem 
                            key={id} 
                            value={id} 
                            sx={{ 
                              backgroundColor: favoritos.includes(id) ? '#EBF4FF' : 'transparent', 
                              fontWeight: favoritos.includes(id) ? 'bold' : 'normal' 
                            }}
                          >
                            {safeTraduzir(id)} {favoritos.includes(id) && '⭐'}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    
                    <Button 
                      fullWidth 
                      variant="contained" 
                      onClick={handleBusca} 
                      disabled={buscando}
                      sx={{ py: 2, fontWeight: 'bold', borderRadius: '12px' }}
                    >
                      {buscando ? <CircularProgress size={24} color="inherit" /> : 'VERIFICAR ÔNIBUS DISPONÍVEIS'}
                    </Button>
                  </>
                ) : (
                  <>
                    <List>
                      {opcoesEncontradas.map((opt, i) => (
                        <BusItem 
                          key={i} 
                          opt={opt} 
                          safeTraduzir={safeTraduzir} 
                          onClick={() => navegarParaMapa(opt.it, opt.horario, origemId, destinoId, opt.cat, modo)} 
                        />
                      ))}
                    </List>
                    <Button fullWidth onClick={() => setOpcoesEncontradas([])} sx={{ mt: 1, fontWeight: 'bold' }}>
                      VOLTAR PARA BUSCA
                    </Button>
                  </>
                )}
              </Box>
            )}
            
            {modo === 'verificar' && (
              <Box>
                <Tabs 
                  value={tabLinha} 
                  onChange={(e, v) => setTabLinha(v)} 
                  variant="scrollable" 
                  sx={{ mb: 2, flexShrink: 0 }}
                >
                  {Object.keys(categoriesConfig).map(cat => (
                    <Tab key={cat} label={cat} value={cat} sx={{ fontWeight: 'bold' }} />
                  ))}
                </Tabs>
                
                {agrupamentoHorarios.gruposRU.map((g, i) => (
                  <Box key={i} sx={{ mb: 3, p: 2, bgcolor: '#fff9f2', borderRadius: '16px', border: '1px solid #FF8A31' }}>
                    <Typography variant="subtitle2" color="warning.main" fontWeight="bold" sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <RestaurantIcon fontSize="small" /> RU
                    </Typography>
                    <Typography variant="caption" color="textSecondary" fontWeight="bold">
                      {g.label}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                      {g.horarios.map((obj, j) => (
                        <Button 
                          key={j} 
                          size="small" 
                          variant="contained" 
                          color="warning" 
                          onClick={() => navegarParaMapa(obj.it, obj.h, '', '', tabLinha, 'verificar')}
                        >
                          {obj.h}
                        </Button>
                      ))}
                    </Box>
                  </Box>
                ))}
                
                {agrupamentoHorarios.gruposNormal.map((g, i) => (
                  <Box key={i} sx={{ mb: 3 }}>
                    <Typography variant="subtitle2" color="primary" fontWeight="bold">
                      {g.label}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                      {g.horarios.map((obj, j) => (
                        <Button 
                          key={j} 
                          size="small" 
                          variant="outlined" 
                          sx={{ fontWeight: 'bold', borderRadius: '8px' }} 
                          onClick={() => navegarParaMapa(obj.it, obj.h, '', '', tabLinha, 'verificar')}
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
            <Button onClick={() => navigate('/personalizar')} startIcon={<EditIcon />} sx={{ color: '#00418F', fontWeight: 'bold', textTransform: 'none', fontSize: '0.85rem' }}>
              Personalizar
            </Button>
            <Button onClick={handleFirebaseLogout} variant="outlined" color="error" startIcon={<LogoutIcon />} sx={{ borderRadius: '12px', px: 4, fontWeight: 'bold', textTransform: 'none', width: '100%' }}>
              Sair
            </Button>
          </Box>
        </Container>
      </Box>
    </ThemeProvider>
  );
}