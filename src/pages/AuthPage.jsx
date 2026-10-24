// pages/AuthPage.jsx
import React, { useState } from 'react';
import { auth } from '../services/firebase';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail
} from 'firebase/auth';
import { VisibilityIcon, VisibilityOffIcon } from '../components/icons';
import './AuthPage.css';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);        // true: login, false: cadastro
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    setInfo('');
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
      let msg = '';
      switch (err.code) {
        case 'auth/user-not-found':
          msg = 'Usuário não encontrado.';
          break;
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
          msg = 'E-mail ou senha incorretos.';
          break;
        case 'auth/email-already-in-use':
          msg = 'E-mail já cadastrado.';
          break;
        case 'auth/invalid-email':
          msg = 'E-mail inválido.';
          break;
        case 'auth/weak-password':
          msg = 'Senha fraca (mínimo 6 caracteres).';
          break;
        default:
          msg = 'Verifique os dados informados.';
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async () => {
    setError('');
    setInfo('');
    if (!email) {
      setError('Digite seu e-mail no campo acima para recuperar a senha.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setInfo(`Enviamos um e-mail de recuperação para ${email}.`);
    } catch (err) {
      setError('Não foi possível enviar o e-mail de recuperação.');
    }
  };

  return (
    <div className="auth-page-bg">
      <div className="auth-page-container">

        <img
          src="/buslogo.svg"
          alt="Busepel"
          className="auth-logo-svg"
        />

        <div className="auth-header">
          <h1 className="auth-title">{isLogin ? 'Entrar' : 'Criar conta'}</h1>
          <p className="auth-subtitle">
            {isLogin
              ? 'Acompanhe os ônibus da UFPel em tempo real.'
              : 'Crie sua conta para acompanhar os ônibus da UFPel.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-input-group">
            <label className="auth-label" htmlFor="auth-email">E-mail</label>
            <input
              id="auth-email"
              type="email"
              className="auth-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className="auth-input-group">
            <label className="auth-label" htmlFor="auth-password">Senha</label>
            <div className="auth-password-wrapper">
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                className="auth-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={isLogin ? 'current-password' : 'new-password'}
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                aria-pressed={showPassword}
              >
                {showPassword ? <VisibilityOffIcon aria-hidden="true" /> : <VisibilityIcon aria-hidden="true" />}
              </button>
            </div>
          </div>

          {isLogin && (
            <button type="button" className="auth-forgot-btn" onClick={handleResetPassword}>
              Esqueceu a senha?
            </button>
          )}

          {error && <div className="auth-error-msg" role="alert">{error}</div>}
          {info && <div className="auth-info-msg" role="status">{info}</div>}

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
          >
            {loading ? 'Aguarde...' : (isLogin ? 'Entrar' : 'Criar conta')}
          </button>
        </form>

        <div className="auth-footer-links">
          <span className="auth-footer-text">
            {isLogin ? 'Ainda não tem conta?' : 'Já tem conta?'}
          </span>
          <button
            type="button"
            className="auth-secondary-btn"
            onClick={() => { setIsLogin(!isLogin); setError(''); setInfo(''); }}
          >
            {isLogin ? 'Criar conta' : 'Entrar'}
          </button>
        </div>

      </div>
    </div>
  );
}