import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Writable } from 'stream';
import { logger, createLogger, getComponentLogger, type Logger, type LogLevel } from '../src/utils/logger.js';

describe('Logger', () => {
  let output: string[];
  let mockStream: Writable;

  beforeEach(() => {
    output = [];
    mockStream = new Writable({
      write(chunk, _encoding, callback) {
        output.push(chunk.toString().trim());
        callback();
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('createLogger', () => {
    it('creates a logger with default options', () => {
      const log = createLogger({ output: mockStream });
      expect(log).toBeDefined();
      expect(log.isLevelEnabled('WARN')).toBe(true);
      expect(log.isLevelEnabled('ERROR')).toBe(true);
    });

    it('respects custom log level', () => {
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      expect(log.isLevelEnabled('DEBUG')).toBe(true);
      expect(log.isLevelEnabled('INFO')).toBe(true);
      expect(log.isLevelEnabled('WARN')).toBe(true);
      expect(log.isLevelEnabled('ERROR')).toBe(true);
    });

    it('respects SILENT level', () => {
      const log = createLogger({ level: 'SILENT', output: mockStream });
      expect(log.isLevelEnabled('DEBUG')).toBe(false);
      expect(log.isLevelEnabled('INFO')).toBe(false);
      expect(log.isLevelEnabled('WARN')).toBe(false);
      expect(log.isLevelEnabled('ERROR')).toBe(false);
    });

    it('respects enabled flag', () => {
      const log = createLogger({ level: 'DEBUG', enabled: false, output: mockStream });
      expect(log.isLevelEnabled('DEBUG')).toBe(false);
      expect(log.isLevelEnabled('ERROR')).toBe(false);
    });
  });

  describe('logging methods', () => {
    it('logs debug messages when level is DEBUG', () => {
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      log.debug('test debug message');
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('[DEBUG]');
      expect(output[0]).toContain('test debug message');
    });

    it('logs info messages when level is INFO or lower', () => {
      const log = createLogger({ level: 'INFO', output: mockStream });
      log.info('test info message');
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('[INFO]');
      expect(output[0]).toContain('test info message');
    });

    it('logs warn messages when level is WARN or lower', () => {
      const log = createLogger({ level: 'WARN', output: mockStream });
      log.warn('test warn message');
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('[WARN]');
      expect(output[0]).toContain('test warn message');
    });

    it('logs error messages when level is ERROR or lower', () => {
      const log = createLogger({ level: 'ERROR', output: mockStream });
      log.error('test error message');
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('[ERROR]');
      expect(output[0]).toContain('test error message');
    });

    it('does not log debug messages when level is WARN', () => {
      const log = createLogger({ level: 'WARN', output: mockStream });
      log.debug('should not appear');
      log.info('should not appear either');
      expect(output).toHaveLength(0);
    });

    it('does not log when disabled', () => {
      const log = createLogger({ level: 'DEBUG', enabled: false, output: mockStream });
      log.debug('test');
      log.info('test');
      log.warn('test');
      log.error('test');
      expect(output).toHaveLength(0);
    });
  });

  describe('context', () => {
    it('includes context in log messages', () => {
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      log.debug('message with context', { userId: 123, action: 'test' });
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('userId');
      expect(output[0]).toContain('123');
      expect(output[0]).toContain('action');
      expect(output[0]).toContain('test');
    });

    it('handles empty context', () => {
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      log.debug('message without context', {});
      expect(output).toHaveLength(1);
      expect(output[0]).not.toContain('{}');
    });

    it('handles undefined context', () => {
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      log.debug('message without context');
      expect(output).toHaveLength(1);
    });
  });

  describe('component context', () => {
    it('includes component in log messages', () => {
      const log = createLogger({ level: 'DEBUG', component: 'Cache', output: mockStream });
      log.debug('cache operation');
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('[Cache]');
    });

    it('creates child logger with component', () => {
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      const childLog = log.child('Worker');
      childLog.debug('worker message');
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('[Worker]');
    });

    it('nests child component names', () => {
      const log = createLogger({ level: 'DEBUG', component: 'Runtime', output: mockStream });
      const childLog = log.child('Worker');
      childLog.debug('nested message');
      expect(output).toHaveLength(1);
      expect(output[0]).toContain('[Runtime:Worker]');
    });
  });

  describe('JSON output', () => {
    it('outputs JSON when jsonOutput is true', () => {
      const log = createLogger({ level: 'DEBUG', jsonOutput: true, output: mockStream });
      log.debug('json message');
      expect(output).toHaveLength(1);
      const parsed = JSON.parse(output[0]!);
      expect(parsed.level).toBe('DEBUG');
      expect(parsed.msg).toBe('json message');
      expect(parsed.ts).toBeDefined();
    });

    it('includes component in JSON output', () => {
      const log = createLogger({ level: 'DEBUG', jsonOutput: true, component: 'Cache', output: mockStream });
      log.debug('json with component');
      const parsed = JSON.parse(output[0]!);
      expect(parsed.component).toBe('Cache');
    });

    it('includes context fields in JSON output', () => {
      const log = createLogger({ level: 'DEBUG', jsonOutput: true, output: mockStream });
      log.debug('json with context', { key: 'value', num: 42 });
      const parsed = JSON.parse(output[0]!);
      expect(parsed.key).toBe('value');
      expect(parsed.num).toBe(42);
    });
  });

  describe('configure', () => {
    it('allows reconfiguring log level', () => {
      const log = createLogger({ level: 'ERROR', output: mockStream });
      expect(log.isLevelEnabled('WARN')).toBe(false);

      log.configure({ level: 'DEBUG' });
      expect(log.isLevelEnabled('WARN')).toBe(true);
      expect(log.isLevelEnabled('DEBUG')).toBe(true);
    });

    it('allows enabling/disabling', () => {
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      log.configure({ enabled: false });
      log.debug('should not appear');
      expect(output).toHaveLength(0);

      log.configure({ enabled: true });
      log.debug('should appear');
      expect(output).toHaveLength(1);
    });

    it('allows changing to JSON output', () => {
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      log.debug('human readable');
      expect(() => JSON.parse(output[0]!)).toThrow();

      log.configure({ jsonOutput: true });
      log.debug('json output');
      expect(() => JSON.parse(output[1]!)).not.toThrow();
    });
  });

  describe('environment variables', () => {
    it('respects TYWRAP_LOG_LEVEL environment variable', () => {
      vi.stubEnv('TYWRAP_LOG_LEVEL', 'DEBUG');
      const log = createLogger({ output: mockStream });
      expect(log.isLevelEnabled('DEBUG')).toBe(true);
    });

    it('respects TYWRAP_LOG_JSON environment variable', () => {
      vi.stubEnv('TYWRAP_LOG_JSON', 'true');
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      log.debug('test');
      expect(() => JSON.parse(output[0]!)).not.toThrow();
    });

    it('handles invalid TYWRAP_LOG_LEVEL gracefully', () => {
      vi.stubEnv('TYWRAP_LOG_LEVEL', 'INVALID');
      const log = createLogger({ output: mockStream });
      // Should fall back to default (WARN)
      expect(log.isLevelEnabled('WARN')).toBe(true);
      expect(log.isLevelEnabled('INFO')).toBe(false);
    });
  });

  describe('getComponentLogger', () => {
    it('creates a component-specific logger', () => {
      const log = getComponentLogger('TestComponent');
      expect(log).toBeDefined();
    });
  });

  describe('global logger', () => {
    it('exports a global logger instance', () => {
      expect(logger).toBeDefined();
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.child).toBe('function');
    });
  });

  describe('timestamp format', () => {
    it('includes ISO timestamp in human-readable output', () => {
      const log = createLogger({ level: 'DEBUG', output: mockStream });
      log.debug('test');
      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      expect(output[0]).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });

    it('includes ISO timestamp in JSON output', () => {
      const log = createLogger({ level: 'DEBUG', jsonOutput: true, output: mockStream });
      log.debug('test');
      const parsed = JSON.parse(output[0]!);
      expect(parsed.ts).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });
  });

  describe('performance', () => {
    it('does not call string operations when level is disabled', () => {
      const log = createLogger({ level: 'ERROR', output: mockStream });
      const contextGenerator = vi.fn(() => ({ expensive: 'computation' }));

      // This should not execute the context generator since DEBUG is disabled
      if (log.isLevelEnabled('DEBUG')) {
        log.debug('test', contextGenerator());
      }

      expect(contextGenerator).not.toHaveBeenCalled();
    });
  });
});
