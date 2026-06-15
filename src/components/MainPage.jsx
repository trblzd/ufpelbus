// components/MainPage.jsx
// COMPONENTE PRINCIPAL DE VIAGEM - Gerencia embarque, rastreamento e visualização da rota

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Polyline, Popup } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, serverTimestamp, onSnapshot, deleteDoc, updateDoc, arrayUnion, getDoc } from 'firebase/firestore';
import { Box, Button, Typography, Paper, CircularProgress, Stack, Chip, IconButton, Snackbar, Alert, LinearProgress } from '@mui/material';
import { traduzirSigla } from '../utils/dicionarioParadas';
import { calculateDistance } from '../utils/geoUtils';
import { useLocation as useGeoLocation } from '../hooks/useLocation';
import { useRastreamento } from '../hooks/useRastreamento';
import { entrarNaViagem } from '../services/transporteService';
import { usePersistViagem } from '../hooks/usePersistViagem';
import { useEmbarqueAutomatico } from '../hooks/useEmbarqueAutomatico';
import { usePageVisibility } from '../hooks/usePageVisibility';
// usePreventNavigation REMOVIDO - não utilizado, causava erro de importação
import { getAuth } from 'firebase/auth';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import DirectionsBusIcon from '@mui/icons-material/DirectionsBus';
import 'leaflet/dist/leaflet.css';

// ==================== CONSTANTES E CONFIGURAÇÕES ====================

// Ícone personalizado para a parada de embarque (vermelho)
const iconEmbarque = new L.Icon({ 
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png', 
  iconSize: [25, 41], 
  iconAnchor: [12, 41], 
  popupAnchor: [1, -34]
});

// Ícone para paradas intermediárias (círculo azul com borda)
const iconIntermediario = new L.DivIcon({ 
  className: 'custom-stop-icon', 
  html: `<div style="background-color: white; width: 14px; height: 14px; border-radius: 50%; border: 3px solid #154370;"></div>`, 
  iconSize: [14, 14], 
  iconAnchor: [7, 7] 
});

const TEMPO_CONFIRMACAO_MS = 5000; // Tempo de confirmação para embarque automático (5 segundos)

/**
 * Calcula o tempo restante para o usuário chegar ao seu destino
 * Baseado na posição atual do ônibus e nos tempos médios de cada trecho
 */
const calcularMinutosRestantes = (viagemAtiva, itinerario, rotasAprendidas, minhaParada) => {
  if (!viagemAtiva || !rotasAprendidas || !minhaParada || !itinerario) return null;
  
  // Normaliza os nomes das paradas para comparação
  const paradas = itinerario.paradas.map(p => (typeof p === 'object' ? p.nome : p).toLowerCase().trim());
  const idxOnibus = viagemAtiva.indiceParada ?? 0; // Índice da última parada do ônibus
  const idxUsuario = paradas.indexOf(minhaParada.toLowerCase().trim()); // Índice do destino do usuário
  
  if (idxOnibus === -1 || idxUsuario === -1) return null;
  if (idxOnibus >= idxUsuario) return 0; // Já passou do destino
  
  // Soma os tempos médios de todos os trechos entre a posição do ônibus e o destino
  let segundosSomados = 0;
  let trechosPercorridos = [];
  
  for (let i = idxOnibus; i < idxUsuario; i++) {
    const chaveTrecho = `${itinerario.id}_${paradas[i]}-${paradas[i+1]}`;
    const dadosTrecho = rotasAprendidas[chaveTrecho];
    const tempoTrecho = dadosTrecho?.tempoMedioSegundos ?? 180; // 180 segundos = 3 minutos (fallback)
    segundosSomados += tempoTrecho;
    trechosPercorridos.push({ de: paradas[i], para: paradas[i+1], tempo: tempoTrecho });
  }
  
  return { 
    minutos: Math.ceil(segundosSomados / 60), 
    segundos: segundosSomados, 
    detalhes: trechosPercorridos 
  };
};

// ==================== COMPONENTE PRINCIPAL ====================

