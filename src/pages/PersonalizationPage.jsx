// pages/PersonalizationPage.jsx
// PÁGINA DE PERSONALIZAÇÃO
// Permite ao usuário renomear paradas e marcar favoritos

import React, { useState, useMemo, useEffect } from 'react';
import { Box, Typography, Button, List, ListItem, Select, MenuItem } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SaveIcon from '@mui/icons-material/Save';
import EmailIcon from '@mui/icons-material/Email';
import { traduzirSigla, nomesExtenso } from '../utils/dicionarioParadas';
import { getFavoritos, toggleFavorito } from '../services/favoritosService';
import { getAllApelidos, setMultiplosApelidos, subscribeApelidos } from '../services/apelidosService';

// ==================== CONSTANTES ====================

// Paradas que não devem ser exibidas para personalização (internas ou indefinidas)
const PARADAS_IGNORADAS = ['int_', 'ponto-indefinido'];

/**
 * Verifica se uma parada é válida para personalização
 * Filtra paradas internas (int_) e indefinidas
 */
const isParadaValida = (id) => {
  if (!id || typeof id !== 'string') return false;
  return !PARADAS_IGNORADAS.some(p => id.startsWith(p) || id === p);
};

// ==================== COMPONENTE PRINCIPAL ====================

export default function PersonalizationPage({ onVoltar, idsParadas, onApelidosSalvos }) {
  // ==================== ESTADOS ====================
  const [abaInterna, setAbaInterna] = useState('menu');     // 'menu', 'renomear', ou 'favoritos'
  const [favoritos, setFavoritos] = useState([]);           // Lista de IDs de paradas favoritas
  const [apelidos, setApelidos] = useState({});             // Mapeamento: sigla -> nome personalizado

  // ==================== EFEITOS ====================
  
  /**
   * Carrega os dados iniciais:
   * - Favoritos do usuário (do Firestore + localStorage)
   * - Apelidos salvos (do localStorage)
   * - Inscreve-se para mudanças em tempo real nos apelidos
   */
  useEffect(() => {
    const carregar = async () => {
      const favs = await getFavoritos();           // Busca favoritos (Firestore + fallback localStorage)
      setFavoritos(favs);
      setApelidos(getAllApelidos());               // Busca apelidos salvos
    };
    
    carregar();
    
    // Escuta mudanças nos apelidos (outras abas/janelas)
    const unsubApelidos = subscribeApelidos((novosApelidos) => {
      setApelidos(novosApelidos);
    });
    
    return () => unsubApelidos();
  }, []);

  // ==================== FUNÇÕES ====================
  
  /**
   * Alterna o status de favorito de uma parada
   * Adiciona se não estiver, remove se já estiver
   */
  const handleToggleFavorito = async (id) => {
    const novaLista = await toggleFavorito(id);
    setFavoritos(novaLista);
  };

  /**
   * Atualiza o estado local do apelido (antes de salvar)
   * O salvamento só ocorre quando o usuário clica em "SALVAR ALTERAÇÕES"
   */
  const handleMudarApelidoEstado = (sigla, novoNome) => {
    setApelidos(prev => ({ ...prev, [sigla]: novoNome }));
  };

  /**
   * Salva TODOS os apelidos no localStorage e sincroniza
   */
  const handleSalvarTodosApelidos = () => {
    setMultiplosApelidos(apelidos);  // Salva no localStorage e notifica ouvintes
    
    // Callback opcional para o componente pai
    if (onApelidosSalvos && typeof onApelidosSalvos === 'function') {
      onApelidosSalvos(apelidos);
    }
    
    setAbaInterna('menu');  // Volta ao menu principal
  };

  /**
   * Salva as alterações de favoritos (apenas fecha a tela)
   * Os favoritos já foram salvos individualmente em handleToggleFavorito
   */
  const handleSalvarTodasFavoritas = async () => {
    setAbaInterna('menu');  // Apenas fecha a tela, dados já salvos
  };

  /**
   * Abre o cliente de email com o endereço de suporte
   */
  const handleContatarSuporte = () => {
    window.open('mailto:suporte@busepel.com?subject=Suporte%20busepel', '_blank');
  };

  /**
   * Obtém as opções disponíveis para renomear uma parada
   * Prioriza nomes do dicionário nomesExtenso, depois fallback
   */
  const getOpcoesRenomear = (sigla) => {
    const siglaLimpa = sigla.toLowerCase().trim();
    const opcoes = nomesExtenso[siglaLimpa];
    
    if (opcoes && opcoes.length > 0) {
      return opcoes;  // Retorna lista de nomes sugeridos do dicionário
    }
    
    // Fallback: tradução padrão, sigla em maiúsculo, sigla em minúsculo
    return [traduzirSigla(sigla), sigla.toUpperCase(), sigla.toLowerCase()];
  };

  // ==================== MEMOS (FILTRAGEM E ORDENAÇÃO) ====================
  
  /**
   * Filtra apenas paradas válidas (remove int_ e ponto-indefinido)
   */
  const listaFiltrada = useMemo(() => {
    return idsParadas.filter(isParadaValida);
  }, [idsParadas]);

  /**
   * Ordena a lista de paradas:
   * 1. Favoritas primeiro
   * 2. Depois em ordem alfabética pelo nome traduzido
   */
  const listaOrdenada = useMemo(() => {
    return [...listaFiltrada].sort((a, b) => {
      const aFav = favoritos.includes(a);
      const bFav = favoritos.includes(b);
      
      if (aFav && !bFav) return -1;  // A é favorito, B não → A vem primeiro
      if (!aFav && bFav) return 1;   // B é favorito, A não → B vem primeiro
      
      // Ambos favoritos ou ambos não favoritos → ordena por nome traduzido
      return traduzirSigla(a).localeCompare(traduzirSigla(b));
    });
  }, [listaFiltrada, favoritos]);

  // ==================== RENDERIZAÇÃO ====================
  
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
      
      {/* HEADER COM NAVEGAÇÃO */}
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
      
      {/* ==================== MENU PRINCIPAL ==================== */}
      {abaInterna === 'menu' && (
        <Box sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: 2, 
          flexGrow: 1, 
          justifyContent: 'center', 
          maxWidth: '500px', 
          width: '100%', 
          mx: 'auto' 
        }}>
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
      
      {/* ==================== ABA RENOMEAR PARADAS ==================== */}
      {abaInterna === 'renomear' && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* LISTA COM SCROLL de todas as paradas */}
          <List sx={{ flexGrow: 1, overflowY: 'auto', mb: 2, pr: 0.5 }}>
            {listaOrdenada.map(id => {
              const apelidoAtual = apelidos[id] || traduzirSigla(id);
              const opcoes = getOpcoesRenomear(id);
              
              return (
                <ListItem key={id} divider sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 2, flexWrap: 'wrap', gap: 1 }}>
                  {/* Informação da parada */}
                  <Box sx={{ flex: 1, minWidth: '120px' }}>
                    <Typography variant="body2" fontWeight="bold">{id.toUpperCase()}</Typography>
                    <Typography variant="caption" color="textSecondary">
                      Apelido atual: {apelidoAtual}
                    </Typography>
                  </Box>
                  
                  {/* SELECT para escolher novo nome */}
                  <Select 
                    size="small"
                    value={apelidos[id] || traduzirSigla(id)}
                    onChange={(e) => handleMudarApelidoEstado(id, e.target.value)}
                    sx={{ width: 200, fontSize: '0.8rem', borderRadius: '8px' }}
                  >
                    {opcoes.map(opt => (
                      <MenuItem key={opt} value={opt}>
                        {opt}
                      </MenuItem>
                    ))}
                  </Select>
                </ListItem>
              );
            })}
          </List>
          
          {/* BOTÃO SALVAR */}
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSalvarTodosApelidos} fullWidth sx={{ py: 2, borderRadius: '12px', fontWeight: 'bold' }}>
            SALVAR ALTERAÇÕES
          </Button>
        </Box>
      )}
      
      {/* ==================== ABA PARADAS FAVORITAS ==================== */}
      {abaInterna === 'favoritos' && (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          
          {/* LISTA COM SCROLL - Clique no item para toggle favorito */}
          <List sx={{ flexGrow: 1, overflowY: 'auto', mb: 2, pr: 0.5 }}>
            {listaOrdenada.map(id => {
              const isFav = favoritos.includes(id);
              
              return (
                <ListItem 
                  key={id} 
                  onClick={() => handleToggleFavorito(id)} 
                  divider 
                  sx={{ 
                    py: 2, 
                    borderRadius: '8px', 
                    mb: 0.5, 
                    cursor: 'pointer',
                    backgroundColor: isFav ? '#00418F' : 'transparent',  // Azul se favorito
                    color: isFav ? '#FFFFFF' : 'inherit',
                    transition: 'background-color 0.2s',
                    '&:hover': { 
                      backgroundColor: isFav ? '#003373' : '#F0F0F0' 
                    }
                  }}
                >
                  <Box>
                    <Typography variant="body2" fontWeight={isFav ? 'bold' : 'normal'} color={isFav ? 'white' : 'inherit'}>
                      {traduzirSigla(id)}
                    </Typography>
                    <Typography variant="caption" color={isFav ? '#EEE' : '#888'}>
                      {id.toUpperCase()}
                    </Typography>
                  </Box>
                </ListItem>
              );
            })}
          </List>
          
          {/* BOTÃO SALVAR (apenas fecha a tela) */}
          <Button variant="contained" startIcon={<SaveIcon />} onClick={handleSalvarTodasFavoritas} fullWidth sx={{ py: 2, borderRadius: '12px', fontWeight: 'bold' }}>
            SALVAR ALTERAÇÕES
          </Button>
        </Box>
      )}
    </Box>
  );
}