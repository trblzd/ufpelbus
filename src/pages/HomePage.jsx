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
  MenuItem, Select, FormControl, CircularProgress, Skeleton,
  List, ListItemButton, Modal, IconButton, Divider, ListItem, Link,
  Snackbar, Alert,
  Tooltip, Slide, Fade, useMediaQuery
} from '@mui/material';
import { ArrowBackIcon, BookmarkBorderIcon, CheckIcon, CloseIcon, CloudUploadIcon, DirectionsBusFilledIcon, EditIcon, LocationOnIcon, LogoutIcon, PersonIcon, RestaurantMenuIcon, SaveIcon, ScheduleIcon, StarIcon, TripOriginIcon } from '../components/icons';
import { useAppData } from '../App';
import { getFavoritos, toggleFavorito } from '../services/favoritosService';
import { getAllApelidos, setMultiplosApelidos, getApelidoComFallback } from '../services/apelidosService';
import { cores, movimento } from '../theme/tokens';
import { transicionar } from '../theme/transicoes';
import './HomePage.css';


// Enter/Espaço em elementos clicáveis que não são <button>
const ativarComTeclado = (fn) => (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

// Modais como bottom sheet: cantos só em cima e alça
const sheetSx = {
  backgroundColor: cores.superficie1,
  borderRadius: '28px 28px 0 0',
  padding: '12px 16px calc(24px + env(safe-area-inset-bottom, 0px))',
  maxWidth: '480px',
  width: '100%',
  margin: 0,
  maxHeight: '85dvh',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 -4px 24px rgba(0, 0, 0, 0.25)',
  overflow: 'hidden',
  outline: 'none',
  '&::before': { content: '""', display: 'block', width: 36, height: 4, borderRadius: 2, backgroundColor: cores.superficie3, mx: 'auto', mb: '16px', flexShrink: 0 },
};

// Bottom sheet M3: entra e sai pela borda de baixo, sem fade; com movimento reduzido, só fade
function Folha({ open, onClose, sx, children }) {
  const reduzir = useMediaQuery('(prefers-reduced-motion: reduce)');
  const Transicao = reduzir ? Fade : Slide;
  return (
    <Modal open={open} onClose={onClose} closeAfterTransition slotProps={{ backdrop: { transitionDuration: { enter: 250, exit: 200 } } }}>
      <Transicao in={open} {...(reduzir ? {} : { direction: 'up' })} timeout={{ enter: 250, exit: 200 }} easing={{ enter: movimento.desacelerar, exit: movimento.acelerar }}>
        <Box sx={{ ...sheetSx, ...sx }}>{children}</Box>
      </Transicao>
    </Modal>
  );
}

const PARADAS_IGNORADAS = ['int_', 'ponto-indefinido'];

// ==================== COMPONENTE DE ITEM DE ÔNIBUS ====================
// Janela de validade da lotação — mesma do MainPage (20 min)
const JANELA_LOTACAO_MS = 20 * 60 * 1000;
// Intervalo de atualização do "há X minutos" (30s, conforme pedido)
const INTERVALO_TEMPO_DECORRIDO_MS = 30 * 1000;

const BusItem = ({ opt, onClick, safeTraduzir }) => {
  const [viagemInfo, setViagemInfo] = useState({
    ultimaParada: null,
    historicoLotacao: [],
    atualizadoEm: null,
    indiceParada: null,
  });
  const [tempoParaOnibusChegar, setTempoParaOnibusChegar] = useState(null);
  const [carregandoTempo, setCarregandoTempo] = useState(false);
  const [tempoDecorrido, setTempoDecorrido] = useState(null);
  const intervalRef = useRef(null);

  const calcularHorarioChegada = (minutosEstimados) => {
    if (!minutosEstimados || minutosEstimados < 0) return null;
    if (!opt?.horario) return null;

    const [horas, minutos] = opt.horario.split(':').map(Number);
    const dataSaida = new Date();
    dataSaida.setHours(horas, minutos, 0, 0);
    dataSaida.setMinutes(dataSaida.getMinutes() + minutosEstimados);
    return dataSaida.toTimeString().slice(0, 5);
  };

  // ============ SNAPSHOT DO FIRESTORE ============
  // Lê os mesmos campos que o MainPage usa: ultimaParada, historicoLotacao,
  // atualizadoEm, indiceParada.
  useEffect(() => {
    if (!opt?.it?.id || !opt?.horario) return;
    const dataAtual = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const tripId = `${opt.it.id}_${opt.horario.replace(':', '')}_${dataAtual}`;

    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) {
        const dados = d.data();
        setViagemInfo({
          ultimaParada: dados.ultimaParada || dados.paradaAtual || null,
          historicoLotacao: dados.historicoLotacao || [],
          atualizadoEm: dados.atualizadoEm || null,
          indiceParada: dados.indiceParada ?? null,
        });
      } else {
        setViagemInfo({
          ultimaParada: null,
          historicoLotacao: [],
          atualizadoEm: null,
          indiceParada: null,
        });
      }
    });
    return () => unsub();
  }, [opt]);

  // ============ LOTACAO (mesma lógica do MainPage) ============
  const infoLotacao = useMemo(() => {
    const historico = viagemInfo.historicoLotacao;
    if (!historico || historico.length === 0) return null;

    const agoraMs = Date.now();
    const votosRecentes = historico.filter((voto) => {
      const dataVoto = voto.data?.toDate
        ? voto.data.toDate().getTime()
        : voto.data?.seconds * 1000 || agoraMs;
      return agoraMs - dataVoto <= JANELA_LOTACAO_MS;
    });
    if (votosRecentes.length === 0) return null;

    const soma = votosRecentes.reduce((acc, curr) => acc + (curr.valor || 0), 0);
    const media = parseFloat((soma / votosRecentes.length).toFixed(1));

    let label = 'Vazio';
    let cor = cores.sucesso;
    if (media > 4.0) {
      label = 'Lotado';
      cor = cores.perigo;
    } else if (media > 2.5) {
      label = 'Médio';
      cor = cores.alerta;
    }
    return { media, label, cor };
  }, [viagemInfo.historicoLotacao]);

  // ============ TEMPO DECORRIDO (atualiza a cada 30s) ============
  useEffect(() => {
    const atualizarTempoDecorrido = () => {
      if (!viagemInfo.atualizadoEm) {
        setTempoDecorrido(null);
        return;
      }
      const agora = Date.now();
      const dataPost = viagemInfo.atualizadoEm.toDate
        ? viagemInfo.atualizadoEm.toDate()
        : new Date(viagemInfo.atualizadoEm.seconds * 1000);
      const diffMs = agora - dataPost.getTime();
      const diffMinutos = Math.floor(diffMs / 60000);
      setTempoDecorrido(diffMinutos);
    };

    atualizarTempoDecorrido();

    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(
      atualizarTempoDecorrido,
      INTERVALO_TEMPO_DECORRIDO_MS
    );

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [viagemInfo.atualizadoEm]);

  // ============ TEMPO ESTIMADO ATÉ A PARADA DO USUÁRIO ============
  useEffect(() => {
    const buscarTempoEstimado = async () => {
      if (!opt?.it?.id || !opt?.horario || !opt?.origem || !opt?.idxO) return;
      if (viagemInfo.indiceParada === null || viagemInfo.indiceParada === undefined) return;

      setCarregandoTempo(true);
      try {
        const DocsViagem = { indiceParada: viagemInfo.indiceParada || 0 };
        const resultado = await calcularTempoParaOnibusChegarAteVoce(
          DocsViagem,
          opt.it,
          opt.origem,
          opt.horario
        );
        if (resultado) setTempoParaOnibusChegar(resultado);
      } catch (error) {
        console.warn('Erro ao buscar tempo estimado:', error);
      } finally {
        setCarregandoTempo(false);
      }
    };
    buscarTempoEstimado();
  }, [opt, viagemInfo.indiceParada]);

  // Atualiza estimativa a cada 30s (alinhado ao tempoDecorrido)
  useEffect(() => {
    if (!opt?.it?.id || !opt?.horario || !opt?.origem) return;

    const atualizarEstimativa = () => {
      if (viagemInfo.indiceParada === null || viagemInfo.indiceParada === undefined) return;
      setCarregandoTempo(true);
      (async () => {
        try {
          const DocsViagem = { indiceParada: viagemInfo.indiceParada || 0 };
          const resultado = await calcularTempoParaOnibusChegarAteVoce(
            DocsViagem,
            opt.it,
            opt.origem,
            opt.horario
          );
          if (resultado) setTempoParaOnibusChegar(resultado);
        } catch (error) {
          console.warn('Erro ao buscar tempo estimado:', error);
        } finally {
          setCarregandoTempo(false);
        }
      })();
    };

    const estimativaInterval = setInterval(
      atualizarEstimativa,
      INTERVALO_TEMPO_DECORRIDO_MS
    );
    return () => clearInterval(estimativaInterval);
  }, [opt, viagemInfo.indiceParada]);

  // ============ DERIVADOS ============
  const formatarTempoDecorrido = (minutos) => {
    if (minutos === null || minutos === undefined) return null;
    if (minutos < 1) return 'agora mesmo';
    if (minutos === 1) return '1 minuto';
    return `${minutos} minutos`;
  };

  const tempoDecorridoFormatado = formatarTempoDecorrido(tempoDecorrido);

  // "Tem informação" = existe uma última parada OU um atualizadoEm
  // (não dependemos mais de duracaoEstimada nem de lastStop).
  const temInformacaoAtiva = !!viagemInfo.ultimaParada || !!viagemInfo.atualizadoEm;

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
      <ListItemButton
        onClick={onClick}
        sx={{ p: '16px', minHeight: 72, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography className="bus-item-title">{opt.cat}</Typography>
            {infoLotacao && (
              <span className="status-dot" style={{ backgroundColor: infoLotacao.cor }} aria-label={`Lotação: ${infoLotacao.label}`} role="img" />
            )}
          </Box>

          {temInformacaoAtiva ? (
            <>
              {viagemInfo.ultimaParada && (
                <Typography className="bus-item-info-line">
                  Visto por último em: {safeTraduzir(viagemInfo.ultimaParada)}
                  {tempoDecorridoFormatado && ` (há ${tempoDecorridoFormatado})`}
                </Typography>
              )}
              {infoLotacao && (
                <Typography className="bus-item-info-line">
                  Lotação: {infoLotacao.label}
                </Typography>
              )}
            </>
          ) : (
            <Typography className="bus-item-info-line">
              Sem informações
            </Typography>
          )}

          {carregandoTempo ? (
            <Typography className="bus-item-info-line">Calculando tempo...</Typography>
          ) : tempoParaOnibusChegar && tempoParaOnibusChegar.status === 'chegando' && horarioChegadaEstimado ? (
            <Typography className="bus-item-info-line bus-item-info-line--destaque">
              Pode chegar até {horarioChegadaEstimado}
            </Typography>
          ) : tempoParaOnibusChegar && tempoParaOnibusChegar.status === 'aqui' ? (
            <Typography className="bus-item-info-line bus-item-info-line--chegou">
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
  const listaRef = useRef(null);

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
  const nomeExibido = (id) => apelidos[id] || traduzirSigla(id);
  setListaOrdenada(
    [...filtrada].sort((a, b) => nomeExibido(a).localeCompare(nomeExibido(b), 'pt-BR'))
  );
}, [idsParadas, apelidos]);

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

  const handleSelecionarParada = (id) => transicionar('avancar', () => {
    setParadaSelecionada(id);
    setModoSelecao('opcoes');
  }, { regiao: listaRef.current });

  const handleVoltarLista = () => transicionar('voltar', () => {
    setModoSelecao('lista');
    setParadaSelecionada(null);
  }, { regiao: listaRef.current });

  const handleEscolherOpcao = (id, opcao) => {
    handleMudarApelido(id, opcao);
    handleVoltarLista();
  };

  return (
    <Folha open={open} onClose={onClose}>
        <Box sx={{ 
          display: 'flex', 
          alignItems: 'center', 
          mb: 2,
          gap: 1
        }}>
          {modoSelecao === 'opcoes' && (
            <IconButton 
              aria-label="Voltar para a lista"
              onClick={handleVoltarLista}
              sx={{ 
                color: cores.texto2,
                padding: '4px',
                '&:hover': { color: cores.texto }
              }}
            >
              <ArrowBackIcon />
            </IconButton>
          )}
          <Typography sx={{ 
            color: cores.texto, 
            fontSize: '20px', 
            fontWeight: 700
          }}>
            {modoSelecao === 'lista' ? 'Como você deseja renomear?' : `Renomear ${paradaSelecionada?.toUpperCase()}`}
          </Typography>
        </Box>
        
        <Box ref={listaRef} sx={{ 
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
            background: cores.superficie3,
            borderRadius: '4px',
          }
        }}>
          {modoSelecao === 'lista' ? (
            listaOrdenada.map((id) => (
              <Box 
                key={id} 
                onClick={() => handleSelecionarParada(id)}
                role="button"
                tabIndex={0}
                onKeyDown={ativarComTeclado(() => handleSelecionarParada(id))}
                sx={{ 
                  backgroundColor: 'transparent',
                  borderRadius: '16px',
                  padding: '14px 16px',
                  minHeight: 56,
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  border: `1px solid ${cores.superficie2}`,
                  '&:hover': {
                    backgroundColor: cores.superficie2,
                  }
                }}
              >
                <Typography sx={{ 
                  color: cores.texto, 
                  fontSize: '16px', 
                  fontWeight: 500
                }}>
                  {traduzirSigla(id)}
                </Typography>
                <Typography sx={{ 
                  color: cores.texto2, 
                  fontSize: '14px'
                }}>
                  {apelidos[id] || traduzirSigla(id)}
                </Typography>
              </Box>
            ))
          ) : (
            paradaSelecionada && getOpcoesRenomear(paradaSelecionada).map((opcao) => {
              const selecionado = apelidos[paradaSelecionada] === opcao;
              return (
                <Box 
                  key={opcao} 
                  onClick={() => handleEscolherOpcao(paradaSelecionada, opcao)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selecionado}
                  onKeyDown={ativarComTeclado(() => handleEscolherOpcao(paradaSelecionada, opcao))}
                  sx={{ 
                    backgroundColor: selecionado ? cores.marcaContainer : 'transparent',
                    borderRadius: '16px',
                    padding: '14px 16px',
                    minHeight: 56,
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    border: selecionado ? `2px solid ${cores.marcaClara}` : `1px solid ${cores.superficie2}`,
                    '&:hover': {
                      backgroundColor: cores.superficie2,
                    }
                  }}
                >
                  <Typography sx={{ 
                    color: cores.texto, 
                    fontSize: '16px', 
                    fontWeight: selecionado ? 600 : 500
                  }}>
                    {opcao}
                  </Typography>
                  {selecionado && (
                    <CheckIcon sx={{ color: cores.texto, fontSize: '22px' }} />
                  )}
                </Box>
              );
            }))}
        </Box>
        
        {modoSelecao === 'lista' && (
          <Button 
            variant="contained" 
            size="large" 
            fullWidth
            startIcon={<SaveIcon />} 
            onClick={handleSalvar}
            sx={{ 
              mt: 2,
              flexShrink: 0
            }}
          >
            Salvar alterações
          </Button>
        )}
    </Folha>
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
    const nomeExibido = (id) => getApelidoComFallback(id, traduzirSigla(id));
const ordenada = [...filtrada].sort((a, b) => {
  const aFav = favoritos.includes(a);
  const bFav = favoritos.includes(b);
  if (aFav && !bFav) return -1;
  if (!aFav && bFav) return 1;
  return nomeExibido(a).localeCompare(nomeExibido(b), 'pt-BR');
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
    <Folha open={open} onClose={onClose}>
        <Typography sx={{ 
          color: cores.texto, 
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
            background: cores.superficie3,
            borderRadius: '4px',
          }
        }}>
          {listaOrdenada.map(id => {
            const isFav = favoritos.includes(id);
            return (
              <Box 
                key={id} 
                onClick={() => handleToggle(id)}
                role="button"
                tabIndex={0}
                aria-pressed={isFav}
                onKeyDown={ativarComTeclado(() => handleToggle(id))}
                sx={{ 
                  backgroundColor: isFav ? cores.marcaContainer : 'transparent',
                  borderRadius: '16px',
                  padding: '14px 16px',
                  minHeight: 56,
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  border: isFav ? `2px solid ${cores.marcaClara}` : `1px solid ${cores.superficie2}`,
                  '&:hover': {
                    backgroundColor: cores.superficie2,
                  }
                }}
              >
                <Typography sx={{
                  color: cores.texto, 
                  fontSize: '16px', 
                  fontWeight: isFav ? 600 : 500
                }}>
                  {traduzirSigla(id)}
                </Typography>
                {isFav && (
                  <CheckIcon sx={{ 
                    color: cores.texto, 
                    fontSize: '22px' 
                  }} />
                )}
              </Box>
            );
          })}
        </Box>
        
        <Button 
          variant="contained" 
          size="large" 
          fullWidth
          startIcon={<SaveIcon />} 
          onClick={handleSalvar}
          sx={{ 
            mt: 2,
            flexShrink: 0
          }}
        >
          Salvar alterações
        </Button>
    </Folha>
  );
};

// ==================== COMPONENTE MODAL CARDÁPIO ====================
const ModalCardapio = ({ open, onClose }) => {
  return (
    <Folha open={open} onClose={onClose} sx={{ alignItems: 'center', justifyContent: 'center' }}>
        <Typography sx={{ 
          color: cores.texto, 
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
              color: cores.texto2, 
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
              color: cores.texto3, 
              textAlign: 'center',
              maxWidth: '280px'
            }}
          >
            Em breve você poderá consultar o cardápio do RU diretamente por aqui. <br/>
            Por enquanto, acesse no <a href="https://cobalto.ufpel.edu.br/portal/cardapios/cardapioPublico" target="_blank" rel="noopener noreferrer" style={{ color: cores.link }}>Cobalto</a>
          </Typography>
        </Box>
        
        <Button 
          variant="contained" 
          size="large" 
          fullWidth
          onClick={onClose}
          sx={{ 
            mt: 2,
            flexShrink: 0
          }}
        >
          Fechar
        </Button>
    </Folha>
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
    <Folha open={open} onClose={onClose}>
        <Typography sx={{ 
          color: cores.texto, 
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
            borderRadius: '20px',
            border: `1px dashed ${cores.superficie3}`,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
            mb: 2,
            backgroundColor: cores.superficie1,
            flexShrink: 0
          }}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Enviar foto da carteirinha"
          onKeyDown={(e) => ativarComTeclado(() => fileInputRef.current?.click())(e)}
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
              <CloudUploadIcon sx={{ fontSize: 48, color: cores.texto3 }} />
              <Typography variant="body2" sx={{ color: cores.texto2, mt: 1, textAlign: 'center' }}>
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
              flexShrink: 0
            }}
          >
            Remover imagem
          </Button>
        )}
        
        <Button 
          variant="contained" 
          size="large" 
          fullWidth
          onClick={handleSalvar}
          sx={{ 
            mt: 'auto',
            flexShrink: 0
          }}
        >
          Salvar
        </Button>
    </Folha>
  );
};

