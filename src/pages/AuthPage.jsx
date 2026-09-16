// pages/AuthPage.jsx
import React, { useState } from 'react';
import { auth } from '../services/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail
} from 'firebase/auth';
import './AuthPage.css';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);        // true: login, false: cadastro
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ⚠️ IMPORTANTE:
  // NÃO usamos useNavigate aqui.
  // NÃO redirecionamos em onAuthStateChanged.
  //
  // Motivo: o AppDataProvider (em App.jsx) já escuta onAuthStateChanged
  // e, quando o user fica disponível, o AppRoutes re-renderiza sozinho
  // na URL atual. Se a gente navegar para '/' aqui, quebramos rotas
  // como /admin/rotas e /admin/rotas/editar/:id — o usuário é
  // "empurrado" para a Home mesmo tendo digitado a URL correta.

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
      // Sucesso: não navegamos manualmente.
      // O AppDataProvider detecta o login e o AppRoutes re-renderiza.
    } catch (err) {
      console.error(err);
      let msg = 'Erro: ';
      switch (err.code) {
        case 'auth/user-not-found':
          msg += 'Usuário não encontrado.';
          break;
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          msg += 'Senha incorreta.';
          break;
        case 'auth/email-already-in-use':
          msg += 'E-mail já cadastrado.';
          break;
        case 'auth/invalid-email':
          msg += 'E-mail inválido.';
          break;
        case 'auth/weak-password':
          msg += 'Senha fraca (mínimo 6 caracteres).';
          break;
        default:
          msg += 'Verifique os dados informados.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      alert('Digite seu e-mail no campo correspondente primeiro!');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      alert('E-mail de recuperação enviado!');
    } catch (err) {
      alert('Erro ao enviar e-mail de recuperação.');
    }
  };

  return (
    <div className="auth-page-bg">
      <div className="auth-page-container">

        {/* LOGO DO BUSEPEL CHAMANDO DO PUBLIC */}
        <div className="auth-logo-container">
          <img
            src="/buslogo.svg"
            alt="Busepel Logo"
            className="auth-logo-svg"
          />
        </div>

        <div className="auth-title">
          {isLogin ? 'Entrar' : 'Cadastre-se'}
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-input-group">
            <label className="auth-label">E-mail:</label>
            <input
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-input-group">
            <label className="auth-label">Senha:</label>
            <input
              type="password"
              className="auth-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </div>

          <div className="auth-divider-container">
            <div className="auth-line"></div>
            <div className="auth-divider-text">ou</div>
            <div className="auth-line"></div>
          </div>

          {error && <div className="auth-error-msg">{error}</div>}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
          >
            {loading ? 'Aguarde...' : (isLogin ? 'Entrar' : 'Registrar-se')}
          </button>
        </form>

        <div className="auth-footer-links">
          <button
            type="button"
            className="auth-switch-mode-btn"
            onClick={() => { setIsLogin(!isLogin); setError(''); }}
          >
            {isLogin ? 'Não tem conta? Cadastre-se' : 'Já possui uma conta? Faça Login'}
          </button>

          {isLogin && (
            <button type="button" className="auth-forgot-btn" onClick={handleResetPassword}>
              Esqueceu a senha?
            </button>
          )}
        </div>

      </div>
    </div>
  );
}