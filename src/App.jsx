// App.jsx
import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { ThemeProvider, createTheme, CircularProgress, Box } from '@mui/material';
import { collection, getDocs } from 'firebase/firestore';
import { db } from './services/firebase';

// Pages
import AuthPage from './pages/AuthPage';
import HomePage from './pages/HomePage';
import MainPage from './components/MainPage';
import PersonalizationPage from './pages/PersonalizationPage';
import AdminRoutesPage from './pages/AdminRoutesPage';
import RouteEditorPage from './pages/RouteEditorPage';

// Services
import { getFavoritos } from './services/favoritosService';
import { getAllApelidos, subscribeApelidos } from './services/apelidosService';

// Context
const AppDataContext = React.createContext(null);

// Hook personalizado para acessar o contexto
export const useAppData = () => {
  const context = React.useContext(AppDataContext);
  if (!context) {
    throw new Error('useAppData must be used within AppDataProvider');
  }
  return context;
};

// Tema da aplicação
const theme = createTheme({
  palette: {
    primary: { main: '#00418F' },
    secondary: { main: '#0EA503' },
    warning: { main: '#FF8A31' },
    error: { main: '#C4151C' },
    background: { default: '#F9F9F9' },
    text: { primary: '#00418F' },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 900, letterSpacing: '-0.5px' },
    h5: { fontWeight: 800, letterSpacing: '-0.3px' },
    h6: { fontWeight: 700 },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
        },
      },
    },
  },
});

// Provider dos dados globais
function AppDataProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [favoritos, setFavoritos] = useState([]);
  const [apelidos, setApelidos] = useState({});
  const [apelidosLoaded, setApelidosLoaded] = useState(false);
  const [todosItinerarios, setTodosItinerarios] = useState([]);
  const [todasParadas, setTodasParadas] = useState([]);
  const [loadingItinerarios, setLoadingItinerarios] = useState(true);
  const [loadingParadas, setLoadingParadas] = useState(true);
  
  const auth = getAuth();

  // Carregar dados do Firestore diretamente
  useEffect(() => {
    const carregarDados = async () => {
      try {
        // Carregar paradas
        const paradasSnap = await getDocs(collection(db, "paradas"));
        const paradasList = paradasSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setTodasParadas(paradasList);
      } catch (error) {
        console.error("Erro ao carregar paradas:", error);
      } finally {
        setLoadingParadas(false);
      }
      
      try {
        // Carregar itinerários
        const itinerariosSnap = await getDocs(collection(db, "itinerarios"));
        const itinerariosList = itinerariosSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setTodosItinerarios(itinerariosList);
      } catch (error) {
        console.error("Erro ao carregar itinerários:", error);
      } finally {
        setLoadingItinerarios(false);
      }
    };
    
    carregarDados();
  }, []);

  useEffect(() => {
    let unsubscribeApelidos = null;
    const unsubscribeAuth = onAuthStateChanged(auth, async (authUser) => {
      setUser(authUser);
      
      if (authUser) {
        try {
          const favs = await getFavoritos();
          setFavoritos(favs || []);
        } catch (e) {
          console.error('Erro ao carregar favoritos:', e);
          setFavoritos([]);
        }
        
        try {
          const apelidosData = getAllApelidos();
          setApelidos(apelidosData || {});
        } catch (e) {
          console.error('Erro ao carregar apelidos:', e);
          setApelidos({});
        }
        
        setApelidosLoaded(true);
        
        unsubscribeApelidos = subscribeApelidos((novosApelidos) => {
          setApelidos(novosApelidos || {});
        });
      } else {
        setFavoritos([]);
        setApelidos({});
        setApelidosLoaded(true);
      }
      
      setLoading(false);
    });
    
    return () => {
      unsubscribeAuth();
      if (unsubscribeApelidos) unsubscribeApelidos();
    };
  }, [auth]);

  const paradasCoordenadas = React.useMemo(() => {
    const coords = {};
    if (!todasParadas.length) return coords;
    
    todasParadas.forEach(parada => {
      if (parada && parada.location) {
        let lat = Number(parada.location.latitude || parada.location._lat);
        let lng = Number(parada.location.longitude || parada.location._long);
        if (!isNaN(lat) && !isNaN(lng)) {
          coords[parada.id?.toLowerCase().trim()] = { 
            lat: lat > 0 ? lat * -1 : lat, 
            lng: lng > 0 ? lng * -1 : lng 
          };
        }
      }
    });
    return coords;
  }, [todasParadas]);

  const idsParadasUnicas = React.useMemo(() => {
    const ids = new Set();
    
    if (todasParadas.length) {
      todasParadas.forEach(parada => {
        if (parada.id && !parada.id.startsWith('int_') && parada.id !== 'ponto-indefinido') {
          ids.add(parada.id.toLowerCase().trim());
        }
      });
    }
    
    if (todosItinerarios.length) {
      todosItinerarios.forEach(it => {
        if (it && it.paradas) {
          it.paradas.forEach(p => {
            const nome = typeof p === 'object' ? p.nome : p;
            if (nome && typeof nome === 'string' && !nome.startsWith('int_') && nome !== 'ponto-indefinido') {
              ids.add(nome.toLowerCase().trim());
            }
          });
        }
      });
    }
    
    return Array.from(ids).sort();
  }, [todasParadas, todosItinerarios]);

  const isLoading = loading || loadingItinerarios || loadingParadas || !apelidosLoaded;

  const value = {
    user,
    loading: isLoading,
    todosItinerarios: todosItinerarios || [],
    todasParadas: todasParadas || [],
    paradasCoordenadas,
    idsParadasUnicas,
    favoritos,
    apelidos,
    setFavoritos,
  };

  return (
    <AppDataContext.Provider value={value}>
      {children}
    </AppDataContext.Provider>
  );
}

