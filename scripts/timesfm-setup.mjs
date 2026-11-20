#!/usr/bin/env node
/**
 * TimesFM-Setup (plattformübergreifend).
 *
 * Erstellt `.venv-timesfm` und installiert `requirements-timesfm.txt`.
 * Funktioniert auf Linux/macOS (venv: bin/python) und Windows
 * (venv: Scripts/python.exe); sucht einen Interpreter in der Reihenfolge
 * python3 → python → py -3.
 *
 *   node scripts/timesfm-setup.mjs
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENV_DIR = path.join(ROOT, '.venv-timesfm');

/** Pfad des Python-Interpreters im venv (plattformabhängig). */
export function venvPythonPath(venvDir = VENV_DIR) {
  return process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'python.exe')
    : path.join(venvDir, 'bin', 'python');
}

function run(cmd, args, label) {
  console.log(`[timesfm-setup] ${label}: ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (r.error || r.status !== 0) {
    console.error(`[timesfm-setup] ❌ ${label} fehlgeschlagen (${r.error?.message ?? `code=${r.status}`}).`);
    process.exit(1);
  }
}

function findPython() {
  const candidates = [
    { cmd: 'python3', args: ['--version'] },
    { cmd: 'python', args: ['--version'] },
    { cmd: 'py', args: ['-3', '--version'] },
  ];
  for (const c of candidates) {
    const r = spawnSync(c.cmd, c.args, { stdio: 'pipe', shell: false });
    if (!r.error && r.status === 0) {
      const prefix = c.cmd === 'py' ? ['-3'] : [];
      console.log(`[timesfm-setup] Interpreter gefunden: ${c.cmd} (${String(r.stdout || r.stderr).trim()})`);
      return { cmd: c.cmd, prefix };
    }
  }
  return null;
}

const venvPython = venvPythonPath();

if (fs.existsSync(venvPython)) {
  console.log(`[timesfm-setup] venv vorhanden: ${venvPython} — installiere/aktualisiere nur Pakete.`);
} else {
  const py = findPython();
  if (!py) {
    console.error('[timesfm-setup] ❌ Kein Python-Interpreter gefunden (python3/python/py). Bitte Python 3.10+ installieren.');
    process.exit(1);
  }
  run(py.cmd, [...py.prefix, '-m', 'venv', VENV_DIR], 'venv erstellen');
}

run(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], 'pip aktualisieren');
run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements-timesfm.txt'], 'TimesFM-Abhängigkeiten installieren');

console.log('[timesfm-setup] ✅ Fertig. Worker startet automatisch mit dem Backend, wenn TimesFM aktiviert ist.');
