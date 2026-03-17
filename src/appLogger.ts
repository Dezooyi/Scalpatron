import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(__dirname, '..', 'logs');

export type LogLevel = 'INF' | 'WRN' | 'ACT' | 'ERR' | 'SYS';

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  botId: string;
  source: string;
  message: string;
  data?: any;
}

export class AppLogger {
  private static instance: AppLogger;
  private logFilePath: string;
  private sseCallback: ((entry: LogEntry) => void) | null = null;

  private constructor() {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    this.logFilePath = path.join(LOG_DIR, 'app_system.log');
  }

  public static getInstance(): AppLogger {
    if (!AppLogger.instance) {
      AppLogger.instance = new AppLogger();
    }
    return AppLogger.instance;
  }

  public setSSECallback(callback: (entry: LogEntry) => void) {
    this.sseCallback = callback;
  }

  public log(level: LogLevel, botId: string, source: string, message: string, data?: any) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      botId,
      source,
      message,
      data
    };

    // Print to console
    const color = this.getLevelColor(level);
    console.log(`${color}[${level}] [${source}] [${botId.slice(0, 4)}] ${message}\x1b[0m`);

    // Write to file (append)
    try {
      fs.appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n', 'utf-8');
    } catch (e) {
      console.error('[Logger] Failed to write to log file:', e);
    }

    // Forward to SSE clients via server callback
    if (this.sseCallback) {
      this.sseCallback(entry);
    }
  }

  private getLevelColor(level: LogLevel): string {
    switch (level) {
      case 'INF': return '\x1b[34m'; // Blue
      case 'WRN': return '\x1b[33m'; // Yellow
      case 'ACT': return '\x1b[35m'; // Purple
      case 'ERR': return '\x1b[31m'; // Red
      case 'SYS': return '\x1b[36m'; // Cyan
      default: return '\x1b[0m';
    }
  }

  // Helper methods
  public info(botId: string, source: string, message: string, data?: any) { this.log('INF', botId, source, message, data); }
  public warn(botId: string, source: string, message: string, data?: any) { this.log('WRN', botId, source, message, data); }
  public action(botId: string, source: string, message: string, data?: any) { this.log('ACT', botId, source, message, data); }
  public error(botId: string, source: string, message: string, data?: any) { this.log('ERR', botId, source, message, data); }
  public system(message: string, data?: any) { this.log('SYS', 'GLOBAL', 'SYSTEM', message, data); }
}

export const logger = AppLogger.getInstance();
