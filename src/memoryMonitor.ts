// Memory Monitoring — Long-Running Process Diagnostics
// Loggt process.memoryUsage() periodisch und schreibt Heap-Snapshots
// bei RSS-Schwellenwerten oder (auf Unix) auf SIGUSR2.
// Siehe ADR/Doku: Diagnose-First-Ansatz fuer Speicher-Lecks.

import { writeHeapSnapshot } from 'node:v8';
import fs from 'node:fs';
import path from 'node:path';

const MB = 1024 * 1024;

export interface MemoryStats {
  timestamp: number;
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  arrayBuffersMB: number;
}

export interface MemoryMonitorOptions {
  /** Log-Intervall in ms (Default 60s). */
  intervalMs?: number;
  /** Verzeichnis fuer Heap-Snapshots (Default logs/heapdumps). */
  heapSnapshotDir?: string;
  /** RSS in MB, ab dem automatisch ein Snapshot geschrieben wird (Default: deaktiviert). */
  autoSnapshotRssMB?: number;
  /** Optionaler Hook (z. B. fuer SSE-Broadcast der Stats). */
  onTick?: (stats: MemoryStats) => void;
}

function snapshotDirOrDefault(dir?: string): string {
  const resolved = dir ?? path.join(process.cwd(), 'logs', 'heapdumps');
  if (!fs.existsSync(resolved)) {
    fs.mkdirSync(resolved, { recursive: true });
  }
  return resolved;
}

export function writeHeapSnapshotToDir(dir?: string): string | null {
  const target = snapshotDirOrDefault(dir);
  try {
    const file = path.join(target, `heap-${Date.now()}.heapsnapshot`);
    const out = writeHeapSnapshot(file);
    console.log(`[Memory] Heap-Snapshot geschrieben: ${out}`);
    return out;
  } catch (e) {
    console.error(`[Memory] Heap-Snapshot fehlgeschlagen:`, (e as Error).message);
    return null;
  }
}

export function readMemoryStats(): MemoryStats {
  const m = process.memoryUsage();
  return {
    timestamp: Date.now(),
    rssMB: +(m.rss / MB).toFixed(1),
    heapUsedMB: +(m.heapUsed / MB).toFixed(1),
    heapTotalMB: +(m.heapTotal / MB).toFixed(1),
    externalMB: +(m.external / MB).toFixed(1),
    arrayBuffersMB: +(m.arrayBuffers / MB).toFixed(1),
  };
}

/**
 * Startet das periodische Memory-Monitoring.
 * - Protokolliert RSS/Heap/External alle `intervalMs`.
 * - Schreibt automatisch Heap-Snapshots, wenn RSS einen Schwellenwert ueberschreitet
 *   (jeweils +100 MB-Raster, damit nicht bei jedem Tick ein Snapshot entsteht).
 * - Auf Nicht-Windows-Systemen: zusaetzlich Snapshot auf SIGUSR2.
 */
export function startMemoryMonitor(options: MemoryMonitorOptions = {}): void {
  const intervalMs = options.intervalMs ?? 60_000;
  const snapshotDir = options.heapSnapshotDir ?? snapshotDirOrDefault();
  const snapshotStep = 100; // naechster Auto-Snapshot erst 100 MB hoeher
  let nextSnapshotThreshold = options.autoSnapshotRssMB ?? Infinity;

  const tick = (): void => {
    const stats = readMemoryStats();
    console.log(
      `[Memory] rss=${stats.rssMB}MB | heapUsed=${stats.heapUsedMB}MB` +
      ` | heapTotal=${stats.heapTotalMB}MB | external=${stats.externalMB}MB` +
      ` | arrayBuffers=${stats.arrayBuffersMB}MB`
    );
    options.onTick?.(stats);

    if (Number.isFinite(nextSnapshotThreshold) && stats.rssMB >= nextSnapshotThreshold) {
      writeHeapSnapshotToDir(snapshotDir);
      nextSnapshotThreshold += snapshotStep;
    }
  };

  const interval = setInterval(tick, intervalMs);
  interval.unref();

  // SIGUSR2 ist auf Windows nicht verfuegbar.
  if (process.platform !== 'win32') {
    try {
      process.on('SIGUSR2', () => writeHeapSnapshotToDir(snapshotDir));
    } catch {
      /* Signal-Handler nicht registrierbar — ignorieren */
    }
  }

  tick(); // sofortige Initialmessung
}
