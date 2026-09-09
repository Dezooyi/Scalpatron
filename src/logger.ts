import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '..', 'logs');

export interface TradeLogEntry {
  timestamp: number;
  action: 'BUY' | 'SELL';
  price: number;
  floor: number;
  spikePercent: number;
  peakPrice: number;
  pnlPercent?: number;
  amount?: number;
  settings: Record<string, number>;
}

export class Logger {
  // In-Memory-Cap: Trades sind in SQLite persistiert (source of truth); die
  // JSONL-Datei dient als Audit-Log. Der In-Memory-Spiegel muss nicht die ganze
  // Historie halten — ohne Cap wächst entries[] über Prozess-Lebensdauer linear
  // und jeder Logger-Aufbau parst die komplette Datei erneut in den Heap.
  public static readonly MAX_ENTRIES = 20_000;
  private logFile: string;
  private entries: TradeLogEntry[] = [];

  constructor(filename = 'trades.jsonl') {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    this.logFile = path.join(LOG_DIR, filename);
    this.loadExisting();
  }

  log(entry: TradeLogEntry): void {
    this.entries.push(entry);
    fs.appendFileSync(this.logFile, JSON.stringify(entry) + '\n', 'utf-8');
    // Begrenzt halten — älteste Einträge zuerst verwerfen.
    if (this.entries.length > Logger.MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - Logger.MAX_ENTRIES);
    }
  }

  getEntries(): TradeLogEntry[] {
    return this.entries;
  }

  getLastN(n: number): TradeLogEntry[] {
    return this.entries.slice(-n);
  }

  private loadExisting(): void {
    if (!fs.existsSync(this.logFile)) return;
    // Tail-Read statt Voll-Datei: nur die letzten MAX_ENTRIES Zeilen parsen.
    const lines = fs.readFileSync(this.logFile, 'utf-8').trim().split('\n').filter(Boolean).slice(-Logger.MAX_ENTRIES);
    this.entries = lines.map(l => JSON.parse(l) as TradeLogEntry);
  }
}
