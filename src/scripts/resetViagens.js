// scripts/resetViagens.js
// Executa reset de viagens ativas. Pode ser chamado via cron ou Cloud Function.

const admin = require("firebase-admin");

// Inicializa o Firebase Admin SDK (se não estiver inicializado)
if (!admin.apps.length) {
  // Se estiver rodando localmente, você precisa das credenciais.
  // Para Cloud Functions, o SDK já está inicializado.
  // Para teste local, descomente e configure:
  // const serviceAccount = require('./caminho-para-sua-chave.json');
  // admin.initializeApp({
  //   credential: admin.credential.cert(serviceAccount),
  //   projectId: 'seu-project-id'
  // });
  // Caso contrário, use as variáveis de ambiente padrão:
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Reseta todas as viagens ativas:
 * 1. Remove o campo 'viagemAtualId' de todos os usuários
 * 2. Deleta todos os documentos da coleção 'viagens_ativas'
 */
async function resetViagens() {
  console.log("[Reset] Iniciando reset de viagens ativas...");

  try {
    // 1. Resetar campo viagemAtualId de todos os usuários
    const usuariosSnapshot = await db.collection("usuarios").get();
    const batch = db.batch();
    let countUsuarios = 0;

    usuariosSnapshot.forEach((doc) => {
      const data = doc.data();
      if (data.viagemAtualId) {
        batch.update(doc.ref, { viagemAtualId: null });
        countUsuarios++;
      }
    });

    await batch.commit();
    console.log(
      `[Reset] viagemAtualId resetado para ${countUsuarios} usuários.`,
    );

    // 2. Deletar todas as viagens ativas
    const viagensSnapshot = await db.collection("viagens_ativas").get();
    const batchViagens = db.batch();
    let countViagens = 0;

    viagensSnapshot.forEach((doc) => {
      batchViagens.delete(doc.ref);
      countViagens++;
    });

    await batchViagens.commit();
    console.log(`[Reset] ${countViagens} viagens ativas removidas.`);

    console.log("[Reset] Processo concluído com sucesso!");
  } catch (error) {
    console.error("[Reset] Erro durante o reset:", error);
    throw error;
  }
}

// Se executado diretamente (node script.js)
if (require.main === module) {
  resetViagens()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { resetViagens };
