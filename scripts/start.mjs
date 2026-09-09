#!/usr/bin/env node
/**
 * Scalpatron — sicherer Ein-Befehl-Start für Backend + Frontend.
 *
 *   npm run up              # startet alles und öffnet den Browser
 *   npm run up -- --no-open # ohne Browser öffnen
 *   npm run up -- --help
 *
 * Eigenschaften:
 *  - Liest den Backend-Port aus der Root-.env (PORT, Default 3000).
 *  - Erkennt bereits laufende Scalpatron-Instanzen (Backend: /api/bots als
 *    JSON-Array; Frontend: Vite-Index mit <div id="root">) und startet sie
 *    nicht doppelt.
 *  - Startet fehlende Dienste, wartet auf echte Bereitschaft und richtet den
 *    Vite-Proxy auf den tatsächlich gebundenen Backend-Port (auch bei
 *    Port-Fallback des Backends).
 *  - Öffnet den Browser erst, wenn beide Dienste antworten.
 *  - Räumt beim Beenden (Ctrl+C/SIGTERM) die Kindprozesse auf.
 *  - Logs: getaggte Konsolenausgabe ([backend]/[frontend]) + Logdateien unter
 *    logs/dev-*.log.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, 'logs');
const DEFAULT_BACKEND_PORT = 3000;
const DEFAULT_VITE_PORT = 5173;
const READY_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 800;

const noOpen = process.argv.includes('--no-open');
const help = process.argv.includes('--help') || process.argv.includes('-h');

if (help) {
  console.log(`Usage: npm run up [-- --no-open]
  Startet Backend (src/index.ts) + Frontend (Vite) und öffnet den Browser.
  --no-open  Browser nicht automatisch öffnen.
`);
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* kleine Helfer                                                       */
/* ------------------------------------------------------------------ */

function readDotEnv(file) {
  const out = {};
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* keine .env vorhanden */
  }
  return out;
}

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, '');
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function resetLogFile(file) {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  try { fs.writeFileSync(file, ''); } catch { /* optional */ }
}

/** HTTP-Probe: antwortet der Server auf dem Port? (jeder Status = erreichbar) */
function httpProbe(port, probePath = '/') {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: probePath, timeout: PROBE_TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({ ok: true, status: res.statusCode, body });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false }); });
    req.on('error', () => resolve({ ok: false }));
  });
}

async function isScalpatronBackend(port) {
  if (!Number.isInteger(port) || port <= 0) return false;
  const r = await httpProbe(port, '/api/bots');
  if (!r.ok || r.status !== 200) return false;
  try {
    const parsed = JSON.parse(r.body);
    return Array.isArray(parsed);
  } catch {
    return false;
  }
}

async function isScalpatronFrontend(port) {
  const r = await httpProbe(port, '/');
  return Boolean(r.ok && r.status === 200 && r.body.includes('id="root"'));
}

function logTag(tag, line) {
  if (!line) return;
  for (const l of line.split('\n')) {
    const t = l.trimEnd();
    if (t) console.log(`[${tag}] ${t}`);
  }
}

function pipeOutput(child, tag, logFile) {
  const append = (d) => {
    const text = d.toString('utf-8');
    try { fs.appendFileSync(logFile, text); } catch { /* Log-Schreiben ist optional */ }
    const clean = stripAnsi(text);
    logTag(tag, clean);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
}

/* ------------------------------------------------------------------ */
/* Prozess-Management                                                  */
/* ------------------------------------------------------------------ */

const children = [];
const closing = { flag: false };

function spawnNpm(args, cwd, extraEnv = {}) {
  const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function killChildren() {
  for (const child of children) {
    if (!child.killed) {
      try { child.kill(); } catch { /* ignore */ }
    }
  }
}

function shutdown(code) {
  if (closing.flag) return;
  closing.flag = true;
  killChildren();
  process.exit(code);
}

process.on('SIGINT', () => {
  console.log('\n⏹  Beende Scalpatron (Ctrl+C)…');
  shutdown(130);
});
process.on('SIGTERM', () => shutdown(143));
process.on('exit', killChildren);
process.on('uncaughtException', (err) => {
  console.error('[start] Unerwarteter Fehler:', err);
  shutdown(1);
});

/** Wartet, bis ein Kindprozess beendet wurde (Exit-Promise). */
function waitChildExit(child) {
  return new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 1)));
}

