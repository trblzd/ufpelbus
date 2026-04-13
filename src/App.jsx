import React, { useState, useEffect } from 'react';
import { auth, db } from './services/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        // Verifica se o perfil do usuário já existe no Firestore
        const userRef = doc(db, "usuarios", currentUser.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
          // Se for um novo usuário, cria o documento inicial de perfil
          await setDoc(userRef, {
            email: currentUser.email,
            favoritas: [],
            linhaFav: 'Todas',
            criadoEm: new Date()
          });
        }
        setUser(currentUser);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Carregando...
    </div>
  );

  // Fluxo de Autenticação
  if (!user) {
    return <AuthPage />;
  }

  // Pós-Login: HomePage agora é a tela inicial
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <button 
        onClick={() => signOut(auth)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          zIndex: 3000, // Acima de tudo (Mapa e Home)
          padding: '10px 15px',
          borderRadius: '30px',
          border: 'none',
          background: '#ef4444',
          color: 'white',
          fontWeight: 'bold',
          cursor: 'pointer',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)'
        }}
      >
        Sair
      </button>
      
      <HomePage />
    </div>
  );
}