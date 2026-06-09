import React, { useState, useMemo } from 'react';
import { 
  Box, Typography, Button, List, ListItem, ListItemText, 
  Select, MenuItem, FormControl, InputLabel
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import EmailIcon from '@mui/icons-material/Email';
import { nomesExtenso, traduzirSigla, getFavoritos, salvarFavoritos } from '../utils/dicionarioParadas';
import { getAuth } from 'firebase/auth';
import { db } from '../services/firebase';
import { doc, setDoc } from 'firebase/firestore';

export default function PersonalizationPage({ onVoltar, idsParadas, onApelidosSalvos }) {
  const [abaInterna, setAbaInterna] = useState('menu');
  const [favoritos, setFavoritos] = useState(getFavoritos() || []);
  const [apelidos, setApelidos] = useState(JSON.parse(localStorage.getItem("user_apelidos") || "{}"));
  const auth = getAuth();
  const usuarioLogado = auth.currentUser;

  const handleToggleFavorito = (id) => {
    const novaLista = favoritos.includes(id) 
      ? favoritos.filter(f => f !== id) 
      : [...favoritos, id];
    setFavoritos(novaLista);
  };

  const handleMudarApelidoEstado = (sigla, novoNome) => {
    setApelidos(prev => ({ ...prev, [sigla]: novoNome }));
  };

  // CORREÇÃO BUG 3: Sem reload, usando callback opcional
  const handleSalvarTodosApelidos = () => {
    localStorage.setItem("user_apelidos", JSON.stringify(apelidos));
    // Notifica o componente pai (HomePage) para recarregar os apelidos sem refresh
    if (onApelidosSalvos && typeof onApelidosSalvos === 'function') {
      onApelidosSalvos(apelidos);
    }
    setAbaInterna('menu');
  };

  const handleSalvarTodasFavoritas = async () => {
    salvarFavoritos(favoritos);
    if (usuarioLogado) {
      try {
        await setDoc(doc(db, "usuarios", usuarioLogado.uid, "favoritos", "dados"), {
          lista: favoritos
        });
      } catch (e) {
        console.error("Erro ao salvar favoritos no Firestore: ", e);
      }
    }
    setAbaInterna('menu');
  };

  const handleContatarSuporte = () => {
    window.open('mailto:?subject=Suporte%20busepel', '_blank');
  };

  const listaOrdenada = useMemo(() => {
    return [...idsParadas].sort((a, b) => {
      const aFav = favoritos.includes(a);
      const bFav = favoritos.includes(b);
      
      if (aFav && !bFav) return -1;
      if (!aFav && bFav) return 1;
      
      return traduzirSigla(a).localeCompare(traduzirSigla(b));
    });
  }, [idsParadas, favoritos]);

  return (
    <Box sx={{ 
      height: '100dvh', 
      width: '100vw',
      display: 'flex', 
      flexDirection: 'column',
      bgcolor: '#F9F9F9',
      p: 3,
      boxSizing: 'border-box'
    }}>
      
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, flexShrink: 0 }}>
        {abaInterna !== 'menu' && (
          <Button startIcon={<ArrowBackIcon />} onClick={() => setAbaInterna('menu')} sx={{ fontWeight: 'bold' }}>
            Voltar
          </Button>
        )}
        <Typography variant="h5" fontWeight="900" color="primary" sx={{ flexGrow: 1, textAlign: 'center', pr: abaInterna !== 'menu' ? 10 : 0 }}>
          {abaInterna === 'menu' && "Personalização"}
          {abaInterna === 'renomear' && "Renomear Paradas"}
          {abaInterna === 'favoritos' && "Paradas Favoritas"}
        </Typography>
      </Box>

      {abaInterna === 'menu' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, justifyContent: 'center', maxWidth: '500px', width: '100%', mx: 'auto' }}>
          <Button variant="outlined" fullWidth onClick={() => setAbaInterna('renomear')} sx={{ py: 2, fontWeight: 'bold', borderRadius: '12px' }}>
            Renomear Paradas
          </Button>
          <Button variant="outlined" fullWidth onClick={() => setAbaInterna('favoritos')} sx={{ py: 2, fontWeight: 'bold', borderRadius: '12px' }}>
            Paradas Favoritas
          </Button>
          <Button variant="outlined" fullWidth startIcon={<EmailIcon />} onClick={handleContatarSuporte} sx={{ py: 2, fontWeight: 'bold', borderRadius: '12px' }}>
            Contatar Suporte
          </Button>
          <Button startIcon={<ArrowBackIcon />} onClick={onVoltar} sx={{ mt: 4, fontWeight: 'bold' }}>
            Voltar ao Início
          </Button>
        </Box>
      )}

      {abaInterna === 'renomear' && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <List sx={{ flexGrow: 1, overflowY: 'auto', mb: 2, pr: 0.5 }}>
            {listaOrdenada.map(id => {
              const apelidoAtual = apelidos[id] || traduzirSigla(id);
              return (
                <ListItem key={id} divider sx={{ display: 'flex', justifyContent: 'between', alignItems: 'center', py: 2 }}>
                  <ListItemText 
                    primary={id.toUpperCase()} 
                    secondary={`Apelido: ${apelidoAtual}`} 
                    secondaryTypographyProps={{ style: { color: '#666', fontWeight: '500' } }}
                  />
                  <Select 
                    size="small"
                    value={apelidos[id] || id}
                    onChange={(e) => handleMudarApelidoEstado(id, e.target.value)}
                    sx={{ width: 160, fontSize: '0.8rem', borderRadius: '8px' }}
                  >
                    {nomesExtenso[id]?.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>) || <MenuItem value={id}>{id}</MenuItem>}
                  </Select>
                </ListItem>
              );
            })}
          </List>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSalvarTodosApelidos} fullWidth sx={{ py: 2, borderRadius: '12px', fontWeight: 'bold' }}>
            SALVAR ALTERAÇÕES
          </Button>
        </Box>
      )}

      {abaInterna === 'favoritos' && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <List sx={{ flexGrow: 1, overflowY: 'auto', mb: 2, pr: 0.5 }}>
            {listaOrdenada.map(id => {
              const isFav = favoritos.includes(id);
              return (
                <ListItem 
                  key={id} 
                  button 
                  onClick={() => handleToggleFavorito(id)} 
                  divider
                  sx={{ 
                    py: 2,
                    borderRadius: '8px',
                    mb: 0.5,
                    backgroundColor: isFav ? '#00418F' : 'transparent',
                    color: isFav ? '#FFFFFF' : 'inherit',
                    transition: 'background-color 0.2s',
                    '&:hover': {
                      backgroundColor: isFav ? '#003373' : '#F0F0F0'
                    }
                  }}
                >
                  <ListItemText 
                    primary={traduzirSigla(id)} 
                    primaryTypographyProps={{ style: { fontWeight: isFav ? 'bold' : 'normal' } }}
                    secondary={id.toUpperCase()}
                    secondaryTypographyProps={{ style: { color: isFav ? '#EEE' : '#888' } }}
                  />
                </ListItem>
              );
            })}
          </List>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSalvarTodasFavoritas} fullWidth sx={{ py: 2, borderRadius: '12px', fontWeight: 'bold' }}>
            SALVAR ALTERAÇÕES
          </Button>
        </Box>
      )}
    </Box>
  );
}