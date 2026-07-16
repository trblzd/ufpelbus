import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { doc, onSnapshot, getDoc } from 'firebase/firestore';
import { useLocation } from '../hooks/useLocation';
import { traduzirSigla, nomesExtenso } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import {
  calcularHorarioEstimadoParada,
  calcularTempoParaOnibusChegarAteVoce,
  calcularHorarioChegadaOnibusAteVoce
} from '../services/transporteService';
import {
  Box, Tabs, Tab, Paper, Typography, Button,
  MenuItem, Select, FormControl, CircularProgress, createTheme, ThemeProvider,
  List, ListItemButton, Modal, IconButton, Divider, ListItem
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import StarIcon from '@mui/icons-material/Star';
import { getAuth, signOut } from 'firebase/auth';
import { useAppData } from '../App';
import { getFavoritos, toggleFavorito } from '../services/favoritosService';
import { getAllApelidos, setMultiplosApelidos } from '../services/apelidosService';
import './HomePage.css';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#0845FF' },
    background: { default: '#191919', paper: '#2E2E2E' },
    text: { primary: '#FFFFFF', secondary: '#7C7C7C' },
  },
});

const PARADAS_IGNORADAS = ['int_', 'ponto-indefinido'];

// ==================== COMPONENTE DE ITEM DE ÔNIBUS ====================
const BusItem = ({ opt, onClick, safeTraduzir }) => {
  const [viagemInfo, setViagemInfo] = useState({ lastStop: null, lotacao: null, atualizadoEm: null });
  const [tempoParaOnibusChegar, setTempoParaOnibusChegar] = useState(null);
  const [carregandoTempo, setCarregandoTempo] = useState(false);
  const [isExpirado, setIsExpirado] = useState(false);

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

  useEffect(() => {
    if (!viagemInfo.atualizadoEm || !opt.it?.duracaoEstimada) {
      setIsExpirado(false);
      return;
    }
    const agora = new Date();
    const dataPost = viagemInfo.atualizadoEm.toDate?.() || new Date(viagemInfo.atualizadoEm.seconds * 1000);
    const minutosPassados = Math.floor((agora - dataPost) / 60000);
    setIsExpirado(minutosPassados > Number(opt.it.duracaoEstimada));
  }, [viagemInfo.atualizadoEm, opt.it]);

  useEffect(() => {
    const buscarTempoEstimado = async () => {
      if (!opt?.it?.id || !opt?.horario || !opt?.origem || !opt?.idxO) return;
      if (!viagemInfo || viagemInfo.indiceParada === undefined) return;
      setCarregandoTempo(true);
      try {
        const DocsViagem = { indiceParada: viagemInfo.indiceParada || 0 };
        const resultado = await calcularTempoParaOnibusChegarAteVoce(DocsViagem, opt.it, opt.origem, opt.horario);
        if (resultado) setTempoParaOnibusChegar(resultado);
      } catch (e) {
        console.warn("Erro ao buscar tempo estimado:", e);
      } finally {
        setCarregandoTempo(false);
      }
    };
    buscarTempoEstimado();
  }, [opt, viagemInfo]);

  const getEmojiLotacao = (nivel) => {
    if (isExpirado) return '🟡';
    if (nivel === 'lotado') return '🔴';
    if (nivel === 'medio') return '🟡';
    if (nivel === 'vazio') return '🟢';
    return '';
  };

  const temInformacaoAtiva = viagemInfo.lastStop && !isExpirado;

  return (
    <Paper className="bus-item-card" elevation={0}>
      <ListItemButton onClick={onClick} sx={{ p: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography className="bus-item-title">{opt.cat}</Typography>
            {viagemInfo.lotacao && (
              <span style={{ fontSize: '14px' }}>{getEmojiLotacao(viagemInfo.lotacao)}</span>
            )}
          </Box>

          {temInformacaoAtiva ? (
            <Typography className="bus-item-info-line">
              Última parada: {safeTraduzir(viagemInfo.lastStop)}
            </Typography>
          ) : (
            <Typography className="bus-item-info-line" style={{ color: '#7C7C7C', fontStyle: 'italic' }}>
              Sem informações
            </Typography>
          )}

          {carregandoTempo ? (
            <Typography className="bus-item-info-line">Calculando tempo...</Typography>
          ) : tempoParaOnibusChegar && tempoParaOnibusChegar.status === 'chegando' ? (
            <Typography className="bus-item-info-line" style={{ color: '#0845FF', fontWeight: '600' }}>
              Chega em {tempoParaOnibusChegar.minutos} min
            </Typography>
          ) : tempoParaOnibusChegar && tempoParaOnibusChegar.status === 'aqui' ? (
            <Typography className="bus-item-info-line" style={{ color: '#0845FF', fontWeight: '600' }}>
              Está no seu ponto!
            </Typography>
          ) : null}
        </Box>
        <Typography className="bus-item-time">{opt.horario}</Typography>
      </ListItemButton>
    </Paper>
  );
};

// ==================== COMPONENTE MODAL RENOMEAR ====================
const ModalRenomear = ({ open, onClose, idsParadas }) => {
  const [apelidos, setApelidos] = useState({});
  const [listaOrdenada, setListaOrdenada] = useState([]);

  useEffect(() => {
    if (open) {
      setApelidos(getAllApelidos());
    }
  }, [open]);

  useEffect(() => {
    const filtrada = idsParadas.filter(id => {
      if (!id || typeof id !== 'string') return false;
      return !PARADAS_IGNORADAS.some(p => id.startsWith(p) || id === p);
    });
    setListaOrdenada([...filtrada].sort((a, b) => traduzirSigla(a).localeCompare(traduzirSigla(b))));
  }, [idsParadas]);

  const handleMudarApelido = (sigla, novoNome) => {
    setApelidos(prev => ({ ...prev, [sigla]: novoNome }));
  };

  const handleSalvar = () => {
    setMultiplosApelidos(apelidos);
    onClose();
  };

  const getOpcoesRenomear = (sigla) => {
    const siglaLimpa = sigla.toLowerCase().trim();
    const opcoes = nomesExtenso[siglaLimpa];
    if (opcoes && opcoes.length > 0) {
      return opcoes;
    }
    return [traduzirSigla(sigla), sigla.toUpperCase(), sigla.toLowerCase()];
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '90%',
        maxWidth: 500,
        maxHeight: '90vh',
        bgcolor: '#191919',
        borderRadius: '16px',
        boxShadow: 24,
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        outline: 'none',
        color: 'white'
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight="bold">Renomear Paradas</Typography>
          <IconButton onClick={onClose} sx={{ color: 'white' }}>
            <CloseIcon />
          </IconButton>
        </Box>
        
        <Box sx={{ flexGrow: 1, overflowY: 'auto', mb: 2 }}>
          {listaOrdenada.map(id => {
            const apelidoAtual = apelidos[id] || traduzirSigla(id);
            const opcoes = getOpcoesRenomear(id);
            return (
              <Box key={id} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1.5, borderBottom: '1px solid #333' }}>
                <Typography variant="body2" sx={{ fontWeight: 'bold', minWidth: 80 }}>{id.toUpperCase()}</Typography>
                <Select
                  size="small"
                  value={apelidos[id] || traduzirSigla(id)}
                  onChange={(e) => handleMudarApelido(id, e.target.value)}
                  sx={{
                    width: 180,
                    fontSize: '0.8rem',
                    borderRadius: '8px',
                    color: 'white',
                    '& .MuiSelect-icon': { color: 'white' },
                    '& .MuiOutlinedInput-notchedOutline': { borderColor: '#444' },
                    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#666' }
                  }}
                >
                  {opcoes.map(opt => (
                    <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                  ))}
                </Select>
              </Box>
            );
          })}
        </Box>
        
        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSalvar} fullWidth sx={{ py: 1.5, borderRadius: '12px', fontWeight: 'bold' }}>
          SALVAR ALTERAÇÕES
        </Button>
      </Box>
    </Modal>
  );
};

