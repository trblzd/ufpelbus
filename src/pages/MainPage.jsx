import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { db, auth } from '../services/firebase';
import { collection, getDocs, addDoc, serverTimestamp, query, where, onSnapshot } from 'firebase/firestore';
import 'leaflet/dist/leaflet.css';

// --- ÍCONES ---
const criarIcone = (cor) => new L.Icon({
  iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${cor}.png`,
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], shadowSize: [41, 41]
});

const icones = { padrao: criarIcone('blue'), favorito: criarIcone('gold'), comBipe: criarIcone('green'), usuario: criarIcone('red'), esperando: criarIcone('violet') };

// --- CÁLCULO DE DISTÂNCIA ---
const calcularDistancia = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
};

function FixMapResize() {
  const map = useMap();
  useEffect(() => { setTimeout(() => { map.invalidateSize(); }, 300); }, [map]);
  return null;
}

export default function MainPage({ filtroInicial, sentido, favoritas }) {
  const [paradas, setParadas] = useState([]);
  const [bipesRecentes, setBipesRecentes] = useState([]);
  const [userPos, setUserPos] = useState(null);
  const [esperandoEm, setEsperandoEm] = useState(null);
  const [loading, setLoading] = useState(true);

  // 1. Localização em tempo real (GPS Alta Precisão)
  useEffect(() => {
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => console.error("GPS Error:", err),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // 2. Monitoramento de Bipes e Alertas
  useEffect(() => {
    const carregarParadas = async () => {
      const snap = await getDocs(collection(db, "paradas"));
      const lista = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setParadas(lista);
      setLoading(false);
    };

    const trintaMinAtras = new Date(Date.now() - 30 * 60 * 1000);
    const q = query(collection(db, "bipes"), where("horario", ">=", trintaMinAtras));
    
    const unsubscribeBipes = onSnapshot(q, (snapshot) => {
      const bipesIds = snapshot.docs.map(doc => doc.data().paradaId);
      setBipesRecentes(bipesIds);

      // Lógica de Alerta de Parada Anterior
      snapshot.docChanges().forEach((change) => {
        if (change.type === "added" && esperandoEm) {
          const bipe = change.doc.data();
          // Se alguém bipou e não é a minha parada, aviso que está chegando
          if (bipe.paradaId !== esperandoEm.id) {
            alert(`🚌 ÔNIBUS DETECTADO! Alguém bipou em: ${bipe.paradaNome || 'parada anterior'}. Prepare-se para subir em: ${esperandoEm.nome}!`);
          }
        }
      });
    });

    carregarParadas();
    return () => unsubscribeBipes();
  }, [esperandoEm]);

  // 3. Função BIPAR (Limite 5 metros)
  const handleBipar = async (parada) => {
    if (!userPos) return alert("Buscando localização exata...");
    const dist = calcularDistancia(userPos.lat, userPos.lng, parada.location.latitude, parada.location.longitude);

    if (dist > 5) {
      return alert(`⚠️ Aproxime-se mais! Você está a ${Math.round(dist)}m. O limite para bipar é 5m.`);
    }

    try {
      await addDoc(collection(db, "bipes"), {
        paradaId: parada.id,
        paradaNome: parada.nome,
        usuarioId: auth.currentUser.uid,
        linha: filtroInicial,
        sentido: sentido,
        horario: serverTimestamp()
      });
      alert("✅ Bipe registrado! Você ajudou outros estudantes.");
    } catch (err) { alert("Erro ao registrar."); }
  };

  if (loading) return <div style={{padding:'20px'}}>Sincronizando com satélites...</div>;

  return (
    <div style={{ height: '100vh', width: '100vw' }}>
      <MapContainer center={[-31.765, -52.380]} zoom={14} style={{ height: '100%', width: '100%' }}>
        <FixMapResize />
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        
        {userPos && <Marker position={[userPos.lat, userPos.lng]} icon={icones.usuario}><Popup>Você está aqui</Popup></Marker>}

        {paradas.filter(p => filtroInicial === 'Todas' || p.linhas?.includes(filtroInicial)).map((parada) => {
          const isFav = favoritas.includes(parada.id);
          const temBipe = bipesRecentes.includes(parada.id);
          const estouAqui = esperandoEm?.id === parada.id;

          let icone = icones.padrao;
          if (isFav) icone = icones.favorito;
          if (temBipe) icone = icones.comBipe;
          if (estouAqui) icone = icones.esperando;

          return (
            <Marker key={parada.id} position={[parada.location.latitude, parada.location.longitude]} icon={icone}>
              <Popup>
                <div style={{ textAlign: 'center', minWidth: '160px' }}>
                  <h3 style={{ margin: '0 0 5px 0' }}>{parada.nome}</h3>
                  {temBipe && <p style={{ color: 'green', fontWeight: 'bold', fontSize: '11px' }}>⚡ Ônibus passou há pouco!</p>}
                  
                  <button 
                    onClick={() => setEsperandoEm(parada)}
                    style={{...styles.btn, backgroundColor: estouAqui ? '#7c3aed' : '#2563eb'}}
                  >
                    {estouAqui ? "ESPERANDO AQUI..." : "VOU SUBIR AQUI"}
                  </button>

                  <button onClick={() => handleBipar(parada)} style={{...styles.btn, backgroundColor: '#16a34a', marginTop: '5px'}}>
                    ESTOU NO ÔNIBUS (BIPAR)
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
}

const styles = {
  btn: { width: '100%', color: 'white', border: 'none', padding: '10px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '11px' }
};