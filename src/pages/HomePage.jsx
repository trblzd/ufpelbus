// pages/HomePage.jsx
// PÁGINA PRINCIPAL DO APLICATIVO
// Permite buscar ônibus para embarque ou consultar horários fixos

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { useLocation } from '../hooks/useLocation';
import { traduzirSigla } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
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

// Tema global do Material-UI (consistente com o resto do app)
const theme = createTheme({
  palette: {
    primary: { main: '#00418F' },    // Azul institucional
    secondary: { main: '#0EA503' },  // Verde para sucesso
    warning: { main: '#FF8A31' },    // Laranja para avisos
    error: { main: '#C4151C' },      // Vermelho para erros
    background: { default: '#F9F9F9' },
    text: { primary: '#00418F' },
  },
  shape: { borderRadius: 16 },
});

// Paradas que não devem ser exibidas (internas ou indefinidas)
const PARADAS_IGNORADAS = ['int_', 'ponto-indefinido'];

// ==================== COMPONENTE DE ITEM DE ÔNIBUS ====================

/**
 * Componente que exibe um ônibus disponível na lista de resultados
 * Mostra horário, última posição conhecida, lotação e se é a rota mais rápida
 */
const BusItem = ({ opt, onClick, safeTraduzir }) => {
  // Estado da viagem ativa (vinda do Firebase em tempo real)
  const [viagemInfo, setViagemInfo] = useState({ lastStop: null, lotacao: null, atualizadoEm: null });
  
  /**
   * Escuta mudanças na viagem ativa em tempo real (onSnapshot)
   * Atualiza as informações do ônibus conforme ele se move
   */
  useEffect(() => {
    if (!opt?.it?.id || !opt?.horario) return;
    
    const tripId = `${opt.it.id}_${opt.horario.replace(':', '')}`;
    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) {
        setViagemInfo(d.data());
      } else {
        setViagemInfo({ lastStop: null, lotacao: null, atualizadoEm: null });
      }
    });
    
    return () => unsub();
  }, [opt]);

  /**
   * Verifica se a viagem expirou (baseado no horário de saída + duração)
   * Se expirou, as informações não são mais confiáveis
   */
  const isExpirado = useMemo(() => {
    if (!viagemInfo.atualizadoEm || !opt.it?.duracaoEstimada) return false;
    const agora = new Date();
    const dataPost = viagemInfo.atualizadoEm.toDate?.() || new Date(viagemInfo.atualizadoEm.seconds * 1000);
    return Math.floor((agora - dataPost) / 60000) > Number(opt.it.duracaoEstimada);
  }, [viagemInfo.atualizadoEm, opt.it]);

  /**
   * Formata timestamp para texto relativo (ex: "há 5 minutos")
   */
  const formatarRelativo = (timestamp) => {
    if (!timestamp) return "";
    const dataPost = timestamp.toDate?.() || new Date(timestamp.seconds * 1000);
    const difSegundos = Math.floor((Date.now() - dataPost) / 1000);
    if (difSegundos < 60) return "há menos de 1 minuto";
    return `há ${Math.floor(difSegundos / 60)} minutos`;
  };

  // Retorna emoji baseado na lotação e se está expirado
  const getEmojiLotacao = (nivel) => {
    if (isExpirado) return '🟡';  // Amarelo para expirado
    if (nivel === 'lotado') return '🔴';  // Vermelho para lotado
    if (nivel === 'medio') return '🟡';   // Amarelo para médio
    if (nivel === 'vazio') return '🟢';   // Verde para vazio
    return '🟡';
  };

  const temInformacaoAtiva = viagemInfo.lastStop && !isExpirado;

  return (
    <Paper elevation={0} sx={{ mb: 2, border: '1px solid #eee', borderRadius: '16px', overflow: 'hidden' }}>
      <ListItemButton onClick={onClick} sx={{ p: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          {/* Linha superior: Categoria + Emoji de lotação */}
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
            <Typography variant="h6" fontWeight="bold" sx={{ lineHeight: 1.2 }}>
              {opt.cat}
            </Typography>
            <Typography variant="caption" sx={{ fontSize: '0.6rem', color: '#666' }}>
              {getEmojiLotacao(viagemInfo.lotacao)}
            </Typography>
          </Box>
          
          {/* Informação de última parada conhecida */}
          <Typography variant="body2" color="secondary" fontWeight="500">
            {temInformacaoAtiva 
              ? `Visto em: ${safeTraduzir(viagemInfo.lastStop)} ${formatarRelativo(viagemInfo.atualizadoEm)}` 
              : "Sem Informações"}
          </Typography>
          
          {/* Badge de "MAIS RÁPIDO" se aplicável */}
          {opt.maisRapida && temInformacaoAtiva && (
            <Chip 
              label="MAIS RÁPIDO" 
              size="small" 
              color="secondary" 
              sx={{ fontSize: '0.6rem', height: 18, fontWeight: 'bold', mt: 0.5 }} 
            />
          )}
        </Box>
        
        {/* Horário de saída (grande e em negrito) */}
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
  
  // Dados globais do aplicativo (providos pelo AppDataContext)
  const { todosItinerarios, paradasCoordenadas, idsParadasUnicas, favoritos, loading: appLoading } = useAppData();
  
  // ==================== ESTADOS ====================
  const [gpsAtivo, setGpsAtivo] = useState(true);              // Controla se o GPS está ativo
  const { position } = useLocation({ ativo: gpsAtivo });       // Posição atual do usuário
  const jaPreencheuParadaRef = useRef(false);                  // Evita preencher origem múltiplas vezes
  const [modo, setModo] = useState('embarcar');                // 'embarcar' ou 'verificar'
  const [tabLinha, setTabLinha] = useState('Anglo');           // Aba selecionada (Anglo, Capão, etc.)
  const [origemId, setOrigemId] = useState('');                // ID da parada de origem selecionada
  const [destinoId, setDestinoId] = useState('');              // ID da parada de destino selecionada
  const [opcoesEncontradas, setOpcoesEncontradas] = useState([]); // Ônibus disponíveis encontrados
  
  const auth = getAuth();

  // ==================== CONFIGURAÇÃO DE CATEGORIAS ====================
  // Mapeamento de nomes amigáveis para IDs de itinerários
  const categoriesConfig = {
    Anglo: ['anglo', 'anglo21', 'anglo2145', 'anglo730', 'anglo8', 'angloru'],
    Capão: ['anglocapao', 'capaoanglo', 'capaodireito', 'capaodireitobr', 'capaofamedanglo', 'capaolyceu', 'cotadacapao', 'direitocapao', 'famedcapao', 'lyceucapao'],
    ESEF: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira7', 'madeireira9'],
    FaMed: ['madeireira11', 'madeireira13', 'madeireira15', 'madeireira16', 'madeireira18', 'madeireira1820', 'madeireira20', 'madeireira21', 'madeireira22', 'madeireira7', 'madeireira9', 'anglofamed', 'anglocapao', 'capaofamedanglo', 'cotadacapao', 'direitocapao', 'lyceucapao'],
    Madeireira: ['anglru', 'anglo21', 'madeireira7', 'madeireira9', 'madeireira11', 'madeireira15', 'madeireira16'],
    Palma: ['palmacp', 'palmapm']
  };

  // ==================== FUNÇÕES AUXILIARES ====================
  
  /**
   * Traduz uma sigla de parada para nome amigável
   * Suporta tanto string quanto objeto { nome: "..." }
   */
  const safeTraduzir = (valor) => {
    if (!valor) return "---";
    const siglaStr = typeof valor === 'object' ? valor.nome : valor;
    return traduzirSigla(siglaStr.toString());
  };

  /**
   * Normaliza o nome de uma parada para comparação (lowercase + trim)
   */
  const normalizarNome = (p) => {
    return (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim();
  };

  /**
   * Faz logout do Firebase
   */
  const handleFirebaseLogout = async () => { 
    await signOut(auth); 
    if (onLogout) onLogout(); 
  };

  /**
   * Reativa o GPS e limpa a origem selecionada
   */
  const handleReativarGPS = () => { 
    setGpsAtivo(true); 
    jaPreencheuParadaRef.current = false; 
    setOrigemId(''); 
  };

  /**
   * Navega para a página do mapa (MainPage) com os parâmetros da viagem
   */
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
  
  /**
   * Gerencia o GPS: desliga automaticamente após detectar a parada de origem
   * Economiza bateria após encontrar a localização
   */
  useEffect(() => {
    // Se já temos uma origem e o GPS está ativo, desliga após 3 segundos
    if (origemId && origemId !== '' && gpsAtivo && !jaPreencheuParadaRef.current) {
      jaPreencheuParadaRef.current = true;
      setTimeout(() => setGpsAtivo(false), 3000);
    }
    
    // Se não tem origem e o GPS está desligado, reativa
    if ((!origemId || origemId === '') && !gpsAtivo) { 
      setGpsAtivo(true); 
      jaPreencheuParadaRef.current = false; 
    }
  }, [origemId, gpsAtivo]);

  /**
   * Detecta a parada mais próxima da localização atual do usuário
   * Preenche automaticamente o campo "Subir em"
   */
  useEffect(() => {
    if (!gpsAtivo) return;
    
    if (position && position.lat && position.lng && 
        Object.keys(paradasCoordenadas).length > 0 && 
        idsParadasUnicas.length > 0) {
      
      let menorDist = Infinity;
      let paradaVencedora = '';
      
      // Calcula distância para cada parada e encontra a mais próxima
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

  /**
   * Agrupa horários por rota e destino (para o modo "verificar")
   * Separa também rotas que passam pelo RU (Restaurante Universitário)
   */
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
      
      // Define o label da rota (tratamento especial para ESEF e FaMed)
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
    
    // Ordena os grupos e horários
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

  /**
   * Busca ônibus disponíveis baseado na origem, destino e horário atual
   * Retorna apenas viagens que ainda não expiraram
   */
  const handleBusca = () => {
    if (!origemId || !destinoId) return;
    
    const ori = origemId.toLowerCase().trim();
    const des = destinoId.toLowerCase().trim();
    const agora = new Date();
    const tempoAtualMin = agora.getHours() * 60 + agora.getMinutes();
    
    const matches = [];
    
    for (const it of todosItinerarios) {
      if (!it.paradas || !Array.isArray(it.paradas)) continue;
      
      const paradas = it.paradas.map(normalizarNome);
      const idxO = paradas.indexOf(ori);
      const idxD = paradas.indexOf(des, idxO);
      
      // Verifica se o itinerário passa pela origem E destino (na ordem correta)
      if (idxO !== -1 && idxD !== -1 && idxO < idxD) {
        if (!it.horariosaida || !Array.isArray(it.horariosaida)) continue;
        
        for (const horario of it.horariosaida) {
          const [h, m] = horario.split(':').map(Number);
          const tempoSaidaMin = h * 60 + m;
          const duracao = Number(it.duracaoEstimada) || 60;
          const tempoExpiracao = tempoSaidaMin + duracao + 15;
          
          // Filtra apenas viagens que ainda não expiraram
          if (tempoAtualMin > tempoExpiracao) continue;
          
          // Verifica se o horário é viável (considerando o tempo até a origem)
          if (tempoSaidaMin + (idxO * 1.5) >= tempoAtualMin - 20) {
            matches.push({ 
              it, 
              horario, 
              numParadas: idxD - idxO, 
              tempoRef: tempoSaidaMin, 
              cat: Object.keys(categoriesConfig).find(c => categoriesConfig[c].includes(it.id)) || "Rota" 
            });
          }
        }
      }
    }
    
    if (matches.length > 0) {
      // Marca a rota com menos paradas como "mais rápida"
      const minP = Math.min(...matches.map(m => m.numParadas));
      setOpcoesEncontradas(
        matches
          .sort((a, b) => a.tempoRef - b.tempoRef)
          .map(m => ({ ...m, maisRapida: m.numParadas === minP }))
          .slice(0, 8)  // Limita a 8 resultados
      );
    } else {
      setOpcoesEncontradas([]);
    }
  };

  // ==================== RENDERIZAÇÃO ====================
  
  // Tela de loading enquanto aguarda dados ou localização
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
          
          {/* HEADER - Logo do aplicativo */}
          <Typography variant="h4" fontWeight="900" color="primary" sx={{ mb: 2, textAlign: 'center', flexShrink: 0 }}>
            busepel
          </Typography>
          
          {/* TOGGLE entre modo "embarcar" e "verificar" */}
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
          
          {/* CONTEÚDO PRINCIPAL (com scroll) */}
          <Box sx={{ flexGrow: 1, overflowY: 'auto', pr: 0.5, display: 'flex', flexDirection: 'column' }}>
            
            {/* MODO EMBARCAR - Busca de ônibus para viagem */}
            {modo === 'embarcar' && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, justifyContent: 'center' }}>
                {opcoesEncontradas.length === 0 ? (
                  <>
                    {/* SELECT de origem com GPS integrado */}
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
                    
                    {/* SELECT de destino */}
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
                    
                    {/* BOTÃO de busca */}
                    <Button 
                      fullWidth 
                      variant="contained" 
                      onClick={handleBusca} 
                      sx={{ py: 2, fontWeight: 'bold', borderRadius: '12px' }}
                    >
                      VERIFICAR ÔNIBUS DISPONÍVEIS
                    </Button>
                  </>
                ) : (
                  /* LISTA de ônibus encontrados */
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
            
            {/* MODO VERIFICAR - Exibe horários fixos por categoria */}
            {modo === 'verificar' && (
              <Box>
                {/* TABS de categorias */}
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
                
                {/* GRUPOS que passam pelo RU (destacados em laranja) */}
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
                
                {/* GRUPOS normais (não passam pelo RU) */}
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
          
          {/* RODAPÉ - Botões de personalização e logout */}
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