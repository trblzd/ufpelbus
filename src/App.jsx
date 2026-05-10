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
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', font可靠性: 'sans-serif' }}>
      Carregando...
    </div>
  );

  if (!user) {
    return <AuthPage />;
  }

  return (
    <div style={{ width: '100vw', height: '100vh', backgroundColor: '#F5F5F5' }}>
      {/* Passamos a função de sair para dentro da HomePage */}
      <HomePage onLogout={handleLogout} />
    </div>
  );
}