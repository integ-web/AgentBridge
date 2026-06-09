/** Log severity levels. */
export enum LogLevel {
  Debug = 'debug',
  Info = 'info',
  Warn = 'warn',
  Error = 'error',
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevel.Debug]: 0,
  [LogLevel.Info]: 1,
  [LogLevel.Warn]: 2,
  [LogLevel.Error]: 3,
};

/** Patterns that should be redacted from log output. */
const REDACTION_PATTERNS = [
  /(?:password|passwd|pwd)\s*[=:]\s*\S+/gi,
  /(?:token|bearer|api[_-]?key|secret)\s*[=:]\s*\S+/gi,
  /(?:authorization)\s*[=:]\s*\S+/gi,
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, // base64 tokens
];

/**
 * Structured logger with redaction support.
 * Redacts secrets, tokens, and sensitive patterns from all output.
 */
export class Logger {
  constructor(
    private readonly name: string,
    private minLevel: LogLevel = LogLevel.Info,
  ) {}

  setLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.Debug, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.Info, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.Warn, message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log(LogLevel.Error, message, data);
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      logger: this.name,
      message: this.redact(message),
      ...(data ? { data: this.redactObject(data) } : {}),
    };

    const output = JSON.stringify(entry);

    switch (level) {
      case LogLevel.Error:
        console.error(output);
        break;
      case LogLevel.Warn:
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  private redact(text: string): string {
    let result = text;
    for (const pattern of REDACTION_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  private redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes('password') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('token') ||
        lowerKey.includes('key') ||
        lowerKey.includes('authorization')
      ) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'string') {
        result[key] = this.redact(value);
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.redactObject(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}

/**
 * Create a named logger instance.
 */
export function createLogger(name: string, level?: LogLevel): Logger {
  return new Logger(name, level);
}
