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
    background: '#F9F9F9' // Background padrão do seu tema
  },
  card: { 
    background: '#FFFFFF',
    padding: '40px', 
    borderRadius: '24px', 
    boxShadow: '0 12px 40px rgba(21, 67, 112, 0.08)', // Sombra leve no tom da cor primária
    width: '320px',
    border: '1px solid #E2E8F0',
    textAlign: 'center'
  },
  title: { 
    textAlign: 'center', 
    marginBottom: '24px', 
    color: '#154370', // Cor Primary
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
    color: '#154370', // Texto Primary
    outline: 'none',
  },
  button: { 
    padding: '14px', 
    background: '#154370', // Cor Primary
    color: 'white', 
    border: 'none', 
    borderRadius: '12px', 
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '16px',
    transition: 'background 0.2s',
  },
  toggleText: { 
    marginTop: '16px', 
    fontSize: '14px', 
    color: '#154370', 
    cursor: 'pointer',
    fontWeight: '500'
  },
  resetText: { 
    fontSize: '12px', 
    color: '#FF8A31', // Cor Warning para recuperação
    cursor: 'pointer',
    marginTop: '8px',
    fontWeight: 'bold'
  },
  error: { 
    color: '#C4151C', // Cor Error
    fontSize: '12px', 
    marginBottom: '16px',
    fontWeight: '500'
  }
};