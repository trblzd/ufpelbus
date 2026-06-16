import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache } from "firebase/firestore";

// ==================== CONFIGURAÇÃO DO FIREBASE ====================
// As variáveis de ambiente são definidas no arquivo .env
// VITE_* é o prefixo necessário para expor variáveis ao Vite
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY, // Chave pública da API
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, // Domínio para autenticação
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, // ID do projeto no Firebase
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET, // Bucket para arquivos
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID, // ID do sender
  appId: import.meta.env.VITE_FIREBASE_APP_ID, // ID do aplicativo
};

// ==================== INICIALIZAÇÃO ====================

// Inicializa o aplicativo Firebase com a configuração
const app = initializeApp(firebaseConfig);

/**
 * Inicializa o Firestore com CACHE PERSISTENTE
 *
 * persistentLocalCache(): Mantém os dados do Firestore salvos no IndexedDB do navegador
 * Benefícios:
 * - Permite acesso offline aos dados já carregados
 * - Reduz drasticamente leituras de rede
 * - Melhora performance em recarregamentos de página
 * - Economiza custos do Firebase (menos leituras)
 */
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache(),
});

/**
 * Autenticação do Firebase
 * Gerencia login/cadastro/recuperação de senha
 * Suporta: email/senha, Google, etc.
 */
export const auth = getAuth(app);