// ==================== MODAL DE PARADAS ====================
const ModalParadas = ({ open, onClose, paradasComEndereco }) => {
  return (
    <Folha open={open} onClose={onClose}>
        <Typography sx={{ 
          color: cores.texto, 
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
            background: cores.superficie3,
            borderRadius: '4px',
          }
        }}>
          {paradasComEndereco.length === 0 ? (
            <Typography sx={{ color: cores.texto2, textAlign: 'center', py: 4 }}>
              Nenhuma parada encontrada.
            </Typography>
          ) : (
            paradasComEndereco.map((item, index) => (
              <Box 
                key={index} 
                sx={{ 
                  py: 1.5,
                  borderBottom: index < paradasComEndereco.length - 1 ? `1px solid ${cores.superficie2}` : 'none'
                }}
              >
                <Typography sx={{ 
                  fontSize: '16px', 
                  fontWeight: 600, 
                  color: cores.texto,
                  mb: 0.5
                }}>
                  {traduzirSigla(item.id)}
                </Typography>
                <Typography sx={{ 
                  fontSize: '13px', 
                  fontWeight: 400, 
                  color: cores.texto2,
                  lineHeight: 1.4
                }}>
                  {item.endereco || 'Endereço não disponível'}
                </Typography>
              </Box>
            ))
          )}
        </Box>
        
        <Button 
          variant="contained" 
          size="large" 
          fullWidth
          onClick={onClose}
          sx={{ 
            mt: 2,
            flexShrink: 0
          }}
        >
          Fechar
        </Button>
    </Folha>
  );
};