// ==================== COMPONENTE MODAL FAVORITOS ====================
const ModalFavoritos = ({ open, onClose, idsParadas }) => {
  const [favoritos, setFavoritos] = useState([]);
  const [listaOrdenada, setListaOrdenada] = useState([]);

  useEffect(() => {
    if (open) {
      getFavoritos().then(setFavoritos);
    }
  }, [open]);

  useEffect(() => {
    const filtrada = idsParadas.filter(id => {
      if (!id || typeof id !== 'string') return false;
      return !PARADAS_IGNORADAS.some(p => id.startsWith(p) || id === p);
    });
    const ordenada = [...filtrada].sort((a, b) => {
      const aFav = favoritos.includes(a);
      const bFav = favoritos.includes(b);
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      return traduzirSigla(a).localeCompare(traduzirSigla(b));
    });
    setListaOrdenada(ordenada);
  }, [idsParadas, favoritos]);

  const handleToggle = async (id) => {
    const novaLista = await toggleFavorito(id);
    setFavoritos(novaLista);
  };

  const handleSalvar = () => {
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '90%',
        maxWidth: 500,
        maxHeight: '90vh',
        bgcolor: '#191919',
        borderRadius: '16px',
        boxShadow: 24,
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        outline: 'none',
        color: 'white'
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight="bold">Paradas Favoritas</Typography>
          <IconButton onClick={onClose} sx={{ color: 'white' }}>
            <CloseIcon />
          </IconButton>
        </Box>
        
        <Box sx={{ flexGrow: 1, overflowY: 'auto', mb: 2 }}>
          {listaOrdenada.map(id => {
            const isFav = favoritos.includes(id);
            return (
              <ListItem 
                key={id} 
                onClick={() => handleToggle(id)}
                sx={{
                  py: 1.5,
                  borderRadius: '8px',
                  mb: 0.5,
                  cursor: 'pointer',
                  backgroundColor: isFav ? '#0845FF' : 'transparent',
                  color: isFav ? 'white' : 'inherit',
                  '&:hover': {
                    backgroundColor: isFav ? '#0037CC' : '#333'
                  }
                }}
              >
                <Typography variant="body2" fontWeight={isFav ? 'bold' : 'normal'}>
                  {traduzirSigla(id)}
                </Typography>
                <Typography variant="caption" sx={{ ml: 1, color: isFav ? '#CCC' : '#666' }}>
                  {id.toUpperCase()}
                </Typography>
              </ListItem>
            );
          })}
        </Box>
        
        <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSalvar} fullWidth sx={{ py: 1.5, borderRadius: '12px', fontWeight: 'bold' }}>
          SALVAR ALTERAÇÕES
        </Button>
      </Box>
    </Modal>
  );
};

