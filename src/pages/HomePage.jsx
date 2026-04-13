import React, { useState, useEffect } from 'react';
import { db, auth } from '../services/firebase';
import { collection, getDocs, doc, setDoc, getDoc } from 'firebase/firestore';
import MainPage from './MainPage';

export default function HomePage() {
  const [view, setView] = useState('config'); 
  const [paradas, setParadas] = useState([]);
  const [favoritas, setFavoritas] = useState([]);
  const [linhaFav, setLinhaFav] = useState('Todas');
  const [sentido, setSentido] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const carregarDados = async () => {
      try {
        const snapParadas = await getDocs(collection(db, "paradas"));
        const lista = snapParadas.docs.map(d => ({ id: d.id, ...d.data() }));
        setParadas(lista);

        const userRef = doc(db, "usuarios", auth.currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (userSnap.exists()) {
          const data = userSnap.data();
          setFavoritas(data.favoritas || []);
          setLinhaFav(data.linhaFav || 'Todas');
        }
      } catch (error) { console.error(error); }
      finally { setLoading(false); }
    };
    carregarDados();
  }, []);

  const salvarEIrParaMapa = async () => {
    if (!sentido) return alert("Por favor, selecione para onde você está indo!");
    try {
      await setDoc(doc(db, "usuarios", auth.currentUser.uid), {
        favoritas, linhaFav, ultimoSentido: sentido, atualizadoEm: new Date()
      }, { merge: true });
      setView('mapa');
    } catch (error) { alert("Erro ao salvar preferências."); }
  };

  if (loading) return <div style={styles.center}>Carregando perfil...</div>;

  if (view === 'mapa') {
    return (
      <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
        <button onClick={() => setView('config')} style={styles.backButton}>← Ajustar Filtros</button>
        <MainPage filtroInicial={linhaFav} sentido={sentido} favoritas={favoritas} />
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={{ color: '#2563eb', textAlign: 'center', marginBottom: '20px' }}>BusPel</h1>
        
        <div style={styles.section}>
          <label style={styles.label}>Para onde você vai?</label>
          <div style={styles.grid}>
            <button onClick={() => setSentido('Centro')} style={{...styles.choiceBtn, borderColor: sentido === 'Centro' ? '#2563eb' : '#eee', backgroundColor: sentido === 'Centro' ? '#eff6ff' : 'white'}}>🏠 Centro</button>
            <button onClick={() => setSentido('Campus/Destino')} style={{...styles.choiceBtn, borderColor: sentido === 'Campus/Destino' ? '#2563eb' : '#eee', backgroundColor: sentido === 'Campus/Destino' ? '#eff6ff' : 'white'}}>🎓 Campus</button>
          </div>
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Sua Linha</label>
          <select value={linhaFav} onChange={(e) => setLinhaFav(e.target.value)} style={styles.select}>
            <option value="Todas">Qualquer linha</option>
            <option value="Circular Anglo">Circular Anglo</option>
            <option value="Apoio ESEF">Apoio ESEF</option>
            <option value="Apoio FaMed">Apoio FaMed</option>
          </select>
        </div>

        <div style={styles.section}>
          <label style={styles.label}>Paradas Favoritas</label>
          <div style={styles.scrollList}>
            {paradas.map(p => (
              <label key={p.id} style={styles.listItem}>
                <input type="checkbox" checked={favoritas.includes(p.id)} onChange={(e) => e.target.checked ? setFavoritas([...favoritas, p.id]) : setFavoritas(favoritas.filter(id => id !== p.id))} />
                <span style={{ marginLeft: '8px' }}>{p.nome}</span>
              </label>
            ))}
          </div>
        </div>

        <button onClick={salvarEIrParaMapa} style={styles.mainBtn}>ABRIR MAPA</button>
      </div>
    </div>
  );
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#f3f4f6', display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '20px' },
  card: { backgroundColor: 'white', width: '100%', maxWidth: '400px', padding: '25px', borderRadius: '15px', boxShadow: '0 4px 15px rgba(0,0,0,0.1)' },
  section: { marginBottom: '20px' },
  label: { display: 'block', fontWeight: 'bold', marginBottom: '8px', fontSize: '14px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' },
  choiceBtn: { padding: '15px', borderRadius: '10px', border: '2px solid', cursor: 'pointer', fontWeight: 'bold', transition: '0.2s' },
  select: { width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid #ddd' },
  scrollList: { height: '120px', overflowY: 'auto', border: '1px solid #eee', padding: '10px', borderRadius: '8px' },
  listItem: { display: 'flex', alignItems: 'center', marginBottom: '8px', fontSize: '14px' },
  mainBtn: { width: '100%', padding: '15px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', fontWeight: 'bold', cursor: 'pointer' },
  backButton: { position: 'absolute', top: '15px', left: '15px', zIndex: 1001, padding: '10px 15px', borderRadius: '20px', border: 'none', backgroundColor: 'white', boxShadow: '0 2px 5px rgba(0,0,0,0.2)', cursor: 'pointer', fontWeight: 'bold' },
  center: { height: '100vh', display: 'flex', justifyContent: 'center', alignItems: 'center' }
};