import React, { useState } from 'react';
import { auth } from '../services/firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail 
} from 'firebase/auth';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err) {
      setError("Erro: Verifique os dados ou a conexão.");
      console.error(err);
    }
  };

  const handleResetPassword = async () => {
    if (!email) return alert("Digite seu e-mail primeiro!");
    try {
      await sendPasswordResetEmail(auth, email);
      alert("E-mail de recuperação enviado!");
    } catch (err) {
      alert("Erro ao enviar e-mail de recuperação.");
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>{isLogin ? 'Bem-vindo de volta' : 'Criar Conta'}</h2>
        
        <form onSubmit={handleSubmit} style={styles.form}>
          <input 
            type="email" placeholder="E-mail" 
            value={email} onChange={(e) => setEmail(e.target.value)}
            style={styles.input} required 
          />
          <input 
            type="password" placeholder="Senha" 
            value={password} onChange={(e) => setPassword(e.target.value)}
            style={styles.input} required 
          />
          
          <button type="submit" style={styles.button}>
            {isLogin ? 'Entrar' : 'Cadastrar'}
          </button>
        </form>

        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.footer}>
          <p onClick={() => setIsLogin(!isLogin)} style={styles.link}>
            {isLogin ? 'Não tem conta? Cadastre-se' : 'Já tem conta? Faça Login'}
          </p>
          {isLogin && (
            <p onClick={handleResetPassword} style={styles.forgot}>
              Esqueceu a senha?
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6' },
  card: { background: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.1)', width: '320px' },
  title: { textAlign: 'center', marginBottom: '24px', color: '#1f2937' },
  form: { display: 'flex', flexDirection: 'column', gap: '12px' },
  input: { padding: '12px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '14px' },
  button: { padding: '12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' },
  error: { color: '#dc2626', fontSize: '12px', marginTop: '10px', textAlign: 'center' },
  footer: { marginTop: '20px', textAlign: 'center', fontSize: '13px' },
  link: { color: '#2563eb', cursor: 'pointer', marginBottom: '10px' },
  forgot: { color: '#6b7280', cursor: 'pointer', textDecoration: 'underline' }
};