// ==================== COMPONENTE MODAL CARDÁPIO ====================
const ModalCardapio = ({ open, onClose }) => {
  const itensCardapio = [
    { categoria: 'Acompanhamentos', itens: ['Arroz Branco', 'Arroz Integral', 'Feijão Preto', 'Massa Primavera'] },
    { categoria: 'Proteínas', itens: ['Frango Acebolado', 'Proteína Acebolada'] },
    { categoria: 'Saladas', itens: ['Salada Folhosa', 'Salada Crua', 'Salada Cozida'] },
    { categoria: 'Sobremesa', itens: ['Fruta'] },
  ];

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '90%',
        maxWidth: 400,
        maxHeight: '80vh',
        bgcolor: '#191919',
        borderRadius: '16px',
        boxShadow: 24,
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        outline: 'none',
        color: 'white'
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight="bold">Cardápio do Dia</Typography>
          <IconButton onClick={onClose} sx={{ color: 'white' }}>
            <CloseIcon />
          </IconButton>
        </Box>
        
        <Box sx={{ flexGrow: 1, overflowY: 'auto' }}>
          {itensCardapio.map((grupo, idx) => (
            <Box key={idx} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ color: '#0845FF', fontWeight: 'bold', mb: 0.5 }}>
                {grupo.categoria}
              </Typography>
              {grupo.itens.map((item, i) => (
                <Typography key={i} variant="body2" sx={{ py: 0.3, color: '#DDD' }}>
                  • {item}
                </Typography>
              ))}
              {idx < itensCardapio.length - 1 && <Divider sx={{ my: 1, borderColor: '#333' }} />}
            </Box>
          ))}
        </Box>
        
        <Button variant="contained" onClick={onClose} fullWidth sx={{ py: 1.5, borderRadius: '12px', fontWeight: 'bold', mt: 2 }}>
          FECHAR
        </Button>
      </Box>
    </Modal>
  );
};

