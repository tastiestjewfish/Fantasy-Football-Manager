/**
 * Firebase App Hosting entrypoint.
 * Cloud Run health-checks PORT (8080) on 0.0.0.0.
 * Serves the Vite dist SPA and handles /api in-process via the Express app.
 */
const path = require("path");
const express = require("express");
const { app: apiApp } = require("./functions");

const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";
const DIST = path.join(__dirname, "dist");

const server = express();

server.use((req, res, next) => {
  if (req.path.startsWith("/api")) return apiApp(req, res, next);
  next();
});

server.use(express.static(DIST));
server.get("*", (_req, res) => {
  res.sendFile(path.join(DIST, "index.html"));
});

server.listen(PORT, HOST, () => {
  console.log("League HQ App Hosting listening on http://" + HOST + ":" + PORT);
});
