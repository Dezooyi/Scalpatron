import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTimesFmSettings } from './timesFmSettings.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerScript = path.join(projectRoot, 'scripts', 'timesfm_service.py');
const virtualEnvPython = path.join(projectRoot, '.venv-timesfm', 'bin', 'python');

let worker: ChildProcess | null = null;
let stopping = false;
let shutdownHooksInstalled = false;

function installShutdownHooks(): void {
  if (shutdownHooksInstalled) return;
  shutdownHooksInstalled = true;
  process.once('SIGINT', () => { stopTimesFmWorker(); process.exit(130); });
  process.once('SIGTERM', () => { stopTimesFmWorker(); process.exit(143); });
  process.once('exit', () => { stopTimesFmWorker(); });
}

/** Worker-Prozess stoppen. */
export function stopTimesFmWorker(): void {
  if (!worker) return;
  stopping = true;
  worker.kill('SIGTERM');
  worker = null;
}

export function isTimesFmWorkerRunning(): boolean {
  return worker !== null;
}

/** Installations-Voraussetzung: venv-Python vorhanden ODER externer Service konfiguriert. */
export function isTimesFmInstalled(): boolean {
  return fs.existsSync(virtualEnvPython) || Boolean(process.env.TIMESFM_URL);
}

/**
 * Startet den lokalen TimesFM-Worker, sofern das Feature aktiv ist und die
 * Voraussetzungen erfüllt sind (`.venv-timesfm/bin/python` oder externer
 * Service via TIMESFM_URL). Fehlt die Installation, wird einmalig ein Hinweis
 * auf `npm run timesfm:setup` geloggt — kein Crash, Fallback bleibt aktiv.
 */
export function startTimesFmWorker(): void {
  if (!getTimesFmSettings().enabled) return;
  if (worker) return;

  if (!fs.existsSync(workerScript)) {
    console.warn(`[TimesFM] Worker-Skript nicht gefunden: ${workerScript}`);
    return;
  }

  if (!fs.existsSync(virtualEnvPython)) {
    if (process.env.TIMESFM_URL) {
      console.log('[TimesFM] Externer Worker via TIMESFM_URL konfiguriert — kein lokaler Start nötig.');
      return;
    }
    console.warn('[TimesFM] Nicht installiert — TimesFM bleibt inaktiv. Voraussetzung: `npm run timesfm:setup` (Einstellungen → TimesFM).');
    return;
  }

  const python = virtualEnvPython;
  worker = spawn(python, [workerScript], {
    cwd: projectRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  worker.stdout?.on('data', data => {
    process.stdout.write(`[TimesFM] ${data}`);
  });
  worker.stderr?.on('data', data => {
    process.stderr.write(`[TimesFM] ${data}`);
  });
  worker.on('error', error => {
    console.error(`[TimesFM] Worker konnte nicht gestartet werden: ${error.message}`);
    worker = null;
    stopping = false;
  });
  worker.on('exit', (code, signal) => {
    if (!stopping && (code !== 0 || signal !== null)) {
      console.error(`[TimesFM] Worker beendet (code=${code ?? '-'}, signal=${signal ?? '-'}). Fallback aktiv.`);
    }
    worker = null;
    stopping = false;
  });

  installShutdownHooks();
  console.log(`[TimesFM] Lokaler Worker wird gestartet (${python}).`);
}
