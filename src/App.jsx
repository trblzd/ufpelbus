import React, { useState, useEffect } from 'react';
import { auth, db } from './services/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import HomePage from './pages/HomePage';
import AuthPage from './pages/AuthPage';

// Registrar Service Worker para PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('Service Worker registrado:', reg))
      .catch(err => console.error('Erro ao registrar Service Worker:', err));
  });
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const userRef = doc(db, "usuarios", currentUser.uid);
        const userSnap = await getDoc(userRef);

        if (!userSnap.exists()) {
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

  const handleLogout = () => signOut(auth);

  if (loading) return (
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      Carregando...
    </div>
  );

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div style={{ 
      width: '100vw', 
      height: '100dvh',
      backgroundColor: '#F9F9F9', 
      position: 'relative', 
      overflow: 'hidden' 
    }}>
      <HomePage handleLogout={handleLogout} />
    </div>
  );
}