export default function MainPage({ 
  itinerario,      // Dados do itinerário (paradas, duração, etc.)
  horario,         // Horário de saída do ônibus
  origem,          // Parada onde o usuário vai embarcar
  destino,         // Parada onde o usuário vai desembarcar
  modoApenasConsulta, // Se true, apenas visualização de horários (sem interação)
  voltar,          // Função para voltar à tela anterior
  categoria        // Categoria da rota (Anglo, Capão, etc.)
}) {
  const navigate = useNavigate();
  const { position } = useGeoLocation({ ativo: true }); // Posição GPS do usuário
  const auth = getAuth();
  const isPageVisible = usePageVisibility(); // Detecta se a aba está visível (para reconexão)
  
  // ==================== ESTADOS LOCAIS ====================
  const [reconectando, setReconectando] = useState(false);
  const ultimaReconexaoRef = useRef(0);
  const [embarqueAutomaticoAtivo, setEmbarqueAutomaticoAtivo] = useState(true);

  // Estados persistentes (salvos em sessionStorage para recuperar após refresh)
  const [statusFluxoPersistido, setStatusFluxoPersistido, clearStatusFluxo] = usePersistViagem('statusFluxo', 'inicial');
  const [isRastreadorPersistido, setIsRastreadorPersistido, clearIsRastreador] = usePersistViagem('isRastreador', false);
  const [viagemIdPersistida, setViagemIdPersistida, clearViagemId] = usePersistViagem('viagemId', null);
  const [gpsPassageiroAtivoPersistido, setGpsPassageiroAtivoPersistido, clearGpsPassageiro] = usePersistViagem('gpsPassageiroAtivo', false);

  // Estados de dados da viagem
  const [paradasData, setParadasData] = useState({});        // Dados de todas as paradas (coordenadas, etc.)
  const [loading, setLoading] = useState(true);               // Loading inicial
  const [viagemAtiva, setViagemAtiva] = useState(null);       // Dados da viagem ativa no Firebase
  const [distanciaAteParada, setDistanciaAteParada] = useState(null); // Distância do usuário até a parada de origem
  const [rotasAprendidas, setRotasAprendidas] = useState({}); // Tempos médios de cada trecho (aprendizado)
  const [geometriaRotas, setGeometriaRotas] = useState({});   // Geometria das rotas (GPX) para desenho no mapa
  const [alertaMsg, setAlertaMsg] = useState(null);           // Mensagens de alerta (Snackbar)
  const [estimativaTempoReal, setEstimativaTempoReal] = useState(null); // Tempo estimado até o destino
  const [embarcando, setEmbarcando] = useState(false);        // Previne múltiplos cliques no botão de embarque

  const snackbarTimerRef = useRef(null);
  const intervalEstimativaRef = useRef(null);
  
  // ID único da viagem (combinação do itinerário + horário)
  const tripId = `${itinerario?.id}_${horario?.replace(':', '')}`;

  // ==================== WRAPPERS DOS ESTADOS PERSISTENTES ====================
  // Permitem limpar os dados persistentes quando a viagem termina
  const statusFluxo = statusFluxoPersistido;
  const setStatusFluxo = useCallback((value) => {
    if (value === 'expulso' || value === 'inicial') {
      clearStatusFluxo();
      clearIsRastreador();
      clearViagemId();
      clearGpsPassageiro();
    }
    setStatusFluxoPersistido(value);
  }, [clearStatusFluxo, clearIsRastreador, clearViagemId, clearGpsPassageiro, setStatusFluxoPersistido]);
  
  const isRastreador = isRastreadorPersistido;
  const setIsRastreador = useCallback((value) => setIsRastreadorPersistido(value), [setIsRastreadorPersistido]);
  const gpsPassageiroAtivo = gpsPassageiroAtivoPersistido;
  const setGpsPassageiroAtivo = useCallback((value) => setGpsPassageiroAtivoPersistido(value), [setGpsPassageiroAtivoPersistido]);

  // ==================== FUNÇÕES AUXILIARES ====================
  
  /**
   * Obtém as coordenadas [lat, lng] de uma parada a partir do ID/nome
   * Normaliza as coordenadas para valores negativos (correção para Pelotas/RS)
   */
  const getCoords = useCallback((idRaw) => {
    if (!idRaw) return null;
    const id = (typeof idRaw === 'object' ? idRaw.nome : idRaw).toString().toLowerCase().trim();
    const info = paradasData[id];
    if (info?.location) {
      let lat = Number(info.location.latitude || info.location._lat);
      let lng = Number(info.location.longitude || info.location._long);
      // Pelotas está no hemisfério sul (latitudes negativas) e oeste (longitudes negativas)
      return [lat > 0 ? lat * -1 : lat, lng > 0 ? lng * -1 : lng];
    }
    return null;
  }, [paradasData]);

  // Coordenadas da parada de origem (onde o usuário vai embarcar)
  const coordsParadaOrigem = useMemo(() => {
    if (!origem || !paradasData) return null;
    return getCoords(origem);
  }, [origem, paradasData, getCoords]);

  // ==================== FUNÇÃO DE EMBARQUE ====================
  
  /**
   * Confirma o embarque do usuário no ônibus
   * Cria/atualiza a viagem ativa no Firebase e determina o papel do usuário:
   * - rastreador: primeiro a embarcar (responsável por enviar GPS)
   * - reserva_prioritaria: será o próximo rastreador se o atual descer
   * - passageiro: apenas acompanha
   */
  const handleConfirmarEmbarque = useCallback(async () => {
    if (embarcando) return; // Evita múltiplos cliques
    setEmbarcando(true);
    
    try {
      const usuario = auth.currentUser;
      if (!usuario) return;
      
      // Normaliza os nomes das paradas para comparação
      const paradasNormalizadas = itinerario.paradas.map(p => 
        (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
      );
      
      const indiceAnterior = viagemAtiva?.indiceParada || 0;
      const meuIndiceAtual = paradasNormalizadas.indexOf(origem.toLowerCase().trim(), indiceAnterior);
      
      if (meuIndiceAtual === -1) {
        setAlertaMsg({ texto: 'Parada não encontrada no itinerário.', severidade: 'error' });
        return;
      }
      
      // Tenta entrar na viagem (pode ser bloqueado se já estiver em outra)
      let papel;
      try {
        papel = await entrarNaViagem(itinerario.id, horario, usuario, origem, destino, itinerario);
      } catch (e) {
        console.error(e);
        setAlertaMsg({ texto: 'Erro ao confirmar embarque.', severidade: 'error' });
        return;
      }
      
      if (papel === 'bloqueado') {
        setAlertaMsg({ texto: 'Você já está em outra viagem ativa!', severidade: 'warning' });
        return;
      }
      
      // Se o usuário está embarcando na última parada (desembarque imediato)
      const isUltimaParada = meuIndiceAtual === paradasNormalizadas.length - 1;
      if (isUltimaParada) {
        await deleteDoc(doc(db, "viagens_ativas", tripId));
        voltar();
        return;
      }
      
      // Atualiza a viagem ativa com a posição do usuário
      await setDoc(doc(db, "viagens_ativas", tripId), {
        ultimaParada: origem,
        indiceParada: meuIndiceAtual,
        atualizadoEm: serverTimestamp(),
      }, { merge: true });
      
      // Define se o usuário será rastreador (envia GPS) ou apenas passageiro
      setIsRastreador(papel === 'rastreador' || papel === 'reserva_prioritaria');
      setStatusFluxo('votando'); // Avança para a etapa de votação da lotação
      
    } finally {
      setEmbarcando(false);
    }
  }, [auth, itinerario, origem, destino, viagemAtiva, tripId, voltar, setIsRastreador, setStatusFluxo, embarcando]);

  // ==================== EMBARQUE AUTOMÁTICO ====================
  
  /**
   * Hook que detecta quando o usuário está próximo da parada e parado
   * Confirma o embarque automaticamente após 5 segundos parado
   */
  const { status: statusEmbarqueAuto, distancia: distanciaAuto, velocidade: velocidadeAuto, tempoRestante } = useEmbarqueAutomatico({
    ativo: embarqueAutomaticoAtivo && !modoApenasConsulta && statusFluxo === 'inicial' && !!position && !!coordsParadaOrigem,
    position,
    paradaOrigem: origem,
    paradaCoords: coordsParadaOrigem,
    onEmbarqueConfirmado: async () => {
      setAlertaMsg({ texto: `Embarque automático detectado! Você está no ônibus para ${traduzirSigla(destino)}.`, severidade: 'success' });
      setTimeout(() => setAlertaMsg(null), 5000);
      await handleConfirmarEmbarque();
      setEmbarqueAutomaticoAtivo(false);
    },
  });

  // ==================== ESTIMATIVA DE TEMPO REAL ====================
  
  /**
   * Atualiza a estimativa de tempo restante baseado na posição do ônibus
   */
  const atualizarEstimativaTempoReal = useCallback(() => {
    if (!viagemAtiva || !origem || modoApenasConsulta) return;
    const resultado = calcularMinutosRestantes(viagemAtiva, itinerario, rotasAprendidas, origem);
    if (resultado) setEstimativaTempoReal(resultado);
  }, [viagemAtiva, origem, itinerario, rotasAprendidas, modoApenasConsulta]);

  // Atualiza a estimativa inicial e a cada 30 segundos durante a viagem
  useEffect(() => {
    atualizarEstimativaTempoReal();
  }, [atualizarEstimativaTempoReal]);

  useEffect(() => {
    if (statusFluxo !== 'inicial' && !modoApenasConsulta) {
      intervalEstimativaRef.current = setInterval(atualizarEstimativaTempoReal, 30000);
      return () => { if (intervalEstimativaRef.current) clearInterval(intervalEstimativaRef.current); };
    }
  }, [statusFluxo, modoApenasConsulta, atualizarEstimativaTempoReal]);

  // Persiste o ID da viagem no sessionStorage
  useEffect(() => {
    if (statusFluxo !== 'inicial' && statusFluxo !== 'expulso' && tripId) {
      setViagemIdPersistida(tripId);
    }
  }, [statusFluxo, tripId, setViagemIdPersistida]);

  // ==================== CARREGAMENTO DE DADOS ====================
  
  /**
   * Carrega os dados das paradas e escuta mudanças na viagem ativa (Firestore)
   */
  useEffect(() => {
    let mounted = true;
    
    // Carrega todas as paradas do Firebase
    getDocs(collection(db, "paradas")).then(s => {
      const mapeamento = {};
      s.docs.forEach(d => { mapeamento[d.id.toLowerCase().trim()] = d.data(); });
      if (mounted) setParadasData(mapeamento);
      setLoading(false);
    });
    
    // Escuta mudanças na viagem ativa em tempo real (onSnapshot)
    const unsub = onSnapshot(doc(db, "viagens_ativas", tripId), (d) => {
      if (d.exists()) setViagemAtiva(d.data());
      else setViagemAtiva(null);
    });
    
    return () => { mounted = false; unsub(); };
  }, [tripId]);

  /**
   * Carrega as geometrias das rotas (GPX) do Firestore
   * Usadas para desenhar o trajeto do ônibus no mapa
   */
  useEffect(() => {
    const carregarGeometriasFixas = async () => {
      if (!itinerario?.id) return;
      
      const paradasLista = itinerario.paradas.map(p => 
        (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
      );
      
      const geometrias = {};
      let geometriaEncontrada = false;
      
      // Para cada trecho entre paradas, busca a geometria salva
      for (let i = 0; i < paradasLista.length - 1; i++) {
        const paradaA = paradasLista[i];
        const paradaB = paradasLista[i + 1];
        const docId = `${itinerario.id}_${paradaA}-${paradaB}`;
        
        try {
          const docSnap = await getDoc(doc(db, "rotas_geometricas", docId));
          if (docSnap.exists()) {
            const geo = docSnap.data().geometria;
            if (geo && geo.length >= 2) {
              geometrias[docId] = geo;
              geometriaEncontrada = true;
              console.log(`✅ Rota carregada: ${docId} (${geo.length} pontos)`);
            }
          }
        } catch (err) {
          console.error(`Erro ao carregar ${docId}:`, err);
        }
      }
      
      setGeometriaRotas(geometrias);
      
      if (!geometriaEncontrada) {
        console.warn('⚠️ Nenhuma rota geométrica válida encontrada!');
      }
    };
    
    carregarGeometriasFixas();
  }, [itinerario]);

  /**
   * Carrega os tempos médios de cada trecho (aprendizado coletivo)
   * Usados para calcular o tempo restante até o destino
   */
  useEffect(() => {
    const carregarRotasTempo = async () => {
      if (!itinerario?.id) return;
      
      const paradasLista = itinerario.paradas.map(p => 
        (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()
      );
      
      const tempos = {};
      
      for (let i = 0; i < paradasLista.length - 1; i++) {
        const paradaA = paradasLista[i];
        const paradaB = paradasLista[i + 1];
        const docId = `${itinerario.id}_${paradaA}-${paradaB}`;
        
        const docSnap = await getDoc(doc(db, "rotas_aprendidas", docId));
        if (docSnap.exists()) {
          tempos[docId] = {
            tempoMedioSegundos: docSnap.data().tempoMedioSegundos || 180,
            totalAmostras: docSnap.data().totalAmostras || 0
          };
        } else {
          tempos[docId] = { tempoMedioSegundos: 180, totalAmostras: 0 }; // Fallback: 3 minutos
        }
      }
      
      setRotasAprendidas(tempos);
    };
    
    carregarRotasTempo();
  }, [itinerario]);

  // ==================== RECONEXÃO E VALIDAÇÕES ====================
  
  /**
   * Reconecta automaticamente quando a aba volta a ficar visível
   * Busca os dados mais recentes da viagem no Firestore
   */
  useEffect(() => {
    const agora = Date.now();
    const deveReconectar = isPageVisible && statusFluxo !== 'inicial' && statusFluxo !== 'expulso' && !reconectando && (agora - ultimaReconexaoRef.current) > 5000;
    
    if (deveReconectar) {
      ultimaReconexaoRef.current = agora;
      setReconectando(true);
      getDoc(doc(db, "viagens_ativas", tripId))
        .then(snap => {
          if (snap.exists()) setViagemAtiva(snap.data());
          setReconectando(false);
        })
        .catch(() => setReconectando(false));
    }
  }, [isPageVisible, statusFluxo, tripId, reconectando]);

  /**
   * Calcula a distância do usuário até a parada de origem (para habilitar/desabilitar botão)
   */
  useEffect(() => {
    const oriKey = origem?.toLowerCase().trim();
    if (position && paradasData[oriKey]) {
      const coords = getCoords(oriKey);
      if (coords) {
        setDistanciaAteParada(calculateDistance(position.lat, position.lng, coords[0], coords[1]));
      }
    }
  }, [position, paradasData, origem, getCoords]);

  /**
   * Verifica se a viagem expirou (baseado no horário de saída + duração estimada)
   * Se expirou, remove a viagem ativa e volta à tela anterior
   */
  useEffect(() => {
    if (modoApenasConsulta || !itinerario?.duracaoEstimada || !horario) return;
    
    const verificarExpiracao = async () => {
      const [horas, minutos] = horario.split(':').map(Number);
      const agora = new Date();
      const horarioInicio = new Date();
      horarioInicio.setHours(horas, minutos, 0, 0);
      const horarioTermino = new Date(horarioInicio.getTime() + (itinerario.duracaoEstimada + 10) * 60000);
      
      if (agora > horarioTermino) {
        await deleteDoc(doc(db, "viagens_ativas", tripId));
        voltar();
      }
    };
    
    verificarExpiracao();
    const interval = setInterval(verificarExpiracao, 60000); // Verifica a cada minuto
    return () => clearInterval(interval);
  }, [itinerario, horario, voltar, modoApenasConsulta, tripId]);

  // ==================== FUNÇÕES DE INTERAÇÃO DO USUÁRIO ====================
  
  /**
   * Expulsa o usuário da viagem (chegou ao destino, saiu da rota, etc.)
   * Mostra uma mensagem apropriada e volta à tela anterior após 3 segundos
   */
  const handleExpulsar = useCallback((motivo) => {
    const mensagens = { 
      destino: 'Você chegou ao destino!', 
      desvio: 'Você saiu da rota.', 
      rebaixado: 'Outro passageiro assumiu o rastreamento.', 
      cancelada: 'Viagem encerrada.' 
    };
    setAlertaMsg({ texto: mensagens[motivo] || 'Viagem encerrada.', severidade: motivo === 'destino' ? 'success' : 'warning' });
    setStatusFluxo('expulso');
    setTimeout(() => voltar(), 3000);
  }, [voltar, setStatusFluxo]);

  /**
   * Registra o voto de lotação do usuário (vazio/médio/lotado)
   * Avança para o estado de rastreamento
   */
  const handleVotarLotacao = useCallback(async (statusLot) => {
    const valores = { 'vazio': 1, 'medio': 3, 'lotado': 5 };
    await updateDoc(doc(db, "viagens_ativas", tripId), {
      historicoLotacao: arrayUnion({ valor: valores[statusLot], data: new Date() }),
      atualizadoEm: serverTimestamp()
    });
    setStatusFluxo('rastreando');
  }, [tripId, setStatusFluxo]);

  /**
   * Hook de rastreamento - Gerencia o envio de posição GPS durante a viagem
   * Ativo apenas quando statusFluxo === 'rastreando'
   */
  useRastreamento({
    ativo: (statusFluxo === 'rastreando' && isRastreador && !modoApenasConsulta) || (statusFluxo === 'rastreando' && gpsPassageiroAtivo),
    isRastreador,
    itinerario,
    horario,
    paradaOrigem: origem || '',
    paradaDestino: destino || '',
    paradasData,
    onExpulsar: handleExpulsar,
    onReativarGpsPassageiro: () => {
      // Ativa GPS do passageiro quando está próximo do destino (para preparar desembarque)
      if (!isRastreador && statusFluxo === 'rastreando' && !gpsPassageiroAtivo) {
        setGpsPassageiroAtivo(true);
        setAlertaMsg({ texto: `Atenção! Você está chegando perto do seu destino (${traduzirSigla(destino)}). Prepare-se para descer.`, severidade: 'info' });
        setTimeout(() => setAlertaMsg(null), 5000);
      }
    },
  });

  // ==================== FUNÇÕES DE FORMATAÇÃO E CÁLCULO ====================
  
  /**
   * Formata timestamp do Firebase para texto relativo (ex: "Agora mesmo", "Há 5 min")
   */
  const formatarRelativo = (timestamp) => {
    if (!timestamp) return "...";
    const agora = new Date();
    const dataPost = timestamp.toDate();
    const difSegundos = Math.floor((agora - dataPost) / 1000);
    if (difSegundos < 60) return "Agora mesmo";
    return `Há ${Math.floor(difSegundos / 60)} min`;
  };

  /**
   * Calcula a lotação média do ônibus baseada nos votos dos últimos 5 minutos
   * Retorna label e cor correspondente (Vazio/Verde, Médio/Laranja, Lotado/Vermelho)
   */
  const infoLotacao = useMemo(() => {
    if (!viagemAtiva?.historicoLotacao || viagemAtiva.historicoLotacao.length === 0) return null;
    
    const agoraMs = Date.now();
    const cincoMinutosMs = 5 * 60 * 1000;
    
    // Filtra votos dos últimos 5 minutos
    const votosRecentes = viagemAtiva.historicoLotacao.filter(voto => {
      const dataVoto = voto.data?.toDate ? voto.data.toDate().getTime() : (voto.data?.seconds * 1000 || agoraMs);
      return (agoraMs - dataVoto) <= cincoMinutosMs;
    });
    
    if (votosRecentes.length === 0) return null;
    
    // Calcula média ponderada (vazio=1, medio=3, lotado=5)
    const soma = votosRecentes.reduce((acc, curr) => acc + curr.valor, 0);
    const media = parseFloat((soma / votosRecentes.length).toFixed(1));
    
    let label = "Vazio", cor = "#0EA503";
    if (media > 4.0) { label = "Lotado"; cor = "#C4151C"; }
    else if (media > 2.5) { label = "Médio"; cor = "#FF8A31"; }
    
    return { media, label, cor };
  }, [viagemAtiva]);

  /**
   * Determina a lista de paradas que serão exibidas no mapa
   * Se for consulta, mostra todas as paradas do itinerário
   * Se for viagem, mostra apenas do embarque ao destino
   */
  const paradasTrecho = useMemo(() => {
    const lista = itinerario?.paradas?.map(p => (typeof p === 'object' ? p.nome : p).toString().toLowerCase().trim()) || [];
    if (modoApenasConsulta) return lista;
    
    const idxO = lista.indexOf(origem?.toLowerCase().trim());
    const idxD = lista.indexOf(destino?.toLowerCase().trim(), idxO);
    return (idxO !== -1 && idxD !== -1) ? lista.slice(idxO, idxD + 1) : lista;
  }, [itinerario, origem, destino, modoApenasConsulta]);

  // Coordenadas de todas as paradas do trecho (para centralizar o mapa)
  const coords = useMemo(() => paradasTrecho.map(getCoords).filter(c => c !== null), [paradasTrecho, getCoords]);

  // Progresso da barra de embarque automático
  const progressoEmbarque = useMemo(() => {
    if (statusEmbarqueAuto !== 'proximo' || !tempoRestante) return 0;
    return ((TEMPO_CONFIRMACAO_MS - tempoRestante) / TEMPO_CONFIRMACAO_MS) * 100;
  }, [statusEmbarqueAuto, tempoRestante]);

  // ==================== RENDERIZAÇÃO DO MAPA ====================
  
  /**
   * Renderiza as linhas coloridas do trajeto no mapa
   * Cada trecho entre paradas tem uma cor diferente (gradiente)
   * Só renderiza se houver geometria carregada do GPX
   */
  const renderGradiente = () => {
    if (paradasTrecho.length < 2) return null;
    
    return paradasTrecho.map((id, i) => {
      if (i === paradasTrecho.length - 1) return null;
      
      const idA = id;
      const idB = paradasTrecho[i + 1];
      const chave = `${itinerario.id}_${idA}-${idB}`;
      
      let geometria = geometriaRotas[chave];
      
      // Se não houver geometria importada do GPX para este trecho, NÃO desenha nada
      if (!geometria || geometria.length < 2) {
        return null;
      }
      
      const c1 = getCoords(idA);
      const c2 = getCoords(idB);
      if (!c1 || !c2) return null;
      
      let positions = geometria.map(p => [p.lat, p.lng]);
      
      // Garante que a linha comece e termine exatamente nas paradas (correção de desvio >20m)
      const distInicio = calculateDistance(c1[0], c1[1], positions[0][0], positions[0][1]);
      if (distInicio > 20) {
        positions = [c1, ...positions];
      }
      
      const distFim = calculateDistance(c2[0], c2[1], positions[positions.length-1][0], positions[positions.length-1][1]);
      if (distFim > 20) {
        positions = [...positions, c2];
      }
      
      // Calcula cor gradiente baseada na posição do trecho (início: vermelho, meio: laranja, fim: azul)
      const totalTrechos = paradasTrecho.length - 1;
      const ratio = i / totalTrechos; 
      
      const r = Math.round(255 - (255 - 14) * ratio);
      const g = Math.round(138 + (165 - 138) * ratio);
      const b = Math.round(49 - (49 - 3) * ratio);
      
      return (
        <Polyline 
          key={i} 
          positions={positions} 
          pathOptions={{ 
            color: `rgb(${r},${g},${b})`, 
            weight: 6, 
            opacity: 0.5,
            lineCap: 'round',
            lineJoin: 'round'
          }} 
        />
      );
    });
  };

  const handleCloseAlert = () => {
    if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
    setAlertaMsg(null);
  };

  // ==================== RENDERIZAÇÃO CONDICIONAL ====================
  
  // Tela de loading enquanto carrega dados iniciais ou reconecta
  if (loading || reconectando) return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
      <CircularProgress />
      <Typography variant="body2" color="textSecondary">{reconectando ? 'Reconectando...' : 'Carregando...'}</Typography>
    </Box>
  );

  // ==================== RENDERIZAÇÃO PRINCIPAL ====================
  return (
    <Box sx={{ height: '100dvh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      
      {/* HEADER - Informações da viagem */}
      <Paper elevation={2} sx={{ pt: 'calc(15px + env(safe-area-inset-top))', pb: 2, zIndex: 1100, borderRadius: 0, backgroundColor: '#f9f9f9', display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
        <Typography variant="h6" fontWeight="bold" color="primary">{categoria || "Rota"} - {horario}</Typography>
        
        {!modoApenasConsulta && (
          <Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
            {viagemAtiva ? (
              <>Visto em: <b>{traduzirSigla(viagemAtiva.ultimaParada)}</b> {formatarRelativo(viagemAtiva.atualizadoEm)}</>
            ) : "Aguardando atualização..."}
          </Typography>
        )}
        
        {/* CHIPS de informações (tempo restante, lotação, status rastreamento) */}
        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          {statusFluxo !== 'inicial' && estimativaTempoReal && !modoApenasConsulta && (
            <Chip icon={<AccessTimeIcon sx={{ fontSize: 14 }} />} label={`Chegada em ${estimativaTempoReal.minutos} min`} color="secondary" size="small" sx={{ fontWeight: 'bold' }} />
          )}
          {infoLotacao && (
            <Chip label={`${infoLotacao.label} (${infoLotacao.media})`} size="small" sx={{ fontWeight: 'bold', color: 'white', backgroundColor: infoLotacao.cor }} />
          )}
          {statusFluxo === 'rastreando' && isRastreador && (
            <Chip icon={<DirectionsBusIcon sx={{ fontSize: 14 }} />} label="Rastreando" size="small" sx={{ fontWeight: 'bold', bgcolor: '#00418F', color: 'white' }} />
          )}
        </Stack>
      </Paper>
      
      {/* MAPA */}
      <Box sx={{ flexGrow: 1, position: 'relative', width: '100%' }}>
        <IconButton onClick={voltar} sx={{ position: 'absolute', top: 16, left: 16, zIndex: 1100, bgcolor: 'white', boxShadow: 2 }}>
          <ArrowBackIcon />
        </IconButton>
        
        <MapContainer center={coords[0] || [-31.76, -52.33]} zoom={15} zoomControl={false} style={{ height: '100%', width: '100%', zIndex: 1 }}>
          <TileLayer url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png" />
          {renderGradiente()}
          
          {/* MARCERS das paradas */}
          {paradasTrecho.map((id, i) => {
            if (id.startsWith('int_')) return null;
            const c = getCoords(id);
            if (!c) return null;
            return (
              <Marker 
                key={i} 
                position={c} 
                icon={id === origem?.toLowerCase().trim() ? iconEmbarque : iconIntermediario}
              >
                <Popup><Typography variant="body2" fontWeight="bold">{traduzirSigla(id)}</Typography></Popup>
              </Marker>
            );
          })}
        </MapContainer>
        
        {/* BOTÕES DE AÇÃO (sobrepostos no mapa) */}
        <Box sx={{ position: 'absolute', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 1100, width: '90%', maxWidth: '400px', pointerEvents: 'none' }}>
          <Box sx={{ pointerEvents: 'auto' }}>
            
            {/* ESTADO INICIAL - Aguardando embarque */}
            {!modoApenasConsulta && statusFluxo === 'inicial' && (
              <Box sx={{ width: '100%' }}>
                {/* Barra de progresso do embarque automático */}
                {embarqueAutomaticoAtivo && statusEmbarqueAuto === 'proximo' && velocidadeAuto < 5 && tempoRestante && (
                  <Paper elevation={3} sx={{ mb: 1.5, p: 1.5, borderRadius: '16px', bgcolor: '#f0f7ff' }}>
                    <Stack spacing={1}>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <CircularProgress size={16} sx={{ color: '#0EA503' }} />
                          <Typography variant="caption" color="secondary" fontWeight="bold">Embarque em {Math.ceil(tempoRestante / 1000)}s...</Typography>
                        </Box>
                        <Typography variant="caption" fontWeight="bold" sx={{ color: '#00418F' }}>{velocidadeAuto.toFixed(1)} km/h</Typography>
                      </Stack>
                      <LinearProgress variant="determinate" value={Math.min(progressoEmbarque, 100)} sx={{ height: 6, borderRadius: 3, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { bgcolor: '#0EA503' } }} />
                    </Stack>
                  </Paper>
                )}
                
                {/* Botão principal de embarque */}
                <Button 
                  variant="contained" 
                  disabled={embarcando || (distanciaAteParada || distanciaAuto || 999) > 80} 
                  onClick={async () => { 
                    if (embarqueAutomaticoAtivo) setEmbarqueAutomaticoAtivo(false); 
                    await handleConfirmarEmbarque(); 
                  }} 
                  sx={{ borderRadius: '50px', bgcolor: '#C4151C', color: 'white', width: '100%', height: '60px', fontWeight: 'bold', boxShadow: 3 }}
                >
                  {embarcando 
                    ? 'Processando...' 
                    : ((distanciaAteParada || distanciaAuto || 999) > 80 
                        ? `Longe (${Math.round(distanciaAteParada || distanciaAuto || 0)}m)` 
                        : (embarqueAutomaticoAtivo ? 'Aguardando ônibus...' : 'Confirmar Embarque Manual'))}
                </Button>
                
                {/* Alternar entre embarque automático e manual */}
                {statusEmbarqueAuto !== 'confirmado' && (
                  <Button size="small" onClick={() => setEmbarqueAutomaticoAtivo(!embarqueAutomaticoAtivo)} sx={{ mt: 1, textTransform: 'none', color: '#00418F', width: '100%' }}>
                    {embarqueAutomaticoAtivo ? 'Usar embarque manual' : 'Reativar embarque automático'}
                  </Button>
                )}
              </Box>
            )}
            
            {/* ESTADO DE VOTAÇÃO - Usuário acabou de embarcar, precisa votar na lotação */}
            {statusFluxo === 'votando' && (
              <Paper elevation={4} sx={{ p: 2, borderRadius: '15px', textAlign: 'center' }}>
                <Typography variant="subtitle2" fontWeight="bold" sx={{ mb: 1.5 }}>Lotação do Ônibus:</Typography>
                <Stack direction="row" spacing={1} justifyContent="center">
                  <Button size="small" variant="contained" sx={{ bgcolor: '#0EA503' }} onClick={() => handleVotarLotacao('vazio')}>Vazio</Button>
                  <Button size="small" variant="contained" sx={{ bgcolor: '#FF8A31' }} onClick={() => handleVotarLotacao('medio')}>Médio</Button>
                  <Button size="small" variant="contained" sx={{ bgcolor: '#C4151C' }} onClick={() => handleVotarLotacao('lotado')}>Cheio</Button>
                </Stack>
              </Paper>
            )}
            
            {/* ESTADO DE RASTREAMENTO - Viagem em andamento */}
            {statusFluxo === 'rastreando' && (
              <Paper elevation={2} sx={{ p: 1.5, borderRadius: '15px', textAlign: 'center', bgcolor: 'rgba(255,255,255,0.92)' }}>
                <Typography variant="caption" color="textSecondary">
                  {isRastreador ? 'Você está contribuindo com a rota em tempo real' : gpsPassageiroAtivo ? 'GPS ativado para desembarque' : 'Acompanhando o ônibus...'}
                </Typography>
              </Paper>
            )}
          </Box>
        </Box>
      </Box>
      
      {/* SNACKBAR para mensagens de alerta */}
      <Snackbar open={!!alertaMsg} autoHideDuration={4000} onClose={handleCloseAlert} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert onClose={handleCloseAlert} severity={alertaMsg?.severidade || 'info'} sx={{ width: '100%', fontWeight: 'bold' }}>
          {alertaMsg?.texto}
        </Alert>
      </Snackbar>
    </Box>
  );
}