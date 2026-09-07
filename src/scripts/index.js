const functions = require("firebase-functions");
const { resetViagens } = require("./resetViagens"); // ou importe do caminho certo

exports.resetViagensAgendado = functions.pubsub
  .schedule("0 3 * * *")
  .timeZone("America/Sao_Paulo")
  .onRun(async (context) => {
    await resetViagens();
    return null;
  });