/* ------------------------------------------------------------------ */
/* Dienste                                                             */
/* ------------------------------------------------------------------ */

async function ensureBackend(intendedPort) {
  const running = await isScalpatronBackend(intendedPort);
  if (running) {
    console.log(`[start] Backend läuft bereits auf Port ${intendedPort} — überspringe Start.`);
    return intendedPort;
  }
  if (await httpProbe(intendedPort, '/').then((r) => r.ok)) {
    console.warn(`[start] ⚠️  Port ${intendedPort} ist durch einen FREMDEN Dienst belegt.`);
    console.warn(`[start]    Das Backend weicht automatisch aus (Fallback). Bitte PORT in .env setzen, falls nötig.`);
  }

  console.log('[start] Starte Backend…');
  const backendLog = path.join(LOG_DIR, 'dev-backend.log');
  resetLogFile(backendLog);
  const child = spawnNpm(['run', 'start'], ROOT);
  pipeOutput(child, 'backend', backendLog);

  // Warte auf die "API gebunden an Port <n>"-Meldung im Log.
  const boundPort = await new Promise((resolve) => {
    let exitedEarly = false;
    child.once('exit', () => { exitedEarly = true; });
    let settled = false;
    const finish = (p) => { if (!settled) { settled = true; resolve(p); } };
    const timer = setTimeout(() => finish(null), READY_TIMEOUT_MS);
    child.stdout?.on('data', (d) => {
      const text = stripAnsi(d.toString('utf-8'));
      const m = text.match(/API gebunden an Port (\d+)/);
      if (m) { clearTimeout(timer); finish(Number(m[1])); }
    });
    child.stderr?.on('data', () => { /* Fehler werden schon geprefixt */ });
    // Prüfe regelmäßig zusätzlich per Probe, falls die Logzeile fehlt.
    const interval = setInterval(async () => {
      for (const p of [intendedPort, intendedPort + 1]) {
        if (await isScalpatronBackend(p)) { clearInterval(interval); clearTimeout(timer); finish(p); return; }
      }
      if (exitedEarly) { clearInterval(interval); clearTimeout(timer); finish(null); }
    }, 1500);
  });

  if (boundPort) {
    console.log(`[start] ✅ Backend bereit auf Port ${boundPort}.`);
    return boundPort;
  }
  console.error('[start] ❌ Backend wurde nicht rechtzeitig bereit. Details siehe logs/dev-backend.log.');
  shutdown(1);
}

