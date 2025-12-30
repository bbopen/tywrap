/**
 * Structured Logger for tywrap
 * Provides log levels, optional JSON output, and component context
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'SILENT';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
};

export interface LogContext {
  [key: string]: unknown;
}

export interface LoggerOptions {
  /** Minimum log level to output. Default: 'WARN' */
  level?: LogLevel;
  /** Component name for context (e.g., 'Cache', 'Worker'). */
  component?: string;
  /** Output logs as JSON. Default: false */
  jsonOutput?: boolean;
  /** Enable/disable logging. Default: true */
  enabled?: boolean;
  /** Output stream. Default: process.stderr */
  output?: NodeJS.WritableStream;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** Create a child logger with a component prefix */
  child(component: string): Logger;
  /** Check if a log level is enabled */
  isLevelEnabled(level: LogLevel): boolean;
  /** Update logger options */
  configure(options: Partial<LoggerOptions>): void;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  component?: string;
  message: string;
  context?: LogContext;
}

function getEnvLogLevel(): LogLevel | undefined {
  if (typeof process === 'undefined' || !process.env) {
    return undefined;
  }
  const envLevel = process.env.TYWRAP_LOG_LEVEL?.toUpperCase();
  if (envLevel && envLevel in LOG_LEVEL_PRIORITY) {
    return envLevel as LogLevel;
  }
  return undefined;
}

function getEnvJsonOutput(): boolean {
  if (typeof process === 'undefined' || !process.env) {
    return false;
  }
  return process.env.TYWRAP_LOG_JSON === 'true' || process.env.TYWRAP_LOG_JSON === '1';
}

function formatHumanReadable(entry: LogEntry): string {
  const componentPart = entry.component ? ` [${entry.component}]` : '';
  const contextPart =
    entry.context && Object.keys(entry.context).length > 0
      ? ` ${JSON.stringify(entry.context)}`
      : '';
  return `${entry.timestamp} [${entry.level}]${componentPart} ${entry.message}${contextPart}`;
}

function formatJson(entry: LogEntry): string {
  const output: Record<string, unknown> = {
    ts: entry.timestamp,
    level: entry.level,
  };
  if (entry.component) {
    output.component = entry.component;
  }
  output.msg = entry.message;
  if (entry.context && Object.keys(entry.context).length > 0) {
    Object.assign(output, entry.context);
  }
  return JSON.stringify(output);
}

class LoggerImpl implements Logger {
  private level: LogLevel;
  private component?: string;
  private jsonOutput: boolean;
  private enabled: boolean;
  private output: NodeJS.WritableStream;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? getEnvLogLevel() ?? 'WARN';
    this.component = options.component;
    this.jsonOutput = options.jsonOutput ?? getEnvJsonOutput();
    this.enabled = options.enabled ?? true;
    this.output =
      options.output ??
      (typeof process !== 'undefined'
        ? process.stderr
        : (undefined as unknown as NodeJS.WritableStream));
  }

  configure(options: Partial<LoggerOptions>): void {
    if (options.level !== undefined) {
      this.level = options.level;
    }
    if (options.component !== undefined) {
      this.component = options.component;
    }
    if (options.jsonOutput !== undefined) {
      this.jsonOutput = options.jsonOutput;
    }
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
    if (options.output !== undefined) {
      this.output = options.output;
    }
  }

  isLevelEnabled(level: LogLevel): boolean {
    if (!this.enabled) {
      return false;
    }
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    // Early exit for performance - avoid string operations when disabled
    if (!this.isLevelEnabled(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      component: this.component,
      message,
      context,
    };

    const formatted = this.jsonOutput ? formatJson(entry) : formatHumanReadable(entry);

    if (this.output) {
      this.output.write(`${formatted}\n`);
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('DEBUG', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('WARN', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('ERROR', message, context);
  }

  child(component: string): Logger {
    const childComponent = this.component ? `${this.component}:${component}` : component;

    return new LoggerImpl({
      level: this.level,
      component: childComponent,
      jsonOutput: this.jsonOutput,
      enabled: this.enabled,
      output: this.output,
    });
  }
}

/** Global logger instance */
export const logger: Logger = new LoggerImpl();

/** Create a new logger with custom options */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new LoggerImpl(options);
}

/**
 * Create component-specific loggers
 * Usage: const log = getComponentLogger('Cache');
 */
export function getComponentLogger(component: string): Logger {
  return logger.child(component);
}
