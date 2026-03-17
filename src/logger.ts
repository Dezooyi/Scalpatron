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
  }

  getEntries(): TradeLogEntry[] {
    return this.entries;
  }

  getLastN(n: number): TradeLogEntry[] {
    return this.entries.slice(-n);
  }

  private loadExisting(): void {
    if (!fs.existsSync(this.logFile)) return;
    const lines = fs.readFileSync(this.logFile, 'utf-8').trim().split('\n').filter(Boolean);
    this.entries = lines.map(l => JSON.parse(l) as TradeLogEntry);
  }
}
