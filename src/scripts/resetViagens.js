// scripts/resetViagens.js
// Executa reset de viagens ativas. Pode ser chamado via cron ou Cloud Function.

const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Firestore limita batch a 500 operações. Deixamos margem de segurança.
const TAMANHO_BATCH = 450;

async function resetViagens() {
  console.log("[Reset] Iniciando reset de viagens ativas...");

  try {
    // ============ 1. LIMPAR viagemAtualId DOS USUÁRIOS ============
    // Pega apenas quem realmente tem viagem ativa (evita reescrever milhares de docs)
    const usuariosSnapshot = await db
      .collection("usuarios")
      .where("viagemAtualId", "!=", null)
      .get();

    let countUsuarios = 0;
    let batch = db.batch();
    let opsNoBatch = 0;

    for (const doc of usuariosSnapshot.docs) {
      batch.update(doc.ref, { viagemAtualId: null });
      opsNoBatch++;
      countUsuarios++;

      if (opsNoBatch >= TAMANHO_BATCH) {
        await batch.commit();
        batch = db.batch();
        opsNoBatch = 0;
      }
    }

    if (opsNoBatch > 0) await batch.commit();

    console.log(
      `[Reset] viagemAtualId resetado para ${countUsuarios} usuários.`,
    );

    // ============ 2. DELETAR TODAS AS VIAGENS ATIVAS ============
    const viagensSnapshot = await db.collection("viagens_ativas").get();

    let countViagens = 0;
    batch = db.batch();
    opsNoBatch = 0;

    for (const doc of viagensSnapshot.docs) {
      batch.delete(doc.ref);
      opsNoBatch++;
      countViagens++;

      if (opsNoBatch >= TAMANHO_BATCH) {
        await batch.commit();
        batch = db.batch();
        opsNoBatch = 0;
      }
    }

    if (opsNoBatch > 0) await batch.commit();

    console.log(`[Reset] ${countViagens} viagens ativas removidas.`);
    console.log("[Reset] Processo concluído com sucesso!");
  } catch (error) {
    console.error("[Reset] Erro durante o reset:", error);
    throw error;
  }
}

if (require.main === module) {
  resetViagens()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = { resetViagens };