// ==================== MODAL SAIBA MAIS ====================
const ModalSaibaMais = ({ open, onClose }) => {
  return (
    <Folha open={open} onClose={onClose}>
        <Typography sx={{ 
          color: cores.texto, 
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
            background: cores.superficie3,
            borderRadius: '4px',
          }
        }}>
          <Typography variant="body1" sx={{ color: cores.texto, lineHeight: 1.8, mb: 2 }}>
            Projeto desenvolvido para a disciplina de Design de Interação em 2026/1.
          </Typography>
          
          <Typography variant="body1" sx={{ color: cores.texto, lineHeight: 1.8, mb: 2 }}>
            Não armazenamos a imagem da sua carteirinha, fique tranquilo!
          </Typography>
          
          <Typography variant="body1" sx={{ color: cores.texto, lineHeight: 1.8, mb: 2 }}>
            Para reportar bugs ou dar sugestões, entre no nosso grupo do WhatsApp:
          </Typography>
          <Link 
            href="https://chat.whatsapp.com/ESORzl0bwYO9pNPHWMYXe9" 
            target="_blank"
            rel="noopener noreferrer"
            sx={{ 
              color: cores.link,
              fontWeight: 500,
              textDecoration: 'underline',
              '&:hover': { color: cores.linkHover }
            }}
          >
            Clique aqui para entrar no grupo
          </Link>
                <Typography variant="body1" sx={{ color: cores.texto, lineHeight: 1.8, mb: 2 }}>
        Siga a gente no Instagram:
      </Typography>
      <Link
        href="https://instagram.com/busepel.app"
        target="_blank"
        rel="noopener noreferrer"
        sx={{
          color: cores.link,
          fontWeight: 500,
          textDecoration: 'underline',
          mb: 2,
          display: 'inline-block',
          '&:hover': { color: cores.linkHover }
        }}
      >
        @busepel.app
      </Link>
        </Box>
        
        <Button 
          variant="contained" 
          size="large" 
          fullWidth
          onClick={onClose}
          sx={{ 
            mt: 2,
            flexShrink: 0
          }}
        >
          Fechar
        </Button>
    </Folha>
  );
};

