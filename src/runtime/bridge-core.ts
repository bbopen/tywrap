import type { BridgeInfo } from '../types/index.js';

import { BridgeExecutionError, BridgeProtocolError, BridgeTimeoutError } from './errors.js';
import { TYWRAP_PROTOCOL, TYWRAP_PROTOCOL_VERSION } from './protocol.js';
import { TimedOutRequestTracker } from './timed-out-request-tracker.js';

export type RpcMethod = 'call' | 'instantiate' | 'call_method' | 'dispose_instance' | 'meta';

export interface RpcRequest {
  id: number;
  protocol: string;
  method: RpcMethod;
  params: unknown;
}

export interface RpcResponse<T = unknown> {
  id: number;
  protocol: string;
  result?: T;
  error?: { type: string; message: string; traceback?: string };
}

export interface BridgeCoreTransport {
  write: (data: string) => void;
}

export interface BridgeCoreOptions {
  timeoutMs: number;
  maxLineLength?: number;
  maxStderrBytes?: number;
  protocol?: string;
  protocolVersion?: number;
  decodeValue?: (value: unknown) => Promise<unknown>;
  onFatalError?: (error: BridgeProtocolError) => void;
  onTimeout?: (error: BridgeTimeoutError) => void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer?: NodeJS.Timeout;
}

// Why: keep stdout lines bounded to prevent unbounded memory growth on malformed output.
const DEFAULT_MAX_LINE_LENGTH = 1024 * 1024; // 1MB
// Why: keep stderr snapshots small but useful for diagnostics on timeouts/exits.
const DEFAULT_MAX_STDERR_BYTES = 8 * 1024; // 8KB

const defaultDecodeValue = async (value: unknown): Promise<unknown> => value;
const noop = (): void => {};
const ANSI_ESCAPE_RE = new RegExp('\\u001b\\[[0-9;]*[A-Za-z]', 'g');
const CONTROL_CHARS_RE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F\\u0080-\\u009F]',
  'g'
);
const sanitizeStderr = (value: string): string =>
  value.replace(ANSI_ESCAPE_RE, '').replace(CONTROL_CHARS_RE, '');

export class BridgeCore {
  private readonly transport: BridgeCoreTransport;
  private readonly options: Required<BridgeCoreOptions>;
  private readonly timedOutRequests: TimedOutRequestTracker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private stdoutBuffer = '';
  private stderrBuffer = '';
  private protocolError = false;

  constructor(transport: BridgeCoreTransport, options: BridgeCoreOptions) {
    this.transport = transport;
    this.options = {
      timeoutMs: options.timeoutMs,
      maxLineLength: options.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH,
      maxStderrBytes: options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
      protocol: options.protocol ?? TYWRAP_PROTOCOL,
      protocolVersion: options.protocolVersion ?? TYWRAP_PROTOCOL_VERSION,
      decodeValue: options.decodeValue ?? defaultDecodeValue,
      onFatalError: options.onFatalError ?? noop,
      onTimeout: options.onTimeout ?? noop,
    };
    this.timedOutRequests = new TimedOutRequestTracker({
      ttlMs: Math.max(1000, this.options.timeoutMs * 2),
    });
  }

  getStderrTail(): string {
    return this.stderrBuffer.trim();
  }

  getPendingCount(): number {
    return this.pending.size;
  }

