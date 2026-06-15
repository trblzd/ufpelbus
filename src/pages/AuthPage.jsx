// pages/AuthPage.jsx
// PÁGINA DE AUTENTICAÇÃO - Gerencia login, cadastro e recuperação de senha

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../services/firebase';
import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  sendPasswordResetEmail 
} from 'firebase/auth';

export default function AuthPage() {
  // ==================== ESTADOS ====================
  const [isLogin, setIsLogin] = useState(true);        // true: tela de login, false: tela de cadastro
  const [email, setEmail] = useState('');              // Email do usuário
  const [password, setPassword] = useState('');        // Senha do usuário
  const [error, setError] = useState('');              // Mensagem de erro (se houver)
  const [loading, setLoading] = useState(false);       // Estado de carregamento (desabilita botão)
  const navigate = useNavigate();

  // ==================== EFEITOS ====================
  
  /**
   * Verifica se o usuário já está logado ao carregar a página
   * Se estiver, redireciona automaticamente para a HomePage
   */
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged((user) => {
      if (user) {
        navigate('/');  // Usuário já logado, vai para a home
      }
    });
    return () => unsubscribe();  // Limpa o listener ao desmontar
  }, [navigate]);

  // ==================== FUNÇÕES DE AUTENTICAÇÃO ====================
  
  /**
   * Envia o formulário de login ou cadastro
   * - Se isLogin = true: tenta fazer login
   * - Se isLogin = false: tenta criar uma nova conta
   */
  const handleSubmit = async (e) => {
    e.preventDefault();  // Previne o recarregamento da página
    setError('');        // Limpa erro anterior
    setLoading(true);    // Mostra loading no botão
    
    try {
      if (isLogin) {
        // MODO LOGIN: Autentica com email e senha
        await signInWithEmailAndPassword(auth, email, password);
        // O onAuthStateChanged acima cuidará do redirecionamento
      } else {
        // MODO CADASTRO: Cria nova conta
        await createUserWithEmailAndPassword(auth, email, password);
        // Após cadastro, redireciona automaticamente (usuário já fica logado)
      }
    } catch (err) {
      console.error(err);
      
      // Tratamento de erros específicos do Firebase
      let msg = 'Erro: ';
      switch (err.code) {
        case 'auth/user-not-found':
          msg += 'Usuário não encontrado.';
          break;
        case 'auth/wrong-password':
          msg += 'Senha incorreta.';
          break;
        case 'auth/email-already-in-use':
          msg += 'E-mail já cadastrado.';
          break;
        case 'auth/invalid-email':
          msg += 'E-mail inválido.';
          break;
        case 'auth/weak-password':
          msg += 'Senha muito fraca (mínimo 6 caracteres).';
          break;
        default:
          msg += 'Verifique os dados ou a conexão.';
      }
      setError(msg);
    } finally {
      setLoading(false);  // Remove loading independente do resultado
    }
  };

  /**
   * Envia email de recuperação de senha
   * Só funciona se o usuário já tiver digitado um email no campo
   */
  const handleResetPassword = async () => {
    if (!email) {
      alert("Digite seu e-mail primeiro!");
      return;
    }
    
    try {
      await sendPasswordResetEmail(auth, email);
      alert("E-mail de recuperação enviado! Verifique sua caixa de entrada.");
    } catch (err) {
      console.error(err);
      alert("Erro ao enviar e-mail de recuperação. Verifique se o e-mail está correto.");
    }
  };

  // ==================== RENDERIZAÇÃO ====================
  
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Título dinâmico baseado no modo */}
        <h2 style={styles.title}>{isLogin ? 'Bem-vindo de volta' : 'Criar Conta'}</h2>
        
        {/* FORMULÁRIO */}
        <form onSubmit={handleSubmit} style={styles.form}>
          <input 
            type="email" 
            placeholder="E-mail" 
            value={email} 
            onChange={(e) => setEmail(e.target.value)}
            style={styles.input} 
            required 
            autoComplete="email"
          />
          
          <input 
            type="password" 
            placeholder="Senha" 
            value={password} 
            onChange={(e) => setPassword(e.target.value)}
            style={styles.input} 
            required 
            autoComplete={isLogin ? "current-password" : "new-password"}
          />
          
          <button 
            type="submit" 
            style={styles.button} 
            disabled={loading}
          >
            {loading ? 'Aguarde...' : (isLogin ? 'Entrar' : 'Cadastrar')}
          </button>
        </form>

        {/* Mensagem de erro (se houver) */}
        {error && <p style={styles.error}>{error}</p>}

        {/* Links de navegação entre modos */}
        <div style={styles.footer}>
          {!isLogin && (
            <p onClick={() => setIsLogin(true)} style={styles.link}>
              Já tem conta? Faça Login
            </p>
          )}
          
          {isLogin && (
            <>
              <p onClick={() => setIsLogin(false)} style={styles.link}>
                Não tem conta? Cadastre-se
              </p>
              <p onClick={handleResetPassword} style={styles.forgot}>
                Esqueceu a senha?
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ==================== ESTILOS ====================
// Estilos inline (poderiam ser movidos para CSS module ou styled-components)
const styles = {
  container: { 
    height: '100vh', 
    display: 'flex', 
    alignItems: 'center', 
    justifyContent: 'center', 
    background: '#F9F9F9'
  },
  card: { 
    background: '#FFFFFF',
    padding: '40px', 
    borderRadius: '24px', 
    boxShadow: '0 12px 40px rgba(21, 67, 112, 0.08)',
    width: '320px',
    border: '1px solid #E2E8F0',
    textAlign: 'center'
  },
  title: { 
    textAlign: 'center', 
    marginBottom: '24px', 
    color: '#00418F',
    fontWeight: '900',
    letterSpacing: '-0.5px'
  },
  form: { 
    display: 'flex', 
    flexDirection: 'column', 
    gap: '16px' 
  },
  input: { 
    padding: '14px', 
    borderRadius: '12px', 
    border: '1px solid #E2E8F0', 
    fontSize: '14px',
    background: '#FFFFFF',
    color: '#00418F',
    outline: 'none',
    '&:focus': {
      borderColor: '#00418F',
    }
  },
  button: { 
    padding: '14px', 
    background: '#00418F',
    color: 'white', 
    border: 'none', 
    borderRadius: '12px', 
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '16px',
    transition: 'background 0.2s',
    '&:hover': { background: '#002f6c' },
    '&:disabled': { opacity: 0.6, cursor: 'not-allowed' }
  },
  error: {
    color: '#C4151C',
    fontSize: '14px',
    marginTop: '12px'
  },
  link: { 
    fontSize: '14px', 
    color: '#FF8A31', 
    cursor: 'pointer',
    marginTop: '14px',
    fontWeight: 'bold',
    textDecoration: 'underline',
    '&:hover': { color: '#e07a2a' }
  },
  forgot: { 
    color: '#00418F',
    marginTop: '12px',
    cursor: 'pointer',
    fontWeight: '500',
    textDecoration: 'underline',
    '&:hover': { color: '#002f6c' }
  },
  footer: {
    marginTop: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px'
  }
};