// ==================== COMPONENTE PRINCIPAL ====================
export default function HomePage() {
  const navigate = useNavigate();
  const { todosItinerarios, paradasCoordenadas, idsParadasUnicas, favoritos, loading: appLoading } = useAppData();
  
  const [gpsAtivo, setGpsAtivo] = useState(true);
  const { position, error: erroGps } = useLocation({ ativo: gpsAtivo });
  const jaPreencheuParadaRef = useRef(false);
  const conteudoRef = useRef(null);
  const temResultadosRef = useRef(false);
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
    Capão: ['anglocapao', 'capaoanglo', 'capaodireito', 'capaodireitobr', 'capaofamedanglo', 'capaolyceu', 'cotadacapao', 'direitocapao', 'famedcapao', 'lyceucapao', 'capaocotada', 'capaofamedbr', 'capaodireitobr', 'direitocapaobr', 'ceucapao'],
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

  const navegarParaMapa = (it, horario, origem, destino, cat, modoAtual, origemEl) => {
    const itinerarioStr = encodeURIComponent(JSON.stringify(it));
    const params = new URLSearchParams({ 
      itinerario: itinerarioStr, 
      horario, 
      origem: origem || '', 
      destino: destino || '', 
      categoria: cat, 
      modo: modoAtual 
    });
    transicionar('container', () => navigate(`/mapa?${params.toString()}`), { origem: origemEl });
  };

  const trocarModo = (novo) => { if (novo !== modo) transicionar('topo', () => setModo(novo)); };

  const trocarLinha = (v) => {
    const cats = Object.keys(categoriesConfig);
    transicionar(cats.indexOf(v) > cats.indexOf(tabLinha) ? 'lateral-proximo' : 'lateral-anterior', () => setTabLinha(v), { regiao: conteudoRef.current });
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

  // Sem GPS a Home funciona; o usuário escolhe a parada manualmente
  const [gpsAvisoFechado, setGpsAvisoFechado] = useState(false);
  const alertaAtual = alertSnackbar ?? (erroGps && !position?.lat && !gpsAvisoFechado
    ? { severity: 'warning', message: 'Não foi possível obter sua localização. Escolha a parada de embarque manualmente.' }
    : null);
  const fecharAlerta = () => { setAlertSnackbar(null); setGpsAvisoFechado(true); };

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
        const novas = matchesFiltrados
          .sort((a, b) => a.tempoRef - b.tempoRef)
          .map(m => ({ ...m, maisRapida: m.numParadas === minP }))
          .slice(0, 12);
        if (temResultadosRef.current) setOpcoesEncontradas(novas);
        else transicionar('avancar', () => setOpcoesEncontradas(novas), { regiao: conteudoRef.current });
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

  useEffect(() => { temResultadosRef.current = opcoesEncontradas.length > 0; }, [opcoesEncontradas.length]);

  if (appLoading || (!erroGps && (!position || !position.lat || !position.lng))) {
    return (
      <Box className="home-page-bg" aria-busy="true">
        <Box className="home-page-container">
          <div className="brand-logo-container">
            <img src="/buslogo.svg" alt="Busepel Logo" className="brand-logo" />
          </div>
          <div className="scroll-content">
            <div className="screen-title">Embarque</div>
            <Skeleton variant="rounded" height={113} sx={{ borderRadius: 'var(--raio-md)', mb: 2 }} />
            <Skeleton variant="rounded" height={56} sx={{ borderRadius: 'var(--raio-pill)' }} />
            <Typography variant="body2" color={cores.texto2} fontWeight="500" sx={{ mt: 2, textAlign: 'center' }}>
              Obtendo sua localização...
            </Typography>
          </div>
        </Box>
      </Box>
    );
  }

  return (
    <>
      <Box className="home-page-bg">
        <Box className={`home-page-container ${modo !== 'embarcar' ? 'no-logo' : ''}`}>
          
          {modo === 'embarcar' && (
            <div className="brand-logo-container">
              <img 
                src="/buslogo.svg" 
                alt="Busepel Logo" 
                className="brand-logo" 
              />
            </div>
          )}

          <div className="scroll-content" ref={conteudoRef}>
            {/* MODO EMBARCAR */}
            {modo === 'embarcar' && (
              <>
                <div className="screen-title">Embarque</div>
                {opcoesEncontradas.length === 0 ? (
                  <>
                    <div className="input-block-container aparecer">
                      <span className="rota-conector" aria-hidden="true" />
                      <div className="rota-linha">
                        <TripOriginIcon className="rota-marcador" fontSize="small" />
                        <FormControl fullWidth variant="standard">
                          <Select 
                            SelectDisplayProps={{ 'aria-label': 'Parada de embarque' }}
                            value={origemId} 
                            onChange={e => setOrigemId(e.target.value)} 
                            displayEmpty
                            renderValue={(selected) => (
                              <span style={{ color: selected ? cores.texto : cores.texto2, fontWeight: selected ? 500 : 400 }}>
                                {selected ? safeTraduzir(selected) : 'De onde?'}
                              </span>
                            )}
                            disableUnderline
                            sx={{ color: cores.texto, fontSize: '17px', fontWeight: 500 }}
                          >
                            {idsParadasUnicas.map(id => {
                              const isFav = favoritos.includes(id);
                              return (
                                <MenuItem key={id} value={id}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <span>{safeTraduzir(id)}</span>
                                    {isFav && <StarIcon sx={{ color: cores.texto, fontSize: '18px' }} />}
                                  </Box>
                                </MenuItem>
                              );
                            })}
                          </Select>
                        </FormControl>
                      </div>
                      
                      <div className="rota-divisor" />
                      
                      <div className="rota-linha">
                        <LocationOnIcon className="rota-marcador" fontSize="small" />
                        <FormControl fullWidth variant="standard">
                          <Select 
                            SelectDisplayProps={{ 'aria-label': 'Parada de desembarque' }}
                            value={destinoId} 
                            onChange={e => setDestinoId(e.target.value)} 
                            displayEmpty
                            renderValue={(selected) => (
                              <span style={{ color: selected ? cores.texto : cores.texto2, fontWeight: selected ? 500 : 400 }}>
                                {selected ? safeTraduzir(selected) : 'Para onde?'}
                              </span>
                            )}
                            disableUnderline
                            sx={{ color: cores.texto, fontSize: '17px', fontWeight: 500 }}
                          >
                            {idsParadasUnicas.map(id => {
                              const isFav = favoritos.includes(id);
                              return (
                                <MenuItem key={id} value={id}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <span>{safeTraduzir(id)}</span>
                                    {isFav && <StarIcon sx={{ color: cores.texto, fontSize: '18px' }} />}
                                  </Box>
                                </MenuItem>
                              );
                            })}
                          </Select>
                        </FormControl>
                      </div>
                    </div>

                    <Button 
                      className="aparecer"
                      fullWidth 
                      variant="contained" 
                      size="large" 
                      onClick={handleBusca} 
                      disabled={buscando}
                    >
                      {buscando ? <CircularProgress size={24} color="inherit" /> : 'Buscar ônibus'}
                    </Button>
                  </>
                ) : (
                  <>
                    <List disablePadding>
                      {opcoesEncontradas.map((opt, i) => (
                        <BusItem key={i} opt={opt} safeTraduzir={safeTraduzir} onClick={(e) => navegarParaMapa(opt.it, opt.horario, origemId, destinoId, opt.cat, modo, e.currentTarget.closest('.bus-item-card'))} />
                      ))}
                    </List>
                    <Button fullWidth variant="outlined" onClick={() => transicionar('voltar', () => setOpcoesEncontradas([]), { regiao: conteudoRef.current })} sx={{ mt: 2 }}>
                      Voltar para a busca
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
                        color: cores.texto2,
                        '&:hover': { color: cores.perigo },
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
                  role="button"
                  tabIndex={0}
                  aria-label="Enviar foto da carteirinha"
                  onKeyDown={ativarComTeclado(() => setModalUploadOpen(true))}
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
                        borderRadius: '20px'
                      }} 
                    />
                  ) : (
                    <div style={{
                      width: '100%',
                      minHeight: '150px',
                      backgroundColor: cores.superficie1,
                      borderRadius: '20px',
                      border: `1px dashed ${cores.superficie3}`,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '20px',
                      textAlign: 'center'
                    }}>
                      <CloudUploadIcon sx={{ fontSize: 40, color: cores.texto3 }} />
                      <Typography variant="body2" sx={{ color: cores.texto2, mt: 1 }}>
                        Faça upload da sua<br/>carteirinha do Cobalto aqui!
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
                      color: cores.link,
                      fontWeight: 500,
                      textDecoration: 'underline',
                      fontSize: '14px',
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      '&:hover': { color: cores.linkHover }
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
                <Box className="horarios-cabecalho" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
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
                        color: cores.texto2,
                        '&:hover': { color: cores.texto },
                        padding: '8px'
                      }}
                    >
                      <img 
                        src="/paradas.svg" 
                        alt="Paradas" 
                        style={{ 
                          width: '32px', 
                          height: '32px',
                          filter: 'brightness(0) invert(69%)'
                        }}
                      />
                    </IconButton>
                  </Tooltip>
                </Box>
                
                <Tabs 
                  value={tabLinha} 
                  onChange={(e, v) => trocarLinha(v)} 
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
                        <Button key={j} className="hour-btn" variant="text" onClick={(e) => navegarParaMapa(obj.it, obj.h, '', '', tabLinha, 'verificar', e.currentTarget)}>
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
                        <Button key={j} className="hour-btn-outlined" variant="text" onClick={(e) => navegarParaMapa(obj.it, obj.h, '', '', tabLinha, 'verificar', e.currentTarget)}>
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
          <div className="bottom-fixed-area aparecer">
            {modo === 'embarcar' && opcoesEncontradas.length === 0 && (
              <div className="rename-wrapper">
                <Button className="rename-btn" startIcon={<EditIcon />} onClick={() => setModalRenomearOpen(true)}>
                  Renomear paradas
                </Button>
              </div>
            )}

            <nav className="tab-bar" aria-label="Navegação principal">
              <button type="button" className={`tab-bar-item ${modo === 'embarcar' ? 'ativo' : ''}`} aria-current={modo === 'embarcar' ? 'page' : undefined} onClick={() => trocarModo('embarcar')}>
                <DirectionsBusFilledIcon aria-hidden="true" /><span>Embarque</span>
              </button>
              <button type="button" className={`tab-bar-item ${modo === 'aluno' ? 'ativo' : ''}`} aria-current={modo === 'aluno' ? 'page' : undefined} onClick={() => trocarModo('aluno')}>
                <PersonIcon aria-hidden="true" /><span>Perfil</span>
              </button>
              <button type="button" className={`tab-bar-item ${modo === 'verificar' ? 'ativo' : ''}`} aria-current={modo === 'verificar' ? 'page' : undefined} onClick={() => trocarModo('verificar')}>
                <ScheduleIcon aria-hidden="true" /><span>Horários</span>
              </button>
            </nav>
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
        open={!!alertaAtual}
        autoHideDuration={4000}
        onClose={() => fecharAlerta()}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
        sx={{ mt: 10 }}
      >
        <Alert 
          onClose={() => fecharAlerta()} 
          severity={alertaAtual?.severity || 'info'} 
          sx={{ width: '100%' }}
        >
          {alertaAtual?.message}
        </Alert>
      </Snackbar>
    </>
  );
}