// Componente de loading global
function GlobalLoading() {
  return (
    <Box sx={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', bgcolor: '#E2E8F0' }}>
      <CircularProgress size={48} sx={{ color: '#00418F' }} />
    </Box>
  );
}

// Wrapper para MainPage que extrai parâmetros da URL
function MainPageWrapper() {
  const searchParams = new URLSearchParams(window.location.search);
  const itinerarioStr = searchParams.get('itinerario');
  const horario = searchParams.get('horario');
  const origem = searchParams.get('origem');
  const destino = searchParams.get('destino');
  const categoria = searchParams.get('categoria');
  const modo = searchParams.get('modo');
  
  let itinerario = null;
  try {
    if (itinerarioStr) {
      itinerario = JSON.parse(decodeURIComponent(itinerarioStr));
    }
  } catch (e) {
    console.error('Erro ao parsear itinerário:', e);
  }
  
  const voltar = () => {
    window.history.back();
  };
  
  return (
    <MainPage
      itinerario={itinerario}
      horario={horario}
      origem={origem}
      destino={destino}
      modoApenasConsulta={modo === 'verificar'}
      voltar={voltar}
      categoria={categoria}
    />
  );
}

// Wrapper para PersonalizationPage
function PersonalizationPageWrapper() {
  const { idsParadasUnicas } = useAppData();
  const voltar = () => window.history.back();
  
  return (
    <PersonalizationPage
      idsParadas={idsParadasUnicas}
      onVoltar={voltar}
      onApelidosSalvos={() => {}}
    />
  );
}

// Rotas principais
function AppRoutes() {
  const { user, loading } = useAppData();
  
  if (loading) {
    return <GlobalLoading />;
  }
  
  if (!user) {
    return <AuthPage />;
  }
  
  return (
    <Routes>
      <Route path="/" element={<HomePage onLogout={() => {}} />} />
      <Route path="/mapa" element={<MainPageWrapper />} />
      <Route path="/personalizar" element={<PersonalizationPageWrapper />} />
      <Route path="/admin/rotas" element={<AdminRoutesPage />} />
      <Route path="/admin/rotas/editar/:itinerarioId" element={<RouteEditorPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Componente principal - SEM BrowserRouter (já está no main.jsx)
export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <AppDataProvider>
        <AppRoutes />
      </AppDataProvider>
    </ThemeProvider>
  );
}