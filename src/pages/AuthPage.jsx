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
            {isLogin ? 'ENTRAR' : 'CADASTRAR'}
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
  container: { 
    height: '100vh', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    background: '#FFFFFF'
  },
  card: { 
    background: '#F9F9F9',
    padding: '40px', 
    borderRadius: '24px', 
    boxShadow: '0 12px 40px rgba(80, 75, 58, 0.12)',
    width: '320px',
    border: '1px solid #F0F0F0'
  },
  title: { 
    textAlign: 'center', 
    marginBottom: '24px', 
    color: '#3D3B8E',
    fontWeight: '900',
    letterSpacing: '-0.5px'
  },
  form: { display: 'flex', flexDirection: 'column', gap: '16px' },
  input: { 
    padding: '14px', 
    borderRadius: '12px', 
    border: '1px solid #E2E8F0', 
    fontSize: '14px',
    background: '#FFFFFF',
    color: '#504B3A', 
    outline: 'none',
  },
  button: { 
    padding: '14px', 
    background: '#3D3B8E', 
    color: 'white', 
    border: 'none', 
    borderRadius: '12px', 
    cursor: 'pointer', 
    fontWeight: 'bold',
    fontSize: '14px',
    transition: '0.3s',
    boxShadow: '0 4px 12px rgba(61, 59, 142, 0.2)'
  },
  error: { 
    color: '#E63946', 
    fontSize: '12px', 
    marginTop: '15px', 
    textAlign: 'center',
    fontWeight: '600'
  },
  footer: { marginTop: '24px', textAlign: 'center', fontSize: '13px' },
  link: { 
    color: '#58BC82', 
    cursor: 'pointer', 
    marginBottom: '12px',
    fontWeight: '700'
  },
  forgot: { 
    color: '#504B3A', 
    cursor: 'pointer', 
    textDecoration: 'none',
    opacity: 0.7,
    marginTop: '8px'
  }
};