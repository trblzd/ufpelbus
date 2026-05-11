import React, { useState } from 'react';
import { 
  Box, Typography, Button, List, ListItem, ListItemText, 
  IconButton, Select, MenuItem, Checkbox, ListItemSecondaryAction, Divider 
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import { nomesExtenso, traduzirSigla, getFavoritos, salvarFavoritos } from '../utils/dicionarioParadas';

export default function PersonalizationPage({ onVoltar, idsParadas }) {
  const [abaInterna, setAbaInterna] = useState('menu'); // 'menu', 'renomear', 'favoritos'
  const [favoritos, setFavoritos] = useState(getFavoritos());
  const [apelidos, setApelidos] = useState(JSON.parse(localStorage.getItem("user_apelidos") || "{}"));

  const handleToggleFavorito = (id) => {
    const novaLista = favoritos.includes(id) 
      ? favoritos.filter(f => f !== id) 
      : [...favoritos, id];
    setFavoritos(novaLista);
  };

  const handleSalvarApelido = (sigla, novoNome) => {
    const novosApelidos = { ...apelidos, [sigla]: novoNome };
    setApelidos(novosApelidos);
    localStorage.setItem("user_apelidos", JSON.stringify(novosApelidos));
  };

  const handleFinalizarFavoritos = () => {
    salvarFavoritos(favoritos);
    setAbaInterna('menu');
  };

  // Ordenação: Favoritos no topo, depois Alfabética
  const listaOrdenada = [...idsParadas].sort((a, b) => {
    const aFav = favoritos.includes(a);
    const bFav = favoritos.includes(b);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return traduzirSigla(a).localeCompare(traduzirSigla(b));
  });

  return (
    <Box sx={{ 
      height: '100%', 
      display: 'flex', 
      flexDirection: 'column', 
      justifyContent: abaInterna === 'menu' ? 'center' : 'flex-start' 
    }}>
      {abaInterna === 'menu' && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
          <Typography variant="h5" fontWeight="900" color="primary" sx={{ mb: 4 }}>Personalização</Typography>
          <Button variant="outlined" fullWidth onClick={() => setAbaInterna('renomear')} sx={{ py: 2 }}>Renomear Paradas</Button>
          <Button variant="outlined" fullWidth onClick={() => setAbaInterna('favoritos')} sx={{ py: 2 }}>Selecionar Favoritas</Button>
          <Button startIcon={<ArrowBackIcon />} onClick={onVoltar} sx={{ mt: 4, fontWeight: 'bold' }}>Voltar</Button>
        </Box>
      )}

      {abaInterna === 'renomear' && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="h6" fontWeight="bold" sx={{ mb: 2, textAlign: 'center' }}>Renomear Paradas</Typography>
          <List sx={{ flexGrow: 1, overflowY: 'auto', mb: 2 }}>
            {listaOrdenada.map(id => (
              <ListItem key={id} divider>
                <ListItemText primary={`Trocar nome de: ${id.toUpperCase()}`} secondary={`Atual: ${traduzirSigla(id)}`} />
                <Select 
                  size="small"
                  value={apelidos[id] || id}
                  onChange={(e) => handleSalvarApelido(id, e.target.value)}
                  sx={{ width: 150, fontSize: '0.8rem' }}
                >
                  {nomesExtenso[id]?.map(n => <MenuItem key={n} value={n}>{n}</MenuItem>) || <MenuItem value={id}>{id}</MenuItem>}
                </Select>
              </ListItem>
            ))}
          </List>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={() => setAbaInterna('menu')} fullWidth sx={{ py: 2 }}>SALVAR E VOLTAR</Button>
        </Box>
      )}

      {abaInterna === 'favoritos' && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <Typography variant="h6" fontWeight="bold" sx={{ mb: 2, textAlign: 'center' }}>Paradas Favoritas</Typography>
          <List sx={{ flexGrow: 1, overflowY: 'auto', mb: 2 }}>
            {listaOrdenada.map(id => (
              <ListItem key={id} button onClick={() => handleToggleFavorito(id)} divider>
                <Checkbox checked={favoritos.includes(id)} />
                <ListItemText primary={traduzirSigla(id)} />
              </ListItem>
            ))}
          </List>
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleFinalizarFavoritos} fullWidth sx={{ py: 2 }}>SALVAR FAVORITOS</Button>
        </Box>
      )}
    </Box>
  );
}