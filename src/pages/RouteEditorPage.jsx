// pages/RouteEditorPage.jsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { db } from '../services/firebase';
import { collection, getDocs, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  Stack,
  Drawer,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  Alert,
  Snackbar,
  CircularProgress,
  Divider,
  ToggleButton,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  InputAdornment,
  Chip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DrawIcon from '@mui/icons-material/Draw';
import DeleteIcon from '@mui/icons-material/Delete';
import SaveIcon from '@mui/icons-material/Save';
import UndoIcon from '@mui/icons-material/Undo';
import RedoIcon from '@mui/icons-material/Redo';
import LayersClearIcon from '@mui/icons-material/LayersClear';
import EditIcon from '@mui/icons-material/Edit';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import DragHandleIcon from '@mui/icons-material/DragHandle';
import MapIcon from '@mui/icons-material/Map';
import StraightenIcon from '@mui/icons-material/Straighten';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SearchIcon from '@mui/icons-material/Search';
import ListAltIcon from '@mui/icons-material/ListAlt';
import 'leaflet/dist/leaflet.css';

import {
  buscarTodosTrechosExistentes,
  buscarTrechosPorParadas,
} from '../services/routeSharingService';

// Configuração do ícone padrão do Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// ========== SERVIÇOS DE SNAPPING ==========

async function snapToNearestRoad(lat, lng) {
  const url = `https://router.project-osrm.org/nearest/v1/driving/${lng},${lat}`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.code === 'Ok' && data.waypoints && data.waypoints[0]) {
      const [snappedLng, snappedLat] = data.waypoints[0].location;
      return { lat: snappedLat, lng: snappedLng };
    }
  } catch (error) {
    console.warn('Erro no snapping:', error);
  }
  return null;
}

async function getRouteBetweenPoints(start, end) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.code === 'Ok' && data.routes && data.routes[0]) {
      const coordinates = data.routes[0].geometry.coordinates;
      return coordinates.map(coord => ({
        lat: coord[1],
        lng: coord[0]
      }));
    }
  } catch (error) {
    console.warn('Erro ao buscar rota:', error);
  }
  return null;
}

