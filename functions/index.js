/**
 * Cloud Functions entry (1st gen). Express app lives in ./app.js.
 */
const functionsV1 = require("firebase-functions/v1");
const { app, startLocal } = require("./app");

exports.app = app;
exports.startLocal = startLocal;
exports.hqv1 = functionsV1
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "512MB", secrets: ["ANTHROPIC_API_KEY"], invoker: "public" })
  .https.onRequest(app);
exports.hqlive = functionsV1
  .region("us-central1")
  .runWith({ timeoutSeconds: 120, memory: "512MB", secrets: ["ANTHROPIC_API_KEY"], invoker: "public" })
  .https.onRequest(app);

if (require.main === module) startLocal();
