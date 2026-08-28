/**
 * Firebase App Hosting entrypoint.
 * Cloud Run health-checks PORT (8080) on 0.0.0.0. `npm start` used to run
 * functions/index.js, which is a Cloud Functions module and does not bind that way.
 */
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");

const PORT = Number(process.env.PORT) || 8080;
const HOST = "0.0.0.0";
const DIST = path.join(__dirname, "dist");
const API_HOST = process.env.API_HOST || "us-central1-fantasy-football-manager-210cc.cloudfunctions.net";
const API_PREFIX = process.env.API_PREFIX || "/leagueapi";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function sendFile(res, file, fallback) {
  fs.readFile(file, (err, data) => {
    if (err) {
      if (fallback) return sendFile(res, fallback, null);
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function proxyApi(req, res) {
  const headers = { ...req.headers, host: API_HOST };
  delete headers.connection;
  const opts = {
    hostname: API_HOST,
    path: API_PREFIX + (req.url || "/"),
    method: req.method,
    headers,
  };
  const up = https.request(opts, (incoming) => {
    res.writeHead(incoming.statusCode || 502, incoming.headers);
    incoming.pipe(res);
  });
  up.on("error", (err) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "API proxy failed: " + err.message }));
  });
  req.pipe(up);
}

const indexHtml = path.join(DIST, "index.html");
const server = http.createServer((req, res) => {
  const url = req.url || "/";
  if (url.startsWith("/api")) return proxyApi(req, res);

  const rel = decodeURIComponent(url.split("?")[0] || "/");
  let file = path.normalize(path.join(DIST, rel === "/" ? "index.html" : rel));
  if (!file.startsWith(DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) return sendFile(res, file, indexHtml);
    sendFile(res, indexHtml, null);
  });
});

server.listen(PORT, HOST, () => {
  console.log("League HQ App Hosting listening on http://" + HOST + ":" + PORT);
});
