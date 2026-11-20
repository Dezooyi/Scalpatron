#!/usr/bin/env node
/**
 * Startet den TimesFM-Worker manuell (plattformübergreifend).
 * Normalerweise übernimmt das Backend den Start automatisch —
 * dieses Skript ist für Debugging/Standalone-Betrieb gedacht.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const venvPython = process.platform === 'win32'
  ? path.join(ROOT, '.venv-timesfm', 'Scripts', 'python.exe')
  : path.join(ROOT, '.venv-timesfm', 'bin', 'python');
const workerScript = path.join(ROOT, 'scripts', 'timesfm_service.py');

const python = fs.existsSync(venvPython) ? venvPython : 'python3';
if (!fs.existsSync(venvPython)) {
  console.warn('[timesfm] venv nicht gefunden — Fallback auf systemweites python3.');
}

const child = spawn(python, [workerScript], { cwd: ROOT, stdio: 'inherit' });
child.on('error', (e) => {
  console.error(`[timesfm] Worker-Start fehlgeschlagen: ${e.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