async function getCompleteRoute(points) {
  if (points.length < 2) return points;
  
  const simplified = simplifyPointsArray(points, 20);
  
  if (simplified.length <= 2) {
    return await getRouteBetweenPoints(simplified[0], simplified[1]) || simplified;
  }
  
  let allRoutePoints = [];
  
  for (let i = 0; i < simplified.length - 1; i++) {
    const segment = await getRouteBetweenPoints(simplified[i], simplified[i + 1]);
    
    if (segment && segment.length > 0) {
      if (allRoutePoints.length === 0) {
        allRoutePoints = segment;
      } else {
        allRoutePoints = [...allRoutePoints, ...segment.slice(1)];
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return allRoutePoints.length > 0 ? allRoutePoints : points;
}

function simplifyPointsArray(points, toleranceMeters = 20) {
  if (points.length <= 2) return points;
  
  const resultado = [points[0]];
  let ultimoPonto = points[0];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = calculateDistance(
      ultimoPonto.lat, ultimoPonto.lng,
      points[i].lat, points[i].lng
    );
    
    if (dist >= toleranceMeters) {
      resultado.push(points[i]);
      ultimoPonto = points[i];
    }
  }
  
  resultado.push(points[points.length - 1]);
  return resultado;
}

function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// ========== COMPONENTE DE DESENHO ==========

function DrawingLayer({ setPoints, isDrawingMode, currentColor, onPointAdded }) {
  useMapEvents({
    click: (e) => {
      if (!isDrawingMode) return;
      const { lat, lng } = e.latlng;
      setPoints(prev => [...prev, { lat, lng, color: currentColor }]);
      onPointAdded?.();
    },
  });
  return null;
}

// ========== COMPONENTE PRINCIPAL ==========

export default function RouteEditorPage() {
  const navigate = useNavigate();
  const { itinerarioId } = useParams();
  
  const [itinerarios, setItinerarios] = useState([]);
  const [selectedItinerario, setSelectedItinerario] = useState(null);
  const [paradas, setParadas] = useState({});
  const [pontos, setPontos] = useState([]);
  const [historico, setHistorico] = useState([]);
  const [indiceHistorico, setIndiceHistorico] = useState(-1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAligning, setIsAligning] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [selectedTrecho, setSelectedTrecho] = useState(null);
  const [trechos, setTrechos] = useState([]);
  const [alert, setAlert] = useState(null);
  const [currentColor, setCurrentColor] = useState('#3388ff');
  const [editMode, setEditMode] = useState('draw');
  
  // States para importação de trechos
  const [trechosDisponiveis, setTrechosDisponiveis] = useState([]);
  const [showTrechosDialog, setShowTrechosDialog] = useState(false);
  const [searchTermTrecho, setSearchTermTrecho] = useState('');
  const [trechosEncontrados, setTrechosEncontrados] = useState([]);

  const mapRef = useRef(null);

  // Função para extrair nome da parada
  const extrairNomeParada = (parada) => {
    if (!parada) return null;
    if (typeof parada === 'string') return parada;
    if (typeof parada === 'object' && parada.nome) return parada.nome;
    return null;
  };

  // Carregar dados iniciais
  useEffect(() => {
    const carregarDados = async () => {
      setIsLoading(true);
      try {
        const paradasSnap = await getDocs(collection(db, "paradas"));
        const paradasMap = {};
        paradasSnap.docs.forEach(doc => {
          paradasMap[doc.id.toLowerCase().trim()] = {
            id: doc.id,
            ...doc.data()
          };
        });
        setParadas(paradasMap);

        const itinerariosSnap = await getDocs(collection(db, "itinerarios"));
        const itinerariosList = [];
        itinerariosSnap.docs.forEach(doc => {
          itinerariosList.push({
            id: doc.id,
            ...doc.data()
          });
        });
        setItinerarios(itinerariosList);

        if (itinerarioId) {
          const it = itinerariosList.find(i => i.id === itinerarioId);
          if (it) {
            setSelectedItinerario(it);
            await carregarGeometrias(it);
          }
        }
      } catch (error) {
        console.error("Erro ao carregar dados:", error);
        setAlert({ severity: 'error', message: 'Erro ao carregar dados' });
      } finally {
        setIsLoading(false);
      }
    };
    carregarDados();
  }, [itinerarioId]);

  // Carregar geometrias
  const carregarGeometrias = async (itinerario) => {
    if (!itinerario?.paradas) return;
    
    const paradasLista = itinerario.paradas.map(p => {
      const nome = extrairNomeParada(p);
      return nome?.toLowerCase().trim() || '';
    }).filter(n => n);
    
    const trechosList = [];
    
    for (let i = 0; i < paradasLista.length - 1; i++) {
      const paradaA = paradasLista[i];
      const paradaB = paradasLista[i + 1];
      const docId = `${itinerario.id}_${paradaA}-${paradaB}`;
      
      try {
        const docSnap = await getDoc(doc(db, "rotas_geometricas", docId));
        if (docSnap.exists()) {
          const geometria = docSnap.data().geometria || [];
          trechosList.push({
            id: docId,
            paradaA,
            paradaB,
            pontos: geometria,
            existe: true,
            origem: docSnap.data().itinerarioId
          });
        } else {
          trechosList.push({
            id: docId,
            paradaA,
            paradaB,
            pontos: [],
            existe: false,
            origem: null
          });
        }
      } catch (err) {
        console.error(`Erro ao carregar ${docId}:`, err);
        trechosList.push({
          id: docId,
          paradaA,
          paradaB,
          pontos: [],
          existe: false,
          origem: null
        });
      }
    }
    
    setTrechos(trechosList);
    setPontos([]);
    
    if (trechosList.length > 0) {
      setSelectedTrecho(trechosList[0].id);
    }
  };

  // Histórico
  const salvarNoHistorico = useCallback((novosPontos) => {
    const novoHistorico = historico.slice(0, indiceHistorico + 1);
    novoHistorico.push([...novosPontos]);
    setHistorico(novoHistorico);
    setIndiceHistorico(novoHistorico.length - 1);
  }, [historico, indiceHistorico]);

  const desfazer = () => {
    if (indiceHistorico > 0) {
      setIndiceHistorico(indiceHistorico - 1);
      setPontos(historico[indiceHistorico - 1]);
    }
  };

  const refazer = () => {
    if (indiceHistorico < historico.length - 1) {
      setIndiceHistorico(indiceHistorico + 1);
      setPontos(historico[indiceHistorico + 1]);
    }
  };

  const limparPontos = () => {
    if (window.confirm('Tem certeza que deseja limpar todos os pontos?')) {
      setPontos([]);
      salvarNoHistorico([]);
    }
  };

  // Obter coordenadas de parada
  const obterCoordsParada = useCallback((nomeParada) => {
    if (!nomeParada) return null;
    
    let nomeStr = nomeParada;
    if (typeof nomeParada === 'object') {
      nomeStr = nomeParada.nome;
    }
    
    if (!nomeStr || typeof nomeStr !== 'string') return null;
    
    const dados = paradas[nomeStr.toLowerCase().trim()];
    if (!dados?.location) return null;
    
    let lat = Number(dados.location.latitude || dados.location._lat);
    let lng = Number(dados.location.longitude || dados.location._long);
    if (isNaN(lat) || isNaN(lng)) return null;
    
    return { lat: lat > 0 ? lat * -1 : lat, lng: lng > 0 ? lng * -1 : lng };
  }, [paradas]);

  // ========== FUNÇÕES DE ALINHAMENTO ==========

  const alinharRotaCompleta = async () => {
    if (pontos.length < 2) {
      setAlert({ severity: 'warning', message: 'Desenhe pelo menos 2 pontos primeiro' });
      return;
    }
    
    setAlert({ severity: 'info', message: 'Buscando rota nas ruas...' });
    setIsAligning(true);
    
    try {
      const rotaCompleta = await getCompleteRoute(pontos);
      
      if (rotaCompleta && rotaCompleta.length > 0) {
        setPontos(rotaCompleta);
        salvarNoHistorico(rotaCompleta);
        setAlert({ 
          severity: 'success', 
          message: `Rota alinhada! ${rotaCompleta.length} pontos gerados.` 
        });
      } else {
        setAlert({ severity: 'warning', message: 'Não foi possível alinhar a rota. Tente novamente.' });
      }
    } catch (error) {
      console.error('Erro ao alinhar rota:', error);
      setAlert({ severity: 'error', message: 'Erro ao alinhar rota' });
    } finally {
      setIsAligning(false);
    }
  };

  const snapPontosExistentes = async () => {
    if (pontos.length < 1) {
      setAlert({ severity: 'warning', message: 'Desenhe uma rota primeiro' });
      return;
    }
    
    setAlert({ severity: 'info', message: 'Ajustando pontos às ruas...' });
    setIsAligning(true);
    
    try {
      const pontosSnapados = [];
      
      for (const ponto of pontos) {
        const snapped = await snapToNearestRoad(ponto.lat, ponto.lng);
        if (snapped) {
          pontosSnapados.push({ lat: snapped.lat, lng: snapped.lng, color: currentColor });
        } else {
          pontosSnapados.push(ponto);
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      setPontos(pontosSnapados);
      salvarNoHistorico(pontosSnapados);
      setAlert({ severity: 'success', message: `${pontosSnapados.length} pontos ajustados às ruas!` });
      
    } catch (error) {
      console.error('Erro ao snapar pontos:', error);
      setAlert({ severity: 'error', message: 'Erro ao ajustar pontos' });
    } finally {
      setIsAligning(false);
    }
  };

  // ========== FUNÇÕES DE IMPORTAÇÃO DE TRECHOS ==========

  // Carregar todos os trechos disponíveis
  const carregarTodosTrechosDisponiveis = async () => {
    setIsLoading(true);
    try {
      const trechos = await buscarTodosTrechosExistentes();
      const validos = trechos.filter(t => t.geometria && t.geometria.length >= 2);
      setTrechosDisponiveis(validos);
      setShowTrechosDialog(true);
    } catch (error) {
      console.error("Erro ao carregar trechos disponíveis:", error);
      setAlert({ severity: 'error', message: 'Erro ao carregar trechos disponíveis' });
    } finally {
      setIsLoading(false);
    }
  };

  // Buscar trecho por paradas específicas
const buscarTrechoPorParadasAtuais = async () => {
  if (!selectedTrecho) return;
  
  const trechoAtual = trechos.find(t => t.id === selectedTrecho);
  if (!trechoAtual) return;
  
  setIsAligning(true);
  try {
    // Busca todos os trechos
    const todosTrechos = await buscarTodosTrechosExistentes();
    
    // Filtra APENAS os que têm EXATAMENTE a mesma paradaA e paradaB
    const encontrados = todosTrechos.filter(t => 
      t.paradaA === trechoAtual.paradaA && 
      t.paradaB === trechoAtual.paradaB &&
      t.itinerarioId !== selectedItinerario?.id // Exclui o próprio itinerário
    );
    
    const validos = encontrados.filter(t => t.geometria && t.geometria.length >= 2);
    
    if (validos.length > 0) {
      setTrechosEncontrados(validos);
      setShowTrechosDialog(true);
    } else {
      setAlert({ 
        severity: 'info', 
        message: `Nenhum trecho encontrado para ${trechoAtual.paradaA.toUpperCase()} → ${trechoAtual.paradaB.toUpperCase()} em outros itinerários` 
      });
    }
  } catch (error) {
    console.error("Erro ao buscar trecho:", error);
    setAlert({ severity: 'error', message: 'Erro ao buscar trecho' });
  } finally {
    setIsAligning(false);
  }
};

  // Importar trecho selecionado
  const importarTrechoSelecionado = async (trechoParaImportar) => {
    if (!trechoParaImportar || !selectedTrecho) return;
    
    setIsSaving(true);
    try {
      const trechoAtual = trechos.find(t => t.id === selectedTrecho);
      
      await setDoc(doc(db, "rotas_geometricas", selectedTrecho), {
        itinerarioId: selectedItinerario?.id,
        paradaA: trechoAtual.paradaA,
        paradaB: trechoAtual.paradaB,
        geometria: trechoParaImportar.geometria,
        distanciaMetros: trechoParaImportar.distanciaMetros || 0,
        atualizadoEm: new Date().toISOString(),
        criadoPor: 'importado_de_' + trechoParaImportar.itinerarioId,
        importadoDe: trechoParaImportar.id
      });
      
      setTrechos(prev => prev.map(t => 
        t.id === selectedTrecho 
          ? { ...t, pontos: trechoParaImportar.geometria, existe: true, origem: trechoParaImportar.itinerarioId }
          : t
      ));
      
      setPontos(trechoParaImportar.geometria);
      salvarNoHistorico(trechoParaImportar.geometria);
      setAlert({ severity: 'success', message: 'Trecho importado com sucesso!' });
      setShowTrechosDialog(false);
      setTrechosEncontrados([]);
      
    } catch (error) {
      console.error("Erro ao importar trecho:", error);
      setAlert({ severity: 'error', message: 'Erro ao importar trecho' });
    } finally {
      setIsSaving(false);
    }
  };

  // Salvar rota
  const salvarRota = async () => {
    if (!selectedTrecho) {
      setAlert({ severity: 'warning', message: 'Selecione um trecho para salvar' });
      return;
    }
    
    if (pontos.length < 2) {
      setAlert({ severity: 'warning', message: 'Desenhe pelo menos 2 pontos para salvar a rota' });
      return;
    }
    
    setIsSaving(true);
    
    try {
      const trecho = trechos.find(t => t.id === selectedTrecho);
      if (!trecho) throw new Error('Trecho não encontrado');
      
      const coordsInicio = obterCoordsParada(trecho.paradaA);
      const coordsFim = obterCoordsParada(trecho.paradaB);
      
      let pontosFinal = [...pontos];
      
      if (coordsInicio) {
        const distInicio = calculateDistance(
          pontosFinal[0].lat, pontosFinal[0].lng,
          coordsInicio.lat, coordsInicio.lng
        );
        if (distInicio > 30) {
          pontosFinal = [coordsInicio, ...pontosFinal];
        }
      }
      
      if (coordsFim) {
        const distFim = calculateDistance(
          pontosFinal[pontosFinal.length - 1].lat, pontosFinal[pontosFinal.length - 1].lng,
          coordsFim.lat, coordsFim.lng
        );
        if (distFim > 30) {
          pontosFinal = [...pontosFinal, coordsFim];
        }
      }
      
      await setDoc(doc(db, "rotas_geometricas", selectedTrecho), {
        itinerarioId: selectedItinerario?.id,
        paradaA: trecho.paradaA,
        paradaB: trecho.paradaB,
        geometria: pontosFinal,
        atualizadoEm: new Date().toISOString(),
        criadoPor: 'editor_manual'
      });
      
      setTrechos(prev => prev.map(t => 
        t.id === selectedTrecho 
          ? { ...t, pontos: pontosFinal, existe: true }
          : t
      ));
      
      setAlert({ severity: 'success', message: 'Rota salva com sucesso!' });
      setPontos([]);
      salvarNoHistorico([]);
      
    } catch (error) {
      console.error("Erro ao salvar rota:", error);
      setAlert({ severity: 'error', message: 'Erro ao salvar rota: ' + error.message });
    } finally {
      setIsSaving(false);
    }
  };

  // Remover rota
  const removerRota = async () => {
    if (!selectedTrecho) return;
    if (!window.confirm('Tem certeza que deseja remover esta rota?')) return;
    
    setIsSaving(true);
    try {
      await deleteDoc(doc(db, "rotas_geometricas", selectedTrecho));
      
      setTrechos(prev => prev.map(t => 
        t.id === selectedTrecho 
          ? { ...t, pontos: [], existe: false }
          : t
      ));
      
      setPontos([]);
      salvarNoHistorico([]);
      setAlert({ severity: 'success', message: 'Rota removida com sucesso!' });
      
    } catch (error) {
      console.error("Erro ao remover rota:", error);
      setAlert({ severity: 'error', message: 'Erro ao remover rota' });
    } finally {
      setIsSaving(false);
    }
  };

  // Editar trecho
  const editarTrecho = async () => {
    if (!selectedTrecho) return;
    
    const trecho = trechos.find(t => t.id === selectedTrecho);
    if (!trecho || !trecho.existe) {
      setAlert({ severity: 'warning', message: 'Este trecho não possui rota salva' });
      return;
    }
    
    setPontos(trecho.pontos);
    salvarNoHistorico(trecho.pontos);
    setEditMode('draw');
    setAlert({ severity: 'info', message: 'Rota carregada para edição.' });
  };

  // Visualizar trecho
  const visualizarTrecho = (trechoId) => {
    setSelectedTrecho(trechoId);
    const trecho = trechos.find(t => t.id === trechoId);
    if (trecho && trecho.existe) {
      setPontos(trecho.pontos);
      salvarNoHistorico(trecho.pontos);
    } else {
      setPontos([]);
      salvarNoHistorico([]);
    }
  };

  // Centro do mapa
  const getMapCenter = () => {
    if (selectedItinerario?.paradas && selectedItinerario.paradas.length > 0) {
      const primeiraParada = selectedItinerario.paradas[0];
      const nomeParada = extrairNomeParada(primeiraParada);
      const coords = obterCoordsParada(nomeParada);
      if (coords) return [coords.lat, coords.lng];
    }
    return [-31.76, -52.33];
  };

  // Renderização
  const renderizarParadas = () => {
    if (!selectedItinerario?.paradas) return null;
    
    return selectedItinerario.paradas.map((parada, idx) => {
      const nome = extrairNomeParada(parada);
      if (!nome || typeof nome !== 'string') return null;
      
      const coords = obterCoordsParada(nome);
      if (!coords) return null;
      
      const isInicio = idx === 0;
      const isFim = idx === selectedItinerario.paradas.length - 1;
      
      const iconUrl = isInicio 
        ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png'
        : isFim
        ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png'
        : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png';
      
      const icon = new L.Icon({
        iconUrl,
        iconSize: [25, 41],
        iconAnchor: [12, 41],
        popupAnchor: [1, -34]
      });
      
      return (
        <Marker 
          key={idx} 
          position={[coords.lat, coords.lng]} 
          icon={icon} 
          interactive={false} 
          zIndexOffset={-100}
        >
          <Popup>
            <Typography variant="body2" fontWeight="bold">
              {idx + 1}. {nome.toUpperCase()}
            </Typography>
          </Popup>
        </Marker>
      );
    });
  };

  const renderizarLinhaDesenhada = () => {
    if (pontos.length < 2) return null;
    const positions = pontos.map(p => [p.lat, p.lng]);
    
    return (
      <Polyline
        positions={positions}
        pathOptions={{
          color: currentColor,
          weight: 5,
          opacity: 0.8,
          lineCap: 'round',
          lineJoin: 'round'
        }}
        interactive={false}
      />
    );
  };

  const renderizarRotasSalvas = () => {
    return trechos.map(trecho => {
      if (trecho.id === selectedTrecho || !trecho.existe || trecho.pontos.length < 2) return null;
      
      const positions = trecho.pontos.map(p => [p.lat, p.lng]);
      
      return (
        <Polyline
          key={trecho.id}
          positions={positions}
          pathOptions={{
            color: '#aaaaaa',
            weight: 3,
            opacity: 0.5,
            dashArray: '5, 5'
          }}
        />
      );
    });
  };

  // Diálogo de trechos disponíveis
  const TrechosDisponiveisDialog = () => {
    const listaParaExibir = trechosEncontrados.length > 0 ? trechosEncontrados : trechosDisponiveis;
    const titulo = trechosEncontrados.length > 0 
      ? `Trechos disponíveis para ${trechosEncontrados[0]?.paradaA?.toUpperCase()} → ${trechosEncontrados[0]?.paradaB?.toUpperCase()}`
      : 'Todos os trechos disponíveis';

    return (
      <Dialog 
        open={showTrechosDialog} 
        onClose={() => {
          setShowTrechosDialog(false);
          setTrechosEncontrados([]);
          setSearchTermTrecho('');
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          <Stack direction="row" alignItems="center" spacing={1}>
            <ContentCopyIcon color="primary" />
            <Typography variant="h6">{titulo}</Typography>
          </Stack>
          <TextField
            size="small"
            fullWidth
            placeholder="Filtrar por itinerário..."
            value={searchTermTrecho}
            onChange={(e) => setSearchTermTrecho(e.target.value)}
            sx={{ mt: 2 }}
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
        </DialogTitle>
        <DialogContent dividers>
          {listaParaExibir.length === 0 ? (
            <Typography color="textSecondary" sx={{ textAlign: 'center', py: 4 }}>
              Nenhum trecho disponível para importar.
            </Typography>
          ) : (
            <List>
              {listaParaExibir
                .filter(t => t.itinerarioId?.toLowerCase().includes(searchTermTrecho.toLowerCase()))
                .map((trecho, idx) => (
                  <ListItem key={idx} divider>
                    <ListItemText
                      primary={
                        <Stack direction="row" alignItems="center" spacing={1} flexWrap="wrap">
                          <Typography fontWeight="bold">
                            {trecho.itinerarioId?.toUpperCase()}
                          </Typography>
                          <Chip 
                            label={`${Math.round(trecho.distanciaMetros || 0)}m`} 
                            size="small" 
                            color="info" 
                          />
                          {trecho.paradaA && trecho.paradaB && (
                            <Chip 
                              label={`${trecho.paradaA.toUpperCase()} → ${trecho.paradaB.toUpperCase()}`}
                              size="small"
                              variant="outlined"
                            />
                          )}
                        </Stack>
                      }
                      secondary={
                        <Typography variant="caption" color="textSecondary">
                          {trecho.geometria?.length || 0} pontos | 
                          Atualizado em: {trecho.atualizadoEm ? new Date(trecho.atualizadoEm).toLocaleDateString() : 'desconhecido'}
                        </Typography>
                      }
                    />
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<ContentCopyIcon />}
                      onClick={() => importarTrechoSelecionado(trecho)}
                      sx={{ ml: 2, flexShrink: 0 }}
                    >
                      Importar
                    </Button>
                  </ListItem>
                ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setShowTrechosDialog(false);
            setTrechosEncontrados([]);
            setSearchTermTrecho('');
          }}>
            Fechar
          </Button>
        </DialogActions>
      </Dialog>
    );
  };

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <Paper elevation={2} sx={{ p: 2, zIndex: 1100, borderRadius: 0, display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, flexWrap: 'wrap' }}>
        <IconButton onClick={() => navigate('/admin/rotas')}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="h6" fontWeight="bold" color="primary" sx={{ flexGrow: 1 }}>
          Editor de Rotas - {selectedItinerario?.id?.toUpperCase() || 'Selecione um itinerário'}
        </Typography>
        
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
          <Tooltip title="Modo Desenho">
            <ToggleButton
              value="draw"
              selected={editMode === 'draw'}
              onChange={() => setEditMode('draw')}
              size="small"
            >
              <DrawIcon /> Desenhar
            </ToggleButton>
          </Tooltip>
          
          <Tooltip title="Alinhar rota completa nas ruas (preenche lacunas)">
            <Button
              variant="contained"
              size="small"
              startIcon={<MapIcon />}
              onClick={alinharRotaCompleta}
              disabled={isAligning || pontos.length < 2}
              color="primary"
            >
              {isAligning ? 'Alinhando...' : 'Alinhar Rota'}
            </Button>
          </Tooltip>
          
          <Tooltip title="Ajustar pontos existentes às ruas">
            <Button
              variant="outlined"
              size="small"
              startIcon={<StraightenIcon />}
              onClick={snapPontosExistentes}
              disabled={isAligning || pontos.length < 1}
            >
              Ajustar Pontos
            </Button>
          </Tooltip>
          
          <Tooltip title="Buscar trecho de outros itinerários">
            <Button
              variant="outlined"
              size="small"
              startIcon={<SearchIcon />}
              onClick={buscarTrechoPorParadasAtuais}
              disabled={!selectedTrecho}
            >
              Buscar Trecho
            </Button>
          </Tooltip>
          
          <Tooltip title="Ver todos os trechos disponíveis">
            <Button
              variant="outlined"
              size="small"
              startIcon={<ListAltIcon />}
              onClick={carregarTodosTrechosDisponiveis}
            >
              Ver Trechos
            </Button>
          </Tooltip>
          
          <Tooltip title="Limpar tudo">
            <IconButton onClick={limparPontos} color="warning" size="small">
              <LayersClearIcon />
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Desfazer">
            <IconButton onClick={desfazer} disabled={indiceHistorico <= 0} size="small">
              <UndoIcon />
            </IconButton>
          </Tooltip>
          
          <Tooltip title="Refazer">
            <IconButton onClick={refazer} disabled={indiceHistorico >= historico.length - 1} size="small">
              <RedoIcon />
            </IconButton>
          </Tooltip>
          
          <Button
            variant="contained"
            color="success"
            startIcon={<SaveIcon />}
            onClick={salvarRota}
            disabled={isSaving || pontos.length < 2}
            size="small"
          >
            {isSaving ? 'Salvando...' : 'Salvar Rota'}
          </Button>
        </Stack>
      </Paper>

      {/* Main content */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <Drawer
          variant="persistent"
          anchor="left"
          open={drawerOpen}
          sx={{
            width: 320,
            flexShrink: 0,
            '& .MuiDrawer-paper': {
              width: 320,
              position: 'relative',
              height: '100%',
              borderRight: '1px solid #e0e0e0',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }
          }}
        >
          <Box sx={{ 
            p: 2, 
            flex: 1, 
            display: 'flex', 
            flexDirection: 'column', 
            overflow: 'hidden',
            height: '100%'
          }}>
            <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 2, flexShrink: 0 }}>
              Trechos do Itinerário
            </Typography>
            
            <FormControl fullWidth size="small" sx={{ mb: 2, flexShrink: 0 }}>
              <InputLabel>Itinerário</InputLabel>
              <Select
                value={selectedItinerario?.id || ''}
                onChange={(e) => {
                  const it = itinerarios.find(i => i.id === e.target.value);
                  setSelectedItinerario(it);
                  if (it) carregarGeometrias(it);
                }}
                label="Itinerário"
              >
                {itinerarios.map(it => (
                  <MenuItem key={it.id} value={it.id}>
                    {it.id.toUpperCase()} - {it.paradas?.length || 0} paradas
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <Divider sx={{ mb: 2, flexShrink: 0 }} />
            
            {/* Lista com scroll */}
            <Box sx={{ 
              flex: 1, 
              overflowY: 'auto',
              overflowX: 'hidden',
              minHeight: 0,
              mb: 2
            }}>
              <List dense>
                {trechos.map((trecho, idx) => {
                  const paradaA = trecho.paradaA?.toUpperCase() || '';
                  const paradaB = trecho.paradaB?.toUpperCase() || '';
                  const isSelected = selectedTrecho === trecho.id;
                  
                  return (
                    <ListItem
                      key={trecho.id}
                      disablePadding
                      secondaryAction={
                        trecho.existe && (
                          <Tooltip title="Editar esta rota">
                            <IconButton
                              edge="end"
                              size="small"
                              onClick={() => {
                                setSelectedTrecho(trecho.id);
                                editarTrecho();
                              }}
                            >
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )
                      }
                    >
                      <ListItemButton
                        selected={isSelected}
                        onClick={() => visualizarTrecho(trecho.id)}
                        sx={{ borderRadius: 1 }}
                      >
                        <ListItemText
                          primary={
                            <Stack direction="row" alignItems="center" spacing={1}>
                              <Typography variant="body2" fontWeight={isSelected ? 'bold' : 'normal'}>
                                Trecho {idx + 1}
                              </Typography>
                              {trecho.existe ? (
                                <CheckCircleIcon sx={{ fontSize: 14, color: '#4caf50' }} />
                              ) : (
                                <ErrorIcon sx={{ fontSize: 14, color: '#ff9800' }} />
                              )}
                              {trecho.origem && trecho.origem !== selectedItinerario?.id && (
                                <Chip 
                                  label={trecho.origem.toUpperCase()} 
                                  size="small" 
                                  variant="outlined"
                                  sx={{ height: 18, fontSize: '0.6rem' }}
                                />
                              )}
                            </Stack>
                          }
                          secondary={`${paradaA.substring(0, 20)} → ${paradaB.substring(0, 20)}`}
                          secondaryTypographyProps={{ variant: 'caption' }}
                        />
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
            </Box>
            
            <Divider sx={{ my: 2, flexShrink: 0 }} />
            
            {selectedTrecho && (
              <Box sx={{ mt: 2, flexShrink: 0 }}>
                <Typography variant="subtitle2" fontWeight="bold" gutterBottom>
                  Ações do Trecho
                </Typography>
                <Stack spacing={1}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<EditIcon />}
                    onClick={editarTrecho}
                    fullWidth
                  >
                    Editar Rota
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    size="small"
                    startIcon={<DeleteIcon />}
                    onClick={removerRota}
                    fullWidth
                    disabled={!trechos.find(t => t.id === selectedTrecho)?.existe}
                  >
                    Remover Rota
                  </Button>
                </Stack>
              </Box>
            )}
            
            <Box sx={{ mt: 2, p: 1, bgcolor: '#f5f5f5', borderRadius: 2, flexShrink: 0 }}>
              <Typography variant="caption" color="textSecondary">
                💡 Dicas:
                <br />• Clique no mapa para adicionar pontos
                <br />• Use "Alinhar Rota" para corrigir e preencher lacunas
                <br />• Use "Buscar Trecho" para reutilizar rotas de outros itinerários
                <br />• A rota será salva automaticamente simplificada
              </Typography>
            </Box>
          </Box>
        </Drawer>

        {/* Mapa */}
        <Box sx={{ flex: 1, position: 'relative' }}>
          <IconButton
            onClick={() => setDrawerOpen(!drawerOpen)}
            sx={{
              position: 'absolute',
              top: 16,
              left: drawerOpen ? 336 : 16,
              zIndex: 1000,
              bgcolor: 'white',
              boxShadow: 2,
              '&:hover': { bgcolor: '#f5f5f5' }
            }}
          >
            <DragHandleIcon />
          </IconButton>
          
          {editMode === 'draw' && (
            <Paper sx={{ position: 'absolute', bottom: 16, right: 16, zIndex: 1000, p: 1, bgcolor: 'rgba(255,255,255,0.9)' }}>
              <Typography variant="caption" color="primary" fontWeight="bold">
                ✏️ Modo Desenho - Clique no mapa para adicionar pontos
              </Typography>
            </Paper>
          )}
          
          {isAligning && (
            <Paper sx={{ position: 'absolute', top: 16, right: 16, zIndex: 1000, p: 1, bgcolor: 'rgba(0,0,0,0.7)', color: 'white' }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={20} color="inherit" />
                <Typography variant="caption">Processando...</Typography>
              </Stack>
            </Paper>
          )}
          
          <MapContainer
            center={getMapCenter()}
            zoom={14}
            style={{ 
              height: '100%', 
              width: '100%',
              cursor: editMode === 'draw' ? 'crosshair' : 'grab'
            }}
            ref={mapRef}
          >
            <TileLayer
              url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_2zia_1_7597566517a627144c3ece15"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
            />
            
            {renderizarParadas()}
            {renderizarRotasSalvas()}
            {renderizarLinhaDesenhada()}
            
            <DrawingLayer
              setPoints={setPontos}
              isDrawingMode={editMode === 'draw'}
              currentColor={currentColor}
              onPointAdded={() => {}}
            />
          </MapContainer>
        </Box>
      </Box>

      {/* Diálogo de trechos disponíveis */}
      <TrechosDisponiveisDialog />

      {/* Snackbar */}
      <Snackbar
        open={!!alert}
        autoHideDuration={4000}
        onClose={() => setAlert(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setAlert(null)} severity={alert?.severity} sx={{ width: '100%' }}>
          {alert?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}