// ==================== COMPONENTE MODAL UPLOAD CARTEIRINHA ====================
const ModalUploadCarteirinha = ({ open, onClose }) => {
  const [preview, setPreview] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (open) {
      const saved = localStorage.getItem('carteirinha');
      if (saved) {
        setPreview(saved);
      }
    }
  }, [open]);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result;
        setPreview(base64);
        localStorage.setItem('carteirinha', base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemover = () => {
    setPreview(null);
    localStorage.removeItem('carteirinha');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSalvar = () => {
    onClose();
  };

  const containerWidth = Math.min(362, window.innerWidth * 0.8);
  const containerHeight = containerWidth * (228 / 362);

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '90%',
        maxWidth: 420,
        bgcolor: '#191919',
        borderRadius: '16px',
        boxShadow: 24,
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        outline: 'none',
        color: 'white'
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight="bold">Carteirinha do Cobalto</Typography>
          <IconButton onClick={onClose} sx={{ color: 'white' }}>
            <CloseIcon />
          </IconButton>
        </Box>
        
        <Box 
          sx={{
            width: '100%',
            height: containerHeight,
            borderRadius: '12px',
            border: '2px dashed #444',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
            mb: 2,
            backgroundColor: '#222'
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {preview ? (
            <img src={preview} alt="Carteirinha" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <>
              <CloudUploadIcon sx={{ fontSize: 48, color: '#555' }} />
              <Typography variant="body2" sx={{ color: '#777', mt: 1 }}>
                Clique para enviar sua carteirinha
              </Typography>
            </>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            ref={fileInputRef}
          />
        </Box>
        
        {preview && (
          <Button variant="outlined" color="error" onClick={handleRemover} fullWidth sx={{ mb: 2, borderRadius: '12px' }}>
            Remover imagem
          </Button>
        )}
        
        <Button variant="contained" onClick={handleSalvar} fullWidth sx={{ py: 1.5, borderRadius: '12px', fontWeight: 'bold' }}>
          SALVAR
        </Button>
      </Box>
    </Modal>
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
  
  const [modalRenomearOpen, setModalRenomearOpen] = useState(false);
  const [modalFavoritosOpen, setModalFavoritosOpen] = useState(false);
  const [modalCardapioOpen, setModalCardapioOpen] = useState(false);
  const [modalUploadOpen, setModalUploadOpen] = useState(false);
  
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
    if (position && position.lat && position.lng && Object.keys(paradasCoordenadas).length > 0 && idsParadasUnicas.length > 0) {
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
        .map(grupo => ({ ...grupo, horarios: grupo.horarios.sort((a, b) => a.h.localeCompare(b.h)) }))
        .sort((a, b) => (a.horarios[0]?.h || "99:99").localeCompare(b.horarios[0]?.h || "99:99"));
    };
    return { gruposNormal: ordenar(gruposNormal), gruposRU: ordenar(gruposRU) };
  }, [tabLinha, todosItinerarios]);

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
              it, horario, numParadas: idxD - idxO, tempoRef: tempoSaidaMin,
              cat: Object.keys(categoriesConfig).find(c => categoriesConfig[c].includes(it.id)) || "Rota",
              tripId, idxO, origem: ori, destino: des, paradasLista: paradas,
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
          matchesEmCache.push({ match, indiceAtualOnibus: cacheViagensRef.current.viagens[match.tripId] });
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
            if (snap.exists()) indice = snap.data().indiceParada ?? 0;
            cacheViagensRef.current.viagens[match.tripId] = indice;
            return { match, indiceAtualOnibus: indice };
          } catch (e) {
            cacheViagensRef.current.viagens[match.tripId] = 0;
            return { match, indiceAtualOnibus: 0 };
          }
        });
        resultadosBusca = await Promise.all(viagensPromises);
      }
      const todosResultados = [...matchesEmCache, ...resultadosBusca];
      const matchesFiltrados = todosResultados.filter(({ match, indiceAtualOnibus }) => indiceAtualOnibus <= match.idxO).map(({ match }) => match);
      if (matchesFiltrados.length > 0) {
        const minP = Math.min(...matchesFiltrados.map(m => m.numParadas));
        setOpcoesEncontradas(matchesFiltrados.sort((a, b) => a.tempoRef - b.tempoRef).map(m => ({ ...m, maisRapida: m.numParadas === minP })).slice(0, 8));
      } else {
        setOpcoesEncontradas([]);
      }
    } catch (error) {
      setOpcoesEncontradas([]);
    } finally {
      setBuscando(false);
    }
  }, [origemId, destinoId, todosItinerarios, buscando]);

  useEffect(() => {
    if (opcoesEncontradas.length === 0) return;
    const interval = setInterval(() => { handleBusca(); }, 30000);
    return () => clearInterval(interval);
  }, [opcoesEncontradas.length, handleBusca]);

  if (appLoading || !position || !position.lat || !position.lng) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 2, bgcolor: '#030303' }}>
        <CircularProgress sx={{ color: '#0845FF' }} />
        <Typography variant="body2" color="#7C7C7C" fontWeight="500">
          Obtendo sua localização...
        </Typography>
      </Box>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <Box className="home-page-bg">
        <Box className="home-page-container">
          
          <div className="brand-logo-container">
            <img 
              src="/buslogo.svg" 
              alt="Busepel Logo" 
              className="auth-logo-svg" 
            />
          </div>

          <div className="scroll-content">
            {/* MODO EMBARCAR */}
            {modo === 'embarcar' && (
              <>
                <div className="screen-title">Embarque</div>
                {opcoesEncontradas.length === 0 ? (
                  <>
                    <div className="input-block-container">
                      <FormControl fullWidth variant="standard">
                        <Select 
                          value={origemId} 
                          onChange={e => setOrigemId(e.target.value)} 
                          displayEmpty
                          renderValue={(selected) => (
                            <span style={{ color: selected ? '#FFFFFF' : '#7C7C7C' }}>
                              {selected ? safeTraduzir(selected) : 'subir'}
                            </span>
                          )}
                          disableUnderline
                          sx={{ color: '#FFFFFF', fontSize: '18px' }}
                        >
                          {idsParadasUnicas.map(id => {
                            const isFav = favoritos.includes(id);
                            return (
                              <MenuItem key={id} value={id}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <span>{safeTraduzir(id)}</span>
                                  {isFav && <StarIcon sx={{ color: '#0845FF', fontSize: '20px' }} />}
                                </Box>
                              </MenuItem>
                            );
                          })}
                        </Select>
                      </FormControl>
                      
                      <div style={{ height: '1px', backgroundColor: '#7C7C7C', opacity: 0.3, width: '100%' }}></div>
                      
                      <FormControl fullWidth variant="standard">
                        <Select 
                          value={destinoId} 
                          onChange={e => setDestinoId(e.target.value)} 
                          displayEmpty
                          renderValue={(selected) => (
                            <span style={{ color: selected ? '#FFFFFF' : '#7C7C7C' }}>
                              {selected ? safeTraduzir(selected) : 'descer'}
                            </span>
                          )}
                          disableUnderline
                          sx={{ color: '#FFFFFF', fontSize: '18px' }}
                        >
                          {idsParadasUnicas.map(id => {
                            const isFav = favoritos.includes(id);
                            return (
                              <MenuItem key={id} value={id}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <span>{safeTraduzir(id)}</span>
                                  {isFav && <StarIcon sx={{ color: '#0845FF', fontSize: '20px' }} />}
                                </Box>
                              </MenuItem>
                            );
                          })}
                        </Select>
                      </FormControl>
                    </div>

                    <Button 
                      className="action-btn-main" 
                      fullWidth 
                      variant="contained" 
                      onClick={handleBusca} 
                      disabled={buscando}
                    >
                      {buscando ? <CircularProgress size={24} color="inherit" /> : 'Continuar...'}
                    </Button>
                  </>
                ) : (
                  <>
                    <List disablePadding>
                      {opcoesEncontradas.map((opt, i) => (
                        <BusItem key={i} opt={opt} safeTraduzir={safeTraduzir} onClick={() => navegarParaMapa(opt.it, opt.horario, origemId, destinoId, opt.cat, modo)} />
                      ))}
                    </List>
                    <Button fullWidth onClick={() => setOpcoesEncontradas([])} sx={{ mt: 2, color: '#0845FF', fontWeight: 'bold' }}>
                      VOLTAR PARA BUSCA
                    </Button>
                  </>
                )}
              </>
            )}

            {/* MODO ALUNO */}
            {modo === 'aluno' && (
              <div className="aluno-container">
                <div className="screen-title" style={{ textAlign: 'left', width: '100%' }}>
                  Olá, aluno!
                </div>
                
                <div className="aluno-upload-area" onClick={() => setModalUploadOpen(true)}>
                  <CloudUploadIcon sx={{ fontSize: 40, color: '#555' }} />
                  <Typography variant="body2" sx={{ color: '#777', mt: 1 }}>
                    Faça upload da sua<br/>carteirinha do cobalto aqui!
                  </Typography>
                </div>

                <div className="aluno-buttons-row">
                  <Button 
                    className="aluno-btn" 
                    startIcon={<BookmarkBorderIcon />} 
                    onClick={() => setModalFavoritosOpen(true)}
                    sx={{ borderRadius: '20px !important' }}
                  >
                    Favoritos
                  </Button>
                  <Button 
                    className="aluno-btn" 
                    startIcon={<RestaurantMenuIcon />} 
                    onClick={() => setModalCardapioOpen(true)}
                    sx={{ borderRadius: '20px !important' }}
                  >
                    Cardápio RU
                  </Button>
                </div>
              </div>
            )}

            {/* MODO VERIFICAR */}
            {modo === 'verificar' && (
              <>
                <div className="screen-title">Horários</div>
                
                <Tabs 
                  value={tabLinha} 
                  onChange={(e, v) => setTabLinha(v)} 
                  className="custom-tabs" 
                  variant="scrollable" 
                  scrollButtons={false} 
                  tabindicatorprops={{ style: { display: 'none' } }}
                >
                  {Object.keys(categoriesConfig).map(cat => (
                    <Tab key={cat} label={cat} value={cat} className="custom-tab" />
                  ))}
                </Tabs>
                
                {agrupamentoHorarios.gruposRU.map((g, i) => (
                  <div key={i} className="ru-card-container">
                    <div className="ru-card-header">
                      <span><RestaurantMenuIcon /></span> RU
                    </div>
                    <div className="grid-hours">
                      {g.horarios.map((obj, j) => (
                        <Button key={j} className="hour-btn" variant="contained" onClick={() => navegarParaMapa(obj.it, obj.h, '', '', tabLinha, 'verificar')}>
                          {obj.h}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
                
                {agrupamentoHorarios.gruposNormal.map((g, i) => (
                  <div key={i} style={{ marginBottom: '24px' }}>
                    <div className="schedule-group-title">{g.label}</div>
                    <div className="grid-hours">
                      {g.horarios.map((obj, j) => (
                        <Button key={j} className="hour-btn-outlined" variant="contained" onClick={() => navegarParaMapa(obj.it, obj.h, '', '', tabLinha, 'verificar')}>
                          {obj.h}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* ==================== ÁREA INFERIOR FIXA ==================== */}
          <div className="bottom-fixed-area">
            {modo === 'embarcar' && opcoesEncontradas.length === 0 && (
              <div className="rename-wrapper">
                <Button className="rename-btn" startIcon={<EditIcon />} onClick={() => setModalRenomearOpen(true)}>
                  Renomear paradas
                </Button>
              </div>
            )}

            <div className="bottom-nav-floating">
              <button 
                className={`nav-icon-btn ${modo === 'embarcar' ? 'active' : ''}`} 
                onClick={() => setModo('embarcar')}
              >
                <img 
                  src={modo === 'embarcar' ? '/busativo.svg' : '/businativo.svg'} 
                  alt="Ônibus" 
                  className="nav-icon-bus" 
                />
              </button>
              
              <button 
                className={`nav-icon-btn ${modo === 'aluno' ? 'active' : ''}`} 
                onClick={() => setModo('aluno')}
              >
                <img 
                  src={modo === 'aluno' ? '/perfilativo.svg' : '/perfilinativo.svg'} 
                  alt="Perfil" 
                  className="nav-icon-profile" 
                />
              </button>
              
              <button 
                className={`nav-icon-btn ${modo === 'verificar' ? 'active' : ''}`} 
                onClick={() => setModo('verificar')}
              >
                <img 
                  src={modo === 'verificar' ? '/rotativo.svg' : '/rotainativo.svg'} 
                  alt="Rotas" 
                  className="nav-icon-route" 
                />
              </button>
            </div>
          </div>

        </Box>
      </Box>

      {/* MODAIS */}
      <ModalRenomear 
        open={modalRenomearOpen} 
        onClose={() => setModalRenomearOpen(false)} 
        idsParadas={idsParadasUnicas}
      />
      
      <ModalFavoritos 
        open={modalFavoritosOpen} 
        onClose={() => setModalFavoritosOpen(false)} 
        idsParadas={idsParadasUnicas}
      />
      
      <ModalCardapio 
        open={modalCardapioOpen} 
        onClose={() => setModalCardapioOpen(false)} 
      />
      
      <ModalUploadCarteirinha 
        open={modalUploadOpen} 
        onClose={() => setModalUploadOpen(false)} 
      />
    </ThemeProvider>
  );
}