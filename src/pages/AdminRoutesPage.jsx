// pages/AdminRoutesPage.jsx
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../services/firebase';
import { collection, getDocs, doc, getDoc } from 'firebase/firestore';
import {
  Box,
  Container,
  Typography,
  Paper,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Chip,
  IconButton,
  CircularProgress,
  TextField,
  InputAdornment,
  Stack,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import MapIcon from '@mui/icons-material/Map';
import SearchIcon from '@mui/icons-material/Search';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

// Função auxiliar para extrair nome da parada
const extrairNomeParada = (parada) => {
  if (!parada) return null;
  if (typeof parada === 'string') return parada;
  if (typeof parada === 'object' && parada.nome) return parada.nome;
  return null;
};

export default function AdminRoutesPage() {
  const navigate = useNavigate();
  const [itinerarios, setItinerarios] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [rotasStatus, setRotasStatus] = useState({});

  useEffect(() => {
    const carregarItinerarios = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(db, "itinerarios"));
        const lista = [];
        for (const docSnap of snap.docs) {
          const dados = docSnap.data();
          lista.push({
            id: docSnap.id,
            ...dados,
            paradasCount: dados.paradas?.length || 0
          });
        }
        setItinerarios(lista);
        await verificarStatusRotas(lista);
      } catch (error) {
        console.error("Erro ao carregar itinerários:", error);
      } finally {
        setLoading(false);
      }
    };
    
    carregarItinerarios();
  }, []);
  
  const verificarStatusRotas = async (itinerariosList) => {
    const status = {};
    
    for (const it of itinerariosList) {
      if (!it.paradas) continue;
      
      const paradasLista = it.paradas.map(p => {
        const nome = extrairNomeParada(p);
        return nome?.toLowerCase().trim() || '';
      }).filter(n => n);
      
      let completos = 0;
      let total = Math.max(0, paradasLista.length - 1);
      
      for (let i = 0; i < paradasLista.length - 1; i++) {
        const docId = `${it.id}_${paradasLista[i]}-${paradasLista[i + 1]}`;
        try {
          const docSnap = await getDoc(doc(db, "rotas_geometricas", docId));
          if (docSnap.exists() && docSnap.data().geometria?.length >= 2) {
            completos++;
          }
        } catch (err) {
          console.error(`Erro ao verificar ${docId}:`, err);
        }
      }
      
      status[it.id] = { 
        completos, 
        total, 
        percentual: total > 0 ? (completos / total) * 100 : 0 
      };
    }
    
    setRotasStatus(status);
  };
  
  const filteredItinerarios = itinerarios.filter(it => 
    it.id?.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  if (loading) {
    return (
      <Box sx={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }
  
  return (
    <Box sx={{ minHeight: '100vh', bgcolor: '#E2E8F0', p: 3 }}>
      <Container maxWidth="md">
        <Paper sx={{ p: 3, borderRadius: 3, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', maxHeight: 'calc(100vh - 48px)' }}>
          <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 3, flexShrink: 0 }}>
            <IconButton onClick={() => navigate('/')}>
              <ArrowBackIcon />
            </IconButton>
            <Typography variant="h5" fontWeight="bold" color="primary" sx={{ flexGrow: 1 }}>
              Editor de Rotas
            </Typography>
          </Stack>
          
          <Typography variant="body2" color="textSecondary" sx={{ mb: 3, flexShrink: 0 }}>
            Selecione um itinerário para desenhar ou editar suas rotas no mapa.
            Cada trecho entre paradas pode ter sua própria geometria personalizada.
          </Typography>
          
          <TextField
            fullWidth
            size="small"
            placeholder="Buscar itinerário..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ mb: 3, flexShrink: 0 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }
            }}
          />
          
          {/* LISTA COM SCROLL - CORREÇÃO AQUI */}
          <Box sx={{ 
            flex: 1, 
            overflowY: 'auto', 
            overflowX: 'hidden',
            minHeight: 0,
            mb: 3
          }}>
            <List>
              {filteredItinerarios.map((it) => {
                const status = rotasStatus[it.id] || { completos: 0, total: 0, percentual: 0 };
                const isComplete = status.percentual === 100;
                const hasSome = status.completos > 0;
                
                return (
                  <ListItem
                    key={it.id}
                    disablePadding
                    secondaryAction={
                      <IconButton
                        edge="end"
                        onClick={() => navigate(`/admin/rotas/editar/${it.id}`)}
                        color="primary"
                      >
                        <EditIcon />
                      </IconButton>
                    }
                  >
                    <ListItemButton onClick={() => navigate(`/admin/rotas/editar/${it.id}`)}>
                      <ListItemText
                        primary={
                          <Stack direction="row" alignItems="center" spacing={1}>
                            <Typography variant="subtitle1" fontWeight="bold">
                              {it.id.toUpperCase()}
                            </Typography>
                            {isComplete ? (
                              <Chip size="small" icon={<CheckCircleIcon />} label="Completo" color="success" />
                            ) : hasSome ? (
                              <Chip size="small" label={`${Math.round(status.percentual)}%`} color="warning" />
                            ) : (
                              <Chip size="small" icon={<ErrorIcon />} label="Sem rotas" color="default" />
                            )}
                          </Stack>
                        }
                        secondary={`${it.paradasCount} paradas | ${status.completos}/${status.total} trechos com rota`}
                        secondaryTypographyProps={{ variant: 'caption' }}
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
            
            {filteredItinerarios.length === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Nenhum itinerário encontrado.
              </Alert>
            )}
          </Box>
          
          <Box sx={{ p: 2, bgcolor: '#f5f5f5', borderRadius: 2, flexShrink: 0 }}>
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
              Instruções:
            </Typography>
            <Typography variant="caption" color="textSecondary" component="div">
              1. Selecione um itinerário para começar
              <br />
              2. Escolha um trecho na barra lateral
              <br />
              3. Ative o modo "Desenhar" e clique no mapa para criar a rota
              <br />
              4. Use os botões de desfazer/refazer para ajustar
              <br />
              5. Clique em "Salvar Rota" para salvar no Firebase
              <br />
              <br />
              <strong>Dica:</strong> As rotas serão carregadas automaticamente no aplicativo principal!
            </Typography>
          </Box>
          
          <Button
            variant="outlined"
            startIcon={<MapIcon />}
            onClick={() => navigate('/')}
            fullWidth
            sx={{ mt: 2, flexShrink: 0 }}
          >
            Voltar para o App
          </Button>
        </Paper>
      </Container>
    </Box>
  );
}