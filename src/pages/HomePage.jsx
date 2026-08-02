// HomePage.jsx
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { doc, onSnapshot, getDoc, collection, getDocs } from 'firebase/firestore';
import { getAuth, signOut } from 'firebase/auth';
import { useLocation } from '../hooks/useLocation';
import { traduzirSigla, nomesExtenso } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import {
  calcularTempoParaOnibusChegarAteVoce
} from '../services/transporteService';
import {
  Box, Tabs, Tab, Paper, Typography, Button,
  MenuItem, Select, FormControl, CircularProgress, createTheme, ThemeProvider,
  List, ListItemButton, Modal, IconButton, Divider, ListItem, Link,
  Snackbar, Alert,
  Tooltip
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import RestaurantMenuIcon from '@mui/icons-material/RestaurantMenu';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import StarIcon from '@mui/icons-material/Star';
import CheckIcon from '@mui/icons-material/Check';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import LogoutIcon from '@mui/icons-material/Logout';
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
  const [viagemInfo, setViagemInfo] = useState({ lastStop: null, lotacao: null, atualizadoEm: null, indiceParada: null });
  const [tempoParaOnibusChegar, setTempoParaOnibusChegar] = useState(null);
  const [carregandoTempo, setCarregandoTempo] = useState(false);
  const [isExpirado, setIsExpirado] = useState(false);
  const [tempoDecorrido, setTempoDecorrido] = useState(null);
  const intervalRef = useRef(null);

  // Calcula o horário estimado de chegada baseado no horário atual
  const calcularHorarioChegada = (minutos) => {
    if (!minutos || minutos < 0) return null;
    const agora = new Date();
    agora.setMinutes(agora.getMinutes() + minutos);
    return agora.toTimeString().slice(0, 5);
  };

  useEffect(() => {
    if (!opt?.it?.id || !opt?.horario) return;
    const dataAtual = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const tripId = `${opt.it.id}_${opt.horario.replace(':', '')}_${dataAtual}`;
    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) {
        setViagemInfo(d.data());
      } else {
        setViagemInfo({ lastStop: null, lotacao: null, atualizadoEm: null, indiceParada: null });
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

  // Atualiza o tempo decorrido a cada 15 segundos
  useEffect(() => {
    const atualizarTempoDecorrido = () => {
      if (!viagemInfo.atualizadoEm) {
        setTempoDecorrido(null);
        return;
      }
      const agora = Date.now();
      const dataPost = viagemInfo.atualizadoEm.toDate?.() || new Date(viagemInfo.atualizadoEm.seconds * 1000);
      const diffMs = agora - dataPost.getTime();
      const diffMinutos = Math.floor(diffMs / 60000);
      setTempoDecorrido(diffMinutos);
    };

    atualizarTempoDecorrido();

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(atualizarTempoDecorrido, 15000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [viagemInfo.atualizadoEm]);

  useEffect(() => {
    const buscarTempoEstimado = async () => {
      if (!opt?.it?.id || !opt?.horario || !opt?.origem || !opt?.idxO) return;
      if (!viagemInfo || viagemInfo.indiceParada === undefined) return;
      setCarregandoTempo(true);
      try {
        const DocsViagem = { indiceParada: viagemInfo.indiceParada || 0 };
        const resultado = await calcularTempoParaOnibusChegarAteVoce(DocsViagem, opt.it, opt.origem, opt.horario);
        if (resultado) setTempoParaOnibusChegar(resultado);
      } catch (error) {
        console.warn("Erro ao buscar tempo estimado:", error);
      } finally {
        setCarregandoTempo(false);
      }
    };
    buscarTempoEstimado();
  }, [opt, viagemInfo]);

  // Atualiza a estimativa a cada 15 segundos
  useEffect(() => {
    if (!opt?.it?.id || !opt?.horario || !opt?.origem) return;
    
    const atualizarEstimativa = () => {
      if (!viagemInfo || viagemInfo.indiceParada === undefined) return;
      setCarregandoTempo(true);
      (async () => {
        try {
          const DocsViagem = { indiceParada: viagemInfo.indiceParada || 0 };
          const resultado = await calcularTempoParaOnibusChegarAteVoce(DocsViagem, opt.it, opt.origem, opt.horario);
          if (resultado) setTempoParaOnibusChegar(resultado);
        } catch (error) {
          console.warn("Erro ao buscar tempo estimado:", error);
        } finally {
          setCarregandoTempo(false);
        }
      })();
    };

    const estimativaInterval = setInterval(atualizarEstimativa, 15000);
    
    return () => {
      clearInterval(estimativaInterval);
    };
  }, [opt, viagemInfo]);

  const getEmojiLotacao = (nivel) => {
    if (isExpirado) return '🟡';
    if (nivel === 'lotado') return '🔴';
    if (nivel === 'medio') return '🟡';
    if (nivel === 'vazio') return '🟢';
    return '';
  };

  const temInformacaoAtiva = viagemInfo.lastStop && !isExpirado && viagemInfo.atualizadoEm;

  const formatarTempoDecorrido = (minutos) => {
    if (minutos === null || minutos === undefined) return null;
    if (minutos < 1) return 'agora mesmo';
    if (minutos === 1) return '1 minuto';
    return `${minutos} minutos`;
  };

  const tempoDecorridoFormatado = formatarTempoDecorrido(tempoDecorrido);

  const horarioChegadaEstimado = useMemo(() => {
    if (tempoParaOnibusChegar?.status === 'chegando' && tempoParaOnibusChegar.minutos) {
      return calcularHorarioChegada(tempoParaOnibusChegar.minutos);
    }
    if (tempoParaOnibusChegar?.status === 'aqui') {
      return 'agora mesmo';
    }
    return null;
  }, [tempoParaOnibusChegar]);

  return (
    <Paper className="bus-item-card" elevation={0}>
      <ListItemButton onClick={onClick} sx={{ p: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography className="bus-item-title">{opt.cat}</Typography>
            {viagemInfo.lotacao && !isExpirado && (
              <span style={{ fontSize: '14px' }}>{getEmojiLotacao(viagemInfo.lotacao)}</span>
            )}
          </Box>

          {temInformacaoAtiva ? (
            <>
              <Typography className="bus-item-info-line">
                Visto por último em: {safeTraduzir(viagemInfo.lastStop)}
                {tempoDecorridoFormatado && ` (há ${tempoDecorridoFormatado})`}
              </Typography>
              {viagemInfo.lotacao && !isExpirado && (
                <Typography className="bus-item-info-line" style={{ color: '#A1A1AA' }}>
                  Lotação: {viagemInfo.lotacao === 'vazio' ? 'Vazio' : viagemInfo.lotacao === 'medio' ? 'Médio' : 'Lotado'}
                </Typography>
              )}
            </>
          ) : (
            <Typography className="bus-item-info-line" style={{ color: '#7C7C7C', fontStyle: 'italic' }}>
              Sem informações
            </Typography>
          )}

          {carregandoTempo ? (
            <Typography className="bus-item-info-line">Calculando tempo...</Typography>
          ) : tempoParaOnibusChegar && tempoParaOnibusChegar.status === 'chegando' && horarioChegadaEstimado ? (
            <Typography className="bus-item-info-line" style={{ color: '#0845FF', fontWeight: '600' }}>
              Pode chegar até {horarioChegadaEstimado}
            </Typography>
          ) : tempoParaOnibusChegar && tempoParaOnibusChegar.status === 'aqui' ? (
            <Typography className="bus-item-info-line" style={{ color: '#0845FF', fontWeight: '600' }}>
              Está no seu ponto agora!
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
  const [paradaSelecionada, setParadaSelecionada] = useState(null);
  const [modoSelecao, setModoSelecao] = useState('lista');

  useEffect(() => {
    if (open) {
      setApelidos(getAllApelidos());
      setParadaSelecionada(null);
      setModoSelecao('lista');
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

  const handleSelecionarParada = (id) => {
    setParadaSelecionada(id);
    setModoSelecao('opcoes');
  };

  const handleVoltarLista = () => {
    setModoSelecao('lista');
    setParadaSelecionada(null);
  };

  const handleEscolherOpcao = (id, opcao) => {
    handleMudarApelido(id, opcao);
    handleVoltarLista();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        backgroundColor: '#1A1A1A',
        borderRadius: '24px',
        padding: '24px 20px 20px 20px',
        maxWidth: '420px',
        width: '100%',
        margin: '0 16px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #2A2A2A',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
        overflow: 'hidden'
      }}>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          mb: 2,
          gap: 1
        }}>
          {modoSelecao === 'opcoes' && (
            <IconButton 
              onClick={handleVoltarLista}
              sx={{ 
                color: '#7C7C7C',
                padding: '4px',
                '&:hover': { color: '#FFFFFF' }
              }}
            >
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography sx={{ 
            color: '#FFFFFF', 
            fontSize: '20px', 
            fontWeight: 700
          }}>
            {modoSelecao === 'lista' ? 'Como você deseja renomear?' : `Renomear ${paradaSelecionada?.toUpperCase()}`}
          </Typography>
        </Box>
        
        <Box sx={{ 
          flex: 1,
          overflowY: 'auto',
          pr: 1,
          '&::-webkit-scrollbar': {
            width: '4px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#3A3A3A',
            borderRadius: '4px',
          }
        }}>
          {modoSelecao === 'lista' ? (
            listaOrdenada.map((id) => (
              <Box 
                key={id} 
                onClick={() => handleSelecionarParada(id)}
                sx={{ 
                  backgroundColor: '#2A2A2A',
                  borderRadius: '16px',
                  padding: '14px 18px',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  border: '1px solid transparent',
                  '&:hover': {
                    borderColor: '#3A3A3A',
                    backgroundColor: '#353535',
                  }
                }}
              >
                <Typography sx={{ 
                  color: '#E0E0E0', 
                  fontSize: '16px', 
                  fontWeight: 500
                }}>
                  {traduzirSigla(id)}
                </Typography>
                <Typography sx={{ 
                  color: '#7C7C7C', 
                  fontSize: '14px'
                }}>
                  {apelidos[id] || traduzirSigla(id)}
                </Typography>
              </Box>
            ))
          ) : (
            paradaSelecionada && getOpcoesRenomear(paradaSelecionada).map((opcao) => (
              <Box 
                key={opcao} 
                onClick={() => handleEscolherOpcao(paradaSelecionada, opcao)}
                sx={{ 
                  backgroundColor: apelidos[paradaSelecionada] === opcao ? '#0845FF' : '#2A2A2A',
                  borderRadius: '16px',
                  padding: '14px 18px',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  border: '1px solid transparent',
                  '&:hover': {
                    borderColor: '#3A3A3A',
                    backgroundColor: apelidos[paradaSelecionada] === opcao ? '#0037CC' : '#353535',
                  }
                }}
              >
                <Typography sx={{ 
                  color: apelidos[paradaSelecionada] === opcao ? '#FFFFFF' : '#E0E0E0', 
                  fontSize: '16px', 
                  fontWeight: apelidos[paradaSelecionada] === opcao ? 600 : 500
                }}>
                  {opcao}
                </Typography>
                {apelidos[paradaSelecionada] === opcao && (
                  <CheckIcon sx={{ color: '#FFFFFF', fontSize: '22px' }} />
                )}
              </Box>
            ))
          )}
        </Box>
        
        {modoSelecao === 'lista' && (
          <Button 
            className="modal-save-btn" 
            startIcon={<SaveIcon />} 
            onClick={handleSalvar}
            sx={{ 
              mt: 2,
              flexShrink: 0
            }}
          >
            SALVAR ALTERAÇÕES
          </Button>
        )}
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
        backgroundColor: '#1A1A1A',
        borderRadius: '24px',
        padding: '24px 20px 20px 20px',
        maxWidth: '420px',
        width: '100%',
        margin: '0 16px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #2A2A2A',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
        overflow: 'hidden'
      }}>
        <Typography sx={{ 
          color: '#FFFFFF', 
          fontSize: '20px', 
          fontWeight: 700,
          mb: 2
        }}>
          Paradas Favoritas
        </Typography>
        
        <Box sx={{ 
          flex: 1,
          overflowY: 'auto',
          pr: 1,
          '&::-webkit-scrollbar': {
            width: '4px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#3A3A3A',
            borderRadius: '4px',
          }
        }}>
          {listaOrdenada.map(id => {
            const isFav = favoritos.includes(id);
            return (
              <Box 
                key={id} 
                onClick={() => handleToggle(id)}
                sx={{ 
                  backgroundColor: isFav ? '#0845FF' : '#2A2A2A',
                  borderRadius: '16px',
                  padding: '14px 18px',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  border: '1px solid transparent',
                  '&:hover': {
                    borderColor: isFav ? '#0037CC' : '#3A3A3A',
                    backgroundColor: isFav ? '#0037CC' : '#353535',
                  }
                }}
              >
                <Typography sx={{ 
                  color: isFav ? '#FFFFFF' : '#E0E0E0', 
                  fontSize: '16px', 
                  fontWeight: isFav ? 600 : 500
                }}>
                  {traduzirSigla(id)}
                </Typography>
                {isFav && (
                  <CheckIcon sx={{ 
                    color: '#FFFFFF', 
                    fontSize: '22px' 
                  }} />
                )}
              </Box>
            );
          })}
        </Box>
        
        <Button 
          className="modal-save-btn" 
          startIcon={<SaveIcon />} 
          onClick={handleSalvar}
          sx={{ 
            mt: 2,
            flexShrink: 0
          }}
        >
          SALVAR ALTERAÇÕES
        </Button>
      </Box>
    </Modal>
  );
};

// ==================== COMPONENTE MODAL CARDÁPIO ====================
const ModalCardapio = ({ open, onClose }) => {
  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        backgroundColor: '#1A1A1A',
        borderRadius: '24px',
        padding: '24px 20px 20px 20px',
        maxWidth: '420px',
        width: '100%',
        margin: '0 16px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #2A2A2A',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <Typography sx={{ 
          color: '#FFFFFF', 
          fontSize: '24px', 
          fontWeight: 700,
          mb: 2,
          textAlign: 'center'
        }}>
          Cardápio RU
        </Typography>
        
        <Box sx={{ 
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          py: 4
        }}>
          <Typography 
            variant="h6" 
            sx={{ 
              color: '#7C7C7C', 
              textAlign: 'center',
              fontWeight: 500,
              mb: 1
            }}
          >
            Página em construção
          </Typography>
          <Typography 
            variant="body2" 
            sx={{ 
              color: '#5A5A5A', 
              textAlign: 'center',
              maxWidth: '280px'
            }}
          >
            Em breve você poderá consultar o cardápio do RU aqui!
          </Typography>
        </Box>
        
        <Button 
          className="modal-save-btn" 
          onClick={onClose}
          sx={{ 
            mt: 2,
            flexShrink: 0
          }}
        >
          FECHAR
        </Button>
      </Box>
    </Modal>
  );
};

// ==================== COMPONENTE MODAL UPLOAD CARTEIRINHA ====================
const ModalUploadCarteirinha = ({ open, onClose, onSave }) => {
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
        if (onSave) onSave(base64);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleRemover = () => {
    setPreview(null);
    localStorage.removeItem('carteirinha');
    if (onSave) onSave(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSalvar = () => {
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        backgroundColor: '#1A1A1A',
        borderRadius: '24px',
        padding: '24px 20px 20px 20px',
        maxWidth: '420px',
        width: '100%',
        margin: '0 16px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #2A2A2A',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
        overflow: 'hidden'
      }}>
        <Typography sx={{ 
          color: '#FFFFFF', 
          fontSize: '20px', 
          fontWeight: 700,
          mb: 2
        }}>
          Carteirinha do Cobalto
        </Typography>
        
        <Box 
          sx={{
            width: '100%',
            minHeight: '150px',
            maxHeight: '300px',
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
            backgroundColor: '#222',
            flexShrink: 0
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {preview ? (
            <img 
              src={preview} 
              alt="Carteirinha" 
              style={{ 
                width: '100%', 
                height: '100%', 
                objectFit: 'contain'
              }} 
            />
          ) : (
            <>
              <CloudUploadIcon sx={{ fontSize: 48, color: '#555' }} />
              <Typography variant="body2" sx={{ color: '#777', mt: 1, textAlign: 'center' }}>
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
          <Button 
            variant="outlined" 
            color="error" 
            onClick={handleRemover} 
            fullWidth 
            sx={{ 
              mb: 2, 
              borderRadius: '12px',
              flexShrink: 0
            }}
          >
            Remover imagem
          </Button>
        )}
        
        <Button 
          className="modal-save-btn" 
          onClick={handleSalvar}
          sx={{ 
            mt: 'auto',
            flexShrink: 0
          }}
        >
          SALVAR
        </Button>
      </Box>
    </Modal>
  );
};

// ==================== MODAL DE PARADAS ====================
const ModalParadas = ({ open, onClose, paradasComEndereco }) => {
  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        backgroundColor: '#1A1A1A',
        borderRadius: '24px',
        padding: '24px 20px 20px 20px',
        maxWidth: '420px',
        width: '100%',
        margin: '0 16px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #2A2A2A',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
        overflow: 'hidden'
      }}>
        <Typography sx={{ 
          color: '#FFFFFF', 
          fontSize: '20px', 
          fontWeight: 700,
          mb: 2
        }}>
          Paradas
        </Typography>
        
        <Box sx={{ 
          flex: 1,
          overflowY: 'auto',
          pr: 1,
          '&::-webkit-scrollbar': {
            width: '4px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#3A3A3A',
            borderRadius: '4px',
          }
        }}>
          {paradasComEndereco.length === 0 ? (
            <Typography sx={{ color: '#7C7C7C', textAlign: 'center', py: 4 }}>
              Nenhuma parada encontrada.
            </Typography>
          ) : (
            paradasComEndereco.map((item, index) => (
              <Box 
                key={index} 
                sx={{ 
                  py: 1.5,
                  borderBottom: index < paradasComEndereco.length - 1 ? '1px solid #2A2A2A' : 'none'
                }}
              >
                <Typography sx={{ 
                  fontSize: '16px', 
                  fontWeight: 600, 
                  color: '#FFFFFF',
                  mb: 0.5
                }}>
                  {traduzirSigla(item.id)}
                </Typography>
                <Typography sx={{ 
                  fontSize: '13px', 
                  fontWeight: 400, 
                  color: '#7C7C7C',
                  lineHeight: 1.4
                }}>
                  {item.endereco || 'Endereço não disponível'}
                </Typography>
              </Box>
            ))
          )}
        </Box>
        
        <Button 
          className="modal-save-btn" 
          onClick={onClose}
          sx={{ 
            mt: 2,
            flexShrink: 0
          }}
        >
          FECHAR
        </Button>
      </Box>
    </Modal>
  );
};

// ==================== MODAL SAIBA MAIS ====================
const ModalSaibaMais = ({ open, onClose }) => {
  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        backgroundColor: '#1A1A1A',
        borderRadius: '24px',
        padding: '24px 20px 20px 20px',
        maxWidth: '420px',
        width: '100%',
        margin: '0 16px',
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid #2A2A2A',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.8)',
        overflow: 'hidden'
      }}>
        <Typography sx={{ 
          color: '#FFFFFF', 
          fontSize: '20px', 
          fontWeight: 700,
          mb: 2
        }}>
          Sobre o Busepel
        </Typography>
        
        <Box sx={{ 
          flex: 1,
          overflowY: 'auto',
          pr: 1,
          '&::-webkit-scrollbar': {
            width: '4px',
          },
          '&::-webkit-scrollbar-track': {
            background: 'transparent',
          },
          '&::-webkit-scrollbar-thumb': {
            background: '#3A3A3A',
            borderRadius: '4px',
          }
        }}>
          <Typography variant="body1" sx={{ color: '#E0E0E0', lineHeight: 1.8, mb: 2 }}>
            Projeto desenvolvido para a disciplina de Design de Interação em 2026/1.
          </Typography>
          
          <Typography variant="body1" sx={{ color: '#E0E0E0', lineHeight: 1.8, mb: 2 }}>
            Não armazenamos a imagem da sua carteirinha, fique tranquilo!
          </Typography>
          
          <Typography variant="body1" sx={{ color: '#E0E0E0', lineHeight: 1.8, mb: 2 }}>
            Para reportar bugs ou dar sugestões, entre no nosso grupo do WhatsApp:
          </Typography>
          <Link 
            href="https://chat.whatsapp.com/ESORzl0bwYO9pNPHWMYXe9" 
            target="_blank"
            rel="noopener noreferrer"
            sx={{ 
              color: '#0845FF',
              fontWeight: 600,
              textDecoration: 'underline',
              '&:hover': { color: '#0037CC' }
            }}
          >
            Clique aqui para entrar no grupo
          </Link>
        </Box>
        
        <Button 
          className="modal-save-btn" 
          onClick={onClose}
          sx={{ 
            mt: 2,
            flexShrink: 0
          }}
        >
          FECHAR
        </Button>
      </Box>
    </Modal>
  );
};

// ==================== COMPONENTE PRINCIPAL ====================
export default function HomePage() {
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
  const [paradasDataCompleta, setParadasDataCompleta] = useState({});
  const [carteirinhaPreview, setCarteirinhaPreview] = useState(null);
  
  const [modalRenomearOpen, setModalRenomearOpen] = useState(false);
  const [modalFavoritosOpen, setModalFavoritosOpen] = useState(false);
  const [modalCardapioOpen, setModalCardapioOpen] = useState(false);
  const [modalUploadOpen, setModalUploadOpen] = useState(false);
  const [modalParadasOpen, setModalParadasOpen] = useState(false);
  const [modalSaibaMaisOpen, setModalSaibaMaisOpen] = useState(false);
  
  const [alertSnackbar, setAlertSnackbar] = useState(null);
  
  const cacheViagensRef = useRef({});

  // ==================== FUNÇÃO DE LOGOUT ====================
  const handleLogout = async () => {
    try {
      const auth = getAuth();
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error('Erro ao fazer logout:', error);
    }
  };

  const categoriesConfig = useMemo(() => ({
    Anglo: ['anglo', 'anglo21', 'anglo2145', 'anglo730', 'anglo8', 'angloru'],
    Capão: ['anglocapao', 'capaoanglo', 'capaodireito', 'capaodireitobr', 'capaofamedanglo', 'capaolyceu', 'cotadacapao', 'direitocapao', 'famedcapao', 'lyceucapao'],
    ESEF: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira7', 'madeireira9'],
    FaMed: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira18', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira22', 'madeireira7', 'madeireira9', 'anglofamed', 'anglocapao', 'capaofamedanglo', 'cotadacapao', 'direitocapao', 'lyceucapao'],
    Madeireira: ['anglru', 'anglo21', 'madeireira7', 'madeireira9', 'madeireira11', 'madeireira15', 'madeireira16'],
    Palma: ['palmacp', 'palmapm']
  }), []);

  // Carregar carteirinha salva
  useEffect(() => {
    const saved = localStorage.getItem('carteirinha');
    if (saved) {
      setCarteirinhaPreview(saved);
    }
  }, []);

  // Buscar dados completos das paradas do Firebase
  useEffect(() => {
    const buscarParadasCompletas = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "paradas"));
        const dados = {};
        querySnapshot.forEach((doc) => {
          const id = doc.id.toLowerCase().trim();
          dados[id] = doc.data();
        });
        setParadasDataCompleta(dados);
      } catch (error) {
        console.error("Erro ao buscar paradas:", error);
      }
    };
    buscarParadasCompletas();
  }, []);

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
  }, [tabLinha, todosItinerarios, categoriesConfig, safeTraduzir, normalizarNome]);

  // Buscar endereços das paradas
  const paradasComEndereco = useMemo(() => {
    const paradasUnicas = new Set();
    const resultado = [];
    
    idsParadasUnicas.forEach(id => {
      if (!id || typeof id !== 'string') return;
      if (PARADAS_IGNORADAS.some(p => id.startsWith(p) || id === p)) return;
      
      const idLower = id.toLowerCase().trim();
      paradasUnicas.add(idLower);
    });
    
    paradasUnicas.forEach(id => {
      let endereco = null;
      
      if (paradasDataCompleta && paradasDataCompleta[id]) {
        endereco = paradasDataCompleta[id].endereco || null;
      }
      
      resultado.push({
        id: id,
        endereco: endereco
      });
    });
    
    return resultado.sort((a, b) => traduzirSigla(a.id).localeCompare(traduzirSigla(b.id)));
  }, [idsParadasUnicas, paradasDataCompleta]);

  // ==================== VALIDAÇÕES PARA EMBARQUE ====================
  const validarEmbarque = useCallback(() => {
    if (!origemId || !destinoId) {
      setAlertSnackbar({
        severity: 'warning',
        message: 'Selecione a parada de embarque e desembarque!'
      });
      return false;
    }

    if (origemId === destinoId) {
      setAlertSnackbar({
        severity: 'warning',
        message: 'A parada de embarque não pode ser igual à de desembarque!'
      });
      return false;
    }

    const ori = origemId.toLowerCase().trim();
    const des = destinoId.toLowerCase().trim();
    
    let itinerarioValido = false;
    for (const it of todosItinerarios) {
      if (!it.paradas || !Array.isArray(it.paradas)) continue;
      const paradas = it.paradas.map(normalizarNome);
      const idxO = paradas.indexOf(ori);
      const idxD = paradas.indexOf(des);
      if (idxO !== -1 && idxD !== -1 && idxO < idxD) {
        itinerarioValido = true;
        break;
      }
    }

    if (!itinerarioValido) {
      setAlertSnackbar({
        severity: 'error',
        message: 'Não há itinerário que ligue estas paradas!'
      });
      return false;
    }

    const agora = new Date();
    const horaAtual = agora.getHours();
    const minutoAtual = agora.getMinutes();
    const horaMinutoAtual = horaAtual * 60 + minutoAtual;
    
    const HORA_INICIO = 6 * 60;
    const HORA_FIM = 23 * 60;

    if (horaMinutoAtual < HORA_INICIO || horaMinutoAtual >= HORA_FIM) {
      setAlertSnackbar({
        severity: 'warning',
        message: 'O embarque só é permitido entre 06:00 e 23:00!'
      });
      return false;
    }

    return true;
  }, [origemId, destinoId, todosItinerarios, normalizarNome]);

  // ==================== HANDLE BUSCA ====================
  const handleBusca = useCallback(async () => {
    if (!validarEmbarque()) {
      return;
    }

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
          if (tempoAtualMin > tempoExpiracao) {
            continue;
          }
          
          if (tempoSaidaMin > tempoAtualMin + 120) {
            continue;
          }
          
          if (tempoSaidaMin + (idxO * 1.5) >= tempoAtualMin - 20) {
            const tripId = `${it.id}_${horario.replace(':', '')}_${dataAtual}`;
            let cat = Object.keys(categoriesConfig).find(c => categoriesConfig[c].includes(it.id)) || "Rota";
            
            matchesPotenciais.push({
              it, horario, numParadas: idxD - idxO, tempoRef: tempoSaidaMin,
              cat,
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
            let indice = -1;
            let chegouAoDestino = false;
            
            if (snap.exists()) {
              const dados = snap.data();
              indice = dados.indiceParada ?? -1;
              chegouAoDestino = dados.chegouAoDestino || false;
            }
            
            cacheViagensRef.current.viagens[match.tripId] = indice;
            return { match, indiceAtualOnibus: indice, chegouAoDestino };
          } catch (error) {
            cacheViagensRef.current.viagens[match.tripId] = -1;
            return { match, indiceAtualOnibus: -1, chegouAoDestino: false };
          }
        });
        resultadosBusca = await Promise.all(viagensPromises);
      }
      
      const todosResultados = [...matchesEmCache, ...resultadosBusca];
      
      const matchesFiltrados = todosResultados
        .filter(({ match, indiceAtualOnibus, chegouAoDestino }) => {
          if (chegouAoDestino) return false;
          
          if (indiceAtualOnibus >= 0) {
            return indiceAtualOnibus <= match.idxO;
          }
          
          const [h, m] = match.horario.split(':').map(Number);
          const tempoSaidaMin = h * 60 + m;
          const tempoEstimadoAteUsuario = match.idxO * 2;
          const tempoChegadaUsuario = tempoSaidaMin + tempoEstimadoAteUsuario;
          
          if (tempoAtualMin > tempoChegadaUsuario + 15) {
            return false;
          }
          
          return true;
        })
        .map(({ match }) => match);
      
      if (matchesFiltrados.length > 0) {
        const minP = Math.min(...matchesFiltrados.map(m => m.numParadas));
        setOpcoesEncontradas(
          matchesFiltrados
            .sort((a, b) => a.tempoRef - b.tempoRef)
            .map(m => ({ ...m, maisRapida: m.numParadas === minP }))
            .slice(0, 12)
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
  }, [origemId, destinoId, todosItinerarios, buscando, categoriesConfig, normalizarNome, validarEmbarque]);

  useEffect(() => {
    if (opcoesEncontradas.length === 0) return;
    const interval = setInterval(() => { handleBusca(); }, 30000);
    return () => clearInterval(interval);
  }, [opcoesEncontradas.length, handleBusca]);

  if (appLoading || !position || !position.lat || !position.lng) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 2, bgcolor: '#030303' }}>
        <CircularProgress sx={{ color: '#0845FF' }} />
        <Typography variant="body2" color="#fff" fontWeight="500">
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
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', mb: 2 }}>
                  <div className="screen-title" style={{ marginBottom: 0 }}>Olá, aluno!</div>
                  
                  <Tooltip 
                    title="Sair da conta" 
                    placement="left"
                    enterDelay={300}
                    leaveDelay={200}
                  >
                    <IconButton 
                      onClick={handleLogout} 
                      sx={{ 
                        color: '#7C7C7C',
                        '&:hover': { color: '#FF4444' },
                        padding: '8px',
                        transition: 'color 0.2s'
                      }}
                    >
                      <LogoutIcon sx={{ fontSize: '28px' }} />
                    </IconButton>
                  </Tooltip>
                </Box>
                
                <div 
                  className="aluno-upload-area" 
                  onClick={() => setModalUploadOpen(true)}
                  style={{
                    border: 'none',
                    backgroundColor: 'transparent',
                    padding: 0,
                    maxWidth: '100%',
                    aspectRatio: 'auto',
                    height: 'auto',
                    minHeight: '100px',
                    maxHeight: '300px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  {carteirinhaPreview ? (
                    <img 
                      src={carteirinhaPreview} 
                      alt="Carteirinha" 
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        objectFit: 'contain',
                        borderRadius: '12px'
                      }} 
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      minHeight: '150px',
                      backgroundColor: '#2A2A2A',
                      borderRadius: '16px',
                      border: '2px dashed #444',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '20px',
                      textAlign: 'center'
                    }}>
                      <CloudUploadIcon sx={{ fontSize: 40, color: '#555' }} />
                      <Typography variant="body2" sx={{ color: '#777', mt: 1 }}>
                        Faça upload da sua<br/>carteirinha do cobalto aqui!
                      </Typography>
                    </div>
                  )}
                </div>

                <div className="aluno-buttons-row">
                  <Button 
                    className="aluno-btn" 
                    startIcon={<BookmarkBorderIcon />} 
                    onClick={() => setModalFavoritosOpen(true)}
                  >
                    Favoritos
                  </Button>
                  <Button 
                    className="aluno-btn" 
                    startIcon={<RestaurantMenuIcon />} 
                    onClick={() => setModalCardapioOpen(true)}
                  >
                    Cardápio RU
                  </Button>
                </div>

                <Box sx={{ width: '100%', textAlign: 'center', mt: 2 }}>
                  <Link
                    component="button"
                    variant="body2"
                    onClick={() => setModalSaibaMaisOpen(true)}
                    sx={{
                      color: '#7C7C7C',
                      textDecoration: 'underline',
                      fontSize: '14px',
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      '&:hover': { color: '#FFFFFF' }
                    }}
                  >
                    Saiba mais
                  </Link>
                </Box>
              </div>
            )}

            {/* MODO VERIFICAR */}
            {modo === 'verificar' && (
              <>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                  <div className="screen-title" style={{ marginBottom: 0 }}>Horários</div>
                  
                  <Tooltip 
                    title="Ver paradas" 
                    placement="left"
                    enterDelay={300}
                    leaveDelay={200}
                  >
                    <IconButton 
                      onClick={() => setModalParadasOpen(true)} 
                      sx={{ 
                        color: '#7C7C7C',
                        '&:hover': { color: '#FFFFFF' },
                        padding: '8px'
                      }}
                    >
                      <img 
                        src="/paradas.svg" 
                        alt="Paradas" 
                        style={{ 
                          width: '32px', 
                          height: '32px',
                          filter: 'brightness(0) saturate(100%) invert(40%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%) contrast(85%)'
                        }}
                      />
                    </IconButton>
                  </Tooltip>
                </Box>
                
                <Tabs 
                  value={tabLinha} 
                  onChange={(e, v) => setTabLinha(v)} 
                  className="custom-tabs" 
                  variant="scrollable" 
                  scrollButtons={false} 
                  TabIndicatorProps={{ style: { display: 'none' } }}
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
              <Tooltip 
                title="Embarque" 
                placement="top"
                enterDelay={300}
                leaveDelay={200}
              >
                <button 
                  className={`nav-icon-btn ${modo === 'embarcar' ? 'active' : ''}`} 
                  onClick={() => setModo('embarcar')}
                >
                  <img 
                    src={modo === 'embarcar' ? '/busativo.svg' : '/businativo.svg'} 
                    alt="Embarque" 
                    className="nav-icon-bus" 
                  />
                </button>
              </Tooltip>
              
              <Tooltip 
                title="Perfil" 
                placement="top"
                enterDelay={300}
                leaveDelay={200}
              >
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
              </Tooltip>
              
              <Tooltip 
                title="Rotas" 
                placement="top"
                enterDelay={300}
                leaveDelay={200}
              >
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
              </Tooltip>
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
        onClose={() => {
          const saved = localStorage.getItem('carteirinha');
          if (saved) {
            setCarteirinhaPreview(saved);
          }
          setModalUploadOpen(false);
        }}
        onSave={(image) => setCarteirinhaPreview(image)}
      />

      <ModalParadas 
        open={modalParadasOpen} 
        onClose={() => setModalParadasOpen(false)} 
        paradasComEndereco={paradasComEndereco}
      />

      <ModalSaibaMais
        open={modalSaibaMaisOpen}
        onClose={() => setModalSaibaMaisOpen(false)}
      />

      {/* SNACKBAR DE ALERTA */}
      <Snackbar
        open={!!alertSnackbar}
        autoHideDuration={4000}
        onClose={() => setAlertSnackbar(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ mt: 10 }}
      >
        <Alert 
          onClose={() => setAlertSnackbar(null)} 
          severity={alertSnackbar?.severity || 'info'} 
          sx={{ width: '100%', fontWeight: 'bold' }}
        >
          {alertSnackbar?.message}
        </Alert>
      </Snackbar>
    </ThemeProvider>
  );
}