  clear(): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
    }
    this.pending.clear();
    this.timedOutRequests.clear();
    this.stdoutBuffer = '';
    this.stderrBuffer = '';
    this.protocolError = false;
  }

  async send<T>(payload: Omit<RpcRequest, 'id' | 'protocol'>): Promise<T> {
    const id = this.nextId++;
    const message: RpcRequest = { ...payload, id, protocol: this.options.protocol } as RpcRequest;
    let text: string;
    try {
      text = JSON.stringify(message);
    } catch (err) {
      throw new BridgeProtocolError(
        `Failed to serialize request: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    let timer: NodeJS.Timeout | undefined;
    const promise = new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        this.pending.delete(id);
        this.timedOutRequests.mark(id);
        const stderrTail = this.getStderrTail();
        const msg = stderrTail
          ? `Python call timed out. Recent stderr from Python:\n${stderrTail}`
          : 'Python call timed out';
        const timeoutError = new BridgeTimeoutError(msg);
        reject(timeoutError);
        this.options.onTimeout(timeoutError);
      }, this.options.timeoutMs);

      const resolveWrapped = (value: unknown): void => {
        resolve(value as T);
      };
      this.pending.set(id, { resolve: resolveWrapped, reject, timer });
    });

    try {
      this.transport.write(`${text}\n`);
    } catch (err) {
      const failure = new BridgeProtocolError(
        `IPC failure: ${err instanceof Error ? err.message : String(err)}`
      );
      this.failRequest(id, failure);
      this.handleFatalError(failure);
    }

    return promise;
  }

  handleStdoutData(chunk: Buffer | string): void {
    this.stdoutBuffer += chunk.toString();

    if (
      this.stdoutBuffer.length > this.options.maxLineLength &&
      !this.stdoutBuffer.includes('\n')
    ) {
      const snippet = this.stdoutBuffer.slice(0, this.options.maxLineLength);
      this.stdoutBuffer = '';
      this.handleProtocolError(
        `Response line exceeded ${this.options.maxLineLength} bytes`,
        snippet
      );
      return;
    }

    let idx: number;
    while ((idx = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, idx);
      this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);

      if (!line.trim()) {
        continue;
      }

      if (line.length > this.options.maxLineLength) {
        const snippet = line.slice(0, this.options.maxLineLength);
        this.handleProtocolError(
          `Response line exceeded ${this.options.maxLineLength} bytes`,
          snippet
        );
        return;
      }

      this.handleResponseLine(line);
    }
  }

  handleStderrData(chunk: Buffer | string): void {
    try {
      this.stderrBuffer += sanitizeStderr(chunk.toString());
      if (this.stderrBuffer.length > this.options.maxStderrBytes) {
        this.stderrBuffer = this.stderrBuffer.slice(
          this.stderrBuffer.length - this.options.maxStderrBytes
        );
      }
    } catch {
      // Ignore stderr buffering errors
    }
  }

  handleProcessExit(): void {
    const stderrTail = this.getStderrTail();
    const msg = stderrTail
      ? `Python process exited. Stderr:\n${stderrTail}`
      : 'Python process exited';
    this.rejectAll(new BridgeProtocolError(msg));
  }

  handleProcessError(err: Error): void {
    const msg = `Python process error: ${err.message}`;
    const error = new BridgeProtocolError(msg);
    this.rejectAll(error);
    this.handleFatalError(error);
  }

  private handleResponseLine(line: string): void {
    let msg: RpcResponse;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.handleProtocolError('Invalid response payload', line);
        return;
      }
      msg = parsed as RpcResponse;
    } catch (err) {
      const parseMessage = err instanceof Error ? err.message : String(err);
      this.handleProtocolError(`Invalid JSON: ${parseMessage}`, line);
      return;
    }

    if (msg.protocol !== this.options.protocol) {
      this.handleProtocolError(
        `Invalid protocol. Expected ${this.options.protocol} but received ${String(msg.protocol)}`,
        line
      );
      return;
    }

    if (typeof msg.id !== 'number') {
      this.handleProtocolError('Invalid response id', line);
      return;
    }

    const pending = this.pending.get(msg.id);
    if (!pending) {
      if (this.timedOutRequests.consume(msg.id)) {
        return;
      }
      this.handleProtocolError(`Unexpected response id ${msg.id}`, line);
      return;
    }

    this.pending.delete(msg.id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    if (msg.error) {
      pending.reject(this.errorFrom(msg.error));
      return;
    }

    Promise.resolve(this.options.decodeValue(msg.result))
      .then(decoded => pending.resolve(decoded))
      .catch(err => {
        pending.reject(
          new BridgeProtocolError(
            `Failed to decode Python response: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      });
  }

  private errorFrom(err: { type: string; message: string; traceback?: string }): Error {
    const error = new BridgeExecutionError(`${err.type}: ${err.message}`);
    error.traceback = err.traceback;
    return error;
  }

  private failRequest(id: number, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.reject(error);
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(error);
    }
    this.pending.clear();
    this.timedOutRequests.clear();
  }

  private handleProtocolError(details: string, line?: string): void {
    if (this.protocolError) {
      return;
    }
    this.protocolError = true;
    const snippet = line ? (line.length > 500 ? `${line.slice(0, 500)}...` : line) : undefined;
    const hint =
      'Ensure your Python code does not print to stdout and that the bridge outputs only JSON lines.';
    const msg = snippet
      ? `Protocol error from Python bridge. ${details}\n${hint}\nOffending line: ${snippet}`
      : `Protocol error from Python bridge. ${details}\n${hint}`;
    const error = new BridgeProtocolError(msg);
    this.rejectAll(error);
    this.handleFatalError(error);
  }

  private handleFatalError(error: BridgeProtocolError): void {
    try {
      this.options.onFatalError(error);
    } catch {
      // Ignore callback failures
    }
  }
}