async function ensureFrontend(backendPort) {
  const running = await isScalpatronFrontend(DEFAULT_VITE_PORT);
  if (running) {
    console.log(`[start] Frontend läuft bereits auf Port ${DEFAULT_VITE_PORT} — überspringe Start.`);
    return DEFAULT_VITE_PORT;
  }
  if (await httpProbe(DEFAULT_VITE_PORT, '/').then((r) => r.ok)) {
    console.warn(`[start] ⚠️  Port ${DEFAULT_VITE_PORT} ist durch einen FREMDEN Dienst belegt — Vite weicht aus.`);
  }

  console.log('[start] Starte Frontend (Vite)…');
  // Explizite PORT-Umgebung hat im Vite-Config Vorrang vor .env → Proxy folgt
  // dem tatsächlich gebundenen Backend-Port.
  const frontendLog = path.join(LOG_DIR, 'dev-frontend.log');
  resetLogFile(frontendLog);
  const child = spawnNpm(['run', 'dev'], path.join(ROOT, 'frontend'), { PORT: String(backendPort) });
  pipeOutput(child, 'frontend', frontendLog);

  const vitePort = await new Promise((resolve) => {
    let exitedEarly = false;
    child.once('exit', () => { exitedEarly = true; });
    let settled = false;
    const finish = (p) => { if (!settled) { settled = true; resolve(p); } };
    const timer = setTimeout(() => finish(null), READY_TIMEOUT_MS);
    child.stdout?.on('data', (d) => {
      const text = stripAnsi(d.toString('utf-8'));
      const m = text.match(/Local:\s+http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
      if (m) { clearTimeout(timer); finish(Number(m[1])); }
    });
    const interval = setInterval(async () => {
      if (await isScalpatronFrontend(DEFAULT_VITE_PORT)) {
        clearInterval(interval); clearTimeout(timer); finish(DEFAULT_VITE_PORT); return;
      }
      for (const p of [DEFAULT_VITE_PORT + 1, DEFAULT_VITE_PORT + 2]) {
        if (await isScalpatronFrontend(p)) {
          clearInterval(interval); clearTimeout(timer); finish(p); return;
        }
      }
      if (exitedEarly) { clearInterval(interval); clearTimeout(timer); finish(null); }
    }, 1500);
  });

  if (vitePort) {
    console.log(`[start] ✅ Frontend bereit auf Port ${vitePort}.`);
    return vitePort;
  }
  console.error('[start] ❌ Frontend wurde nicht rechtzeitig bereit. Details siehe logs/dev-frontend.log.');
  shutdown(1);
}

function openBrowser(url) {
  if (noOpen) {
    console.log(`[start] Browser-Öffnen übersprungen (--no-open). URL: ${url}`);
    return;
  }
  const platform = process.platform;
  let cmd; let args;
  if (platform === 'win32') {
    cmd = 'cmd'; args = ['/c', 'start', '""', url];
  } else if (platform === 'darwin') {
    cmd = 'open'; args = [url];
  } else {
    cmd = 'xdg-open'; args = [url];
  }
  const opener = spawn(cmd, args, { stdio: 'ignore', detached: true });
  opener.on('error', () => {
    console.warn(`[start] ⚠️  Browser konnte nicht automatisch geöffnet werden. Bitte manuell öffnen: ${url}`);
  });
  opener.unref();
}

/* ------------------------------------------------------------------ */
/* Hauptablauf                                                         */
/* ------------------------------------------------------------------ */

async function main() {
  const dotEnv = readDotEnv(path.join(ROOT, '.env'));
  const intendedPort = Number(process.env.PORT ?? dotEnv.PORT ?? DEFAULT_BACKEND_PORT);

  console.log('── Scalpatron Dev-Start ─────────────────────────────');
  console.log(`[start] Backend-Port (Ziel): ${intendedPort}`);

  const backendPort = await ensureBackend(intendedPort);
  const vitePort = await ensureFrontend(backendPort);

  const url = `http://localhost:${vitePort}`;
  console.log('─────────────────────────────────────────────────────');
  console.log(`[start] 🚀 Bereit: ${url}`);
  console.log('[start] Beenden mit Ctrl+C.');
  console.log('─────────────────────────────────────────────────────');
  openBrowser(url);

  // Läuft, bis ein Dienst stirbt oder der Nutzer abbricht.
  if (children.length === 0) {
    // Alles war bereits aktiv — nach kurzem Delay sauber beenden.
    setTimeout(() => {
      console.log('[start] ✅ Beide Dienste waren bereits aktiv — Start-Skript beendet.');
      process.exit(0);
    }, 800);
    return;
  }
  await Promise.race(children.map(waitChildExit));
  console.error('[start] ❌ Ein Dienst wurde beendet — stoppe den Rest.');
  shutdown(1);
}

main().catch((err) => {
  console.error('[start] Fehler:', err);
  shutdown(1);
});