export function validateBridgeInfo(info: unknown): void {
  if (!info || typeof info !== 'object') {
    throw new BridgeProtocolError('Invalid bridge info payload');
  }
  const candidate = info as BridgeInfo;
  if (
    candidate.protocol !== TYWRAP_PROTOCOL ||
    candidate.protocolVersion !== TYWRAP_PROTOCOL_VERSION
  ) {
    throw new BridgeProtocolError('Invalid bridge info payload');
  }
  if (candidate.bridge !== 'python-subprocess') {
    throw new BridgeProtocolError(`Unexpected bridge identifier: ${candidate.bridge}`);
  }
}

export function getPathKey(...envs: Array<Record<string, string | undefined>>): string {
  for (const env of envs) {
    const key = findPathKey(env);
    if (key) {
      return key;
    }
  }
  return 'PATH';
}

export function ensurePythonEncoding(env: NodeJS.ProcessEnv): void {
  if (env.PYTHONUTF8 === undefined || env.PYTHONUTF8 === null || env.PYTHONUTF8 === '') {
    env.PYTHONUTF8 = '1';
  }
  if (
    env.PYTHONIOENCODING === undefined ||
    env.PYTHONIOENCODING === null ||
    env.PYTHONIOENCODING === ''
  ) {
    env.PYTHONIOENCODING = 'UTF-8';
  }
}

export function ensureJsonFallback(env: NodeJS.ProcessEnv, enabled: boolean): void {
  if (enabled && !env.TYWRAP_CODEC_FALLBACK) {
    env.TYWRAP_CODEC_FALLBACK = 'json';
  }
}

export function getMaxLineLengthFromEnv(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.TYWRAP_CODEC_MAX_BYTES?.trim();
  if (!raw) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

export function normalizeEnv(
  baseEnv: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
): NodeJS.ProcessEnv {
  // Why: normalize PATH casing (Windows) and drop undefined values to avoid spawn surprises.
  const overridePathKey = findPathKey(overrides);
  const basePathKey = findPathKey(baseEnv);
  const pathKey = basePathKey ?? overridePathKey ?? 'PATH';
  let pathValue: string | undefined;
  if (overridePathKey !== null) {
    // eslint-disable-next-line security/detect-object-injection -- env keys are dynamic by design
    pathValue = overrides[overridePathKey];
  } else if (basePathKey) {
    // eslint-disable-next-line security/detect-object-injection -- env keys are dynamic by design
    pathValue = baseEnv[basePathKey];
  }
  const merged: Record<string, string | undefined> = { ...baseEnv, ...overrides };

  const result: NodeJS.ProcessEnv = {};

  if (pathValue !== undefined) {
    // eslint-disable-next-line security/detect-object-injection -- env keys are dynamic by design
    result[pathKey] = pathValue;
  }

  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) {
      continue;
    }
    if (key.toLowerCase() === 'path') {
      continue;
    }
    // eslint-disable-next-line security/detect-object-injection -- env keys are dynamic by design
    result[key] = value;
  }

  return result;
}

function findPathKey(env: Record<string, string | undefined>): string | null {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'path') {
      return key;
    }
  }
  return null;
}
