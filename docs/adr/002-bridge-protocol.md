# ADR-002: BridgeProtocol - Unified Boundary Crossing Abstraction

## Status

**Accepted** (Fully implemented)

### Implementation Progress

- ✅ Phase 1: SafeCodec (TypeScript + Python)
- ✅ Phase 2: Transport interface + ProcessIO, HttpIO, PyodideIO
- ✅ Phase 3: WorkerPool (PooledTransport)
- ✅ BridgeProtocol base class
- ✅ Phase 4: Bridge migration (NodeBridge, HttpBridge, PyodideBridge)
- ✅ Phase 5: Cleanup and documentation

## Context

After implementing `BoundedContext` (ADR-001/PR #150), which unified lifecycle management, error classification, and bounded execution across all bridges, we identified ~30 remaining issues that share a common theme: **inconsistent handling of the JS↔Python boundary**.

These issues fall into three categories:

1. **Data Validation** (10 issues): NaN/Infinity handling, type coercion, edge cases
2. **Transport Reliability** (11 issues): Stream errors, backpressure, process recovery
3. **Resource Management** (9 issues): Worker pools, concurrency, timers

The root cause is that each bridge implements boundary crossing differently, leading to:
- Inconsistent validation (some validate args, some don't)
- Inconsistent serialization (different edge case handling)
- Inconsistent error handling (despite BoundedContext's `classifyError`)
- Duplicated transport logic (each bridge manages its own I/O)

## Decision

Introduce **BridgeProtocol**, an abstraction layer that standardizes all boundary crossing concerns by combining:

1. **BoundedContext** (existing) - Lifecycle, error classification, bounded execution
2. **SafeCodec** (new) - Validation and serialization on both JS and Python sides
3. **Transport** (new) - Abstract I/O channel with concrete implementations

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BridgeProtocol                                 │
│                    (extends BoundedContext)                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                           SafeCodec                                  │   │
│  │  ┌─────────────────────┐           ┌─────────────────────┐          │   │
│  │  │   Request Pipeline  │           │  Response Pipeline  │          │   │
│  │  │  ┌───────────────┐  │           │  ┌───────────────┐  │          │   │
│  │  │  │ validateArgs  │  │           │  │ deserialize   │  │          │   │
│  │  │  └───────┬───────┘  │           │  └───────┬───────┘  │          │   │
│  │  │  ┌───────▼───────┐  │           │  ┌───────▼───────┐  │          │   │
│  │  │  │ serialize     │  │           │  │ validateResult│  │          │   │
│  │  │  └───────────────┘  │           │  └───────────────┘  │          │   │
│  │  └─────────────────────┘           └─────────────────────┘          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                           Transport                                  │   │
│  │                                                                      │   │
│  │    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │   │
│  │    │  ProcessIO   │  │   HttpIO     │  │  PyodideIO   │             │   │
│  │    │  (streams)   │  │   (fetch)    │  │  (memory)    │             │   │
│  │    └──────────────┘  └──────────────┘  └──────────────┘             │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     WorkerPool (optional)                            │   │
│  │           (manages multiple Transport instances)                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Detailed Design

### 1. SafeCodec

SafeCodec provides bidirectional validation and serialization with explicit edge case handling.

#### 1.1 TypeScript Side

```typescript
// src/runtime/safe-codec.ts

import {
  assertNoSpecialFloats,
  containsSpecialFloat,
  ValidationError,
} from './validators.js';
import { BridgeProtocolError } from './errors.js';

export interface CodecOptions {
  /** Reject NaN/Infinity in arguments. Default: true */
  rejectSpecialFloats?: boolean;
  /** Reject non-string keys in objects. Default: true */
  rejectNonStringKeys?: boolean;
  /** Max payload size in bytes. Default: 10MB */
  maxPayloadBytes?: number;
  /** How to handle bytes/bytearray. Default: 'base64' */
  bytesHandling?: 'base64' | 'reject' | 'passthrough';
}

export class SafeCodec {
  private readonly options: Required<CodecOptions>;

  constructor(options: CodecOptions = {}) {
    this.options = {
      rejectSpecialFloats: options.rejectSpecialFloats ?? true,
      rejectNonStringKeys: options.rejectNonStringKeys ?? true,
      maxPayloadBytes: options.maxPayloadBytes ?? 10 * 1024 * 1024,
      bytesHandling: options.bytesHandling ?? 'base64',
    };
  }

  /**
   * Validate and encode a request payload.
   * Called before sending to Python.
   */
  encodeRequest(message: unknown): string {
    // 1. Validate against special floats
    if (this.options.rejectSpecialFloats) {
      this.assertNoSpecialFloats(message, 'request');
    }

    // 2. Validate object keys
    if (this.options.rejectNonStringKeys) {
      this.assertStringKeys(message, 'request');
    }

    // 3. Serialize with size check
    const json = this.safeStringify(message);

    if (json.length > this.options.maxPayloadBytes) {
      throw new BridgeProtocolError(
        `Request payload exceeds ${this.options.maxPayloadBytes} bytes`
      );
    }

    return json;
  }

  /**
   * Decode and validate a response payload.
   * Called after receiving from Python.
   */
  decodeResponse<T>(payload: string): T {
    // 1. Size check
    if (payload.length > this.options.maxPayloadBytes) {
      throw new BridgeProtocolError(
        `Response payload exceeds ${this.options.maxPayloadBytes} bytes`
      );
    }

    // 2. Parse JSON
    let decoded: unknown;
    try {
      decoded = JSON.parse(payload);
    } catch (e) {
      throw new BridgeProtocolError(
        `Invalid JSON in response: ${e instanceof Error ? e.message : e}`,
        { cause: e }
      );
    }

    // 3. Handle protocol-level errors
    if (this.isErrorResponse(decoded)) {
      throw this.createErrorFromResponse(decoded);
    }

    // 4. Apply decoders (Arrow, custom types)
    const result = this.applyDecoders(decoded);

    // 5. Validate no special floats leaked through
    if (this.options.rejectSpecialFloats && containsSpecialFloat(result)) {
      throw new BridgeProtocolError(
        'Response contains NaN or Infinity values'
      );
    }

    return result as T;
  }

  /**
   * Safe JSON.stringify that catches serialization errors.
   */
  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch (e) {
      throw new BridgeProtocolError(
        `Failed to serialize request: ${e instanceof Error ? e.message : e}`,
        { cause: e }
      );
    }
  }

  /**
   * Check for non-string keys in objects (recursive).
   */
  private assertStringKeys(value: unknown, context: string): void {
    if (value === null || typeof value !== 'object') return;

    if (Array.isArray(value)) {
      value.forEach((item, i) => this.assertStringKeys(item, `${context}[${i}]`));
      return;
    }

    // Map objects have non-string keys
    if (value instanceof Map) {
      for (const key of value.keys()) {
        if (typeof key !== 'string') {
          throw new BridgeProtocolError(
            `${context} contains non-string key: ${typeof key}`
          );
        }
      }
    }

    // Check nested
    for (const [key, val] of Object.entries(value)) {
      this.assertStringKeys(val, `${context}.${key}`);
    }
  }

  private assertNoSpecialFloats(value: unknown, context: string): void {
    if (containsSpecialFloat(value)) {
      throw new BridgeProtocolError(
        `${context} contains NaN or Infinity values which cannot be serialized to JSON`
      );
    }
  }

  private isErrorResponse(value: unknown): value is { error: unknown } {
    return (
      value !== null &&
      typeof value === 'object' &&
      'error' in value
    );
  }

  private createErrorFromResponse(response: { error: unknown }): BridgeProtocolError {
    const err = response.error;
    if (typeof err === 'object' && err !== null) {
      const { type, message, traceback } = err as Record<string, unknown>;
      const msg = typeof message === 'string' ? message : JSON.stringify(err);
      return new BridgeProtocolError(msg, {
        cause: { type, traceback },
      });
    }
    return new BridgeProtocolError(String(err));
  }

  private applyDecoders(value: unknown): unknown {
    // Delegate to existing decodeValue/decodeValueAsync
    // This handles Arrow format, custom type markers, etc.
    return value; // Placeholder - integrate with existing codec.ts
  }
}
```

#### 1.2 Python Side

```python
# runtime/safe_codec.py

import json
import math
from typing import Any
from decimal import Decimal
from datetime import datetime, date
from uuid import UUID
from pathlib import Path

class CodecError(Exception):
    """Raised when encoding/decoding fails."""
    pass

class SafeCodec:
    """
    Safe JSON codec with explicit edge case handling.
    """

    def __init__(
        self,
        allow_nan: bool = False,
        max_payload_bytes: int = 10 * 1024 * 1024,
    ):
        self.allow_nan = allow_nan
        self.max_payload_bytes = max_payload_bytes

    def encode(self, value: Any) -> str:
        """Encode a Python value to JSON string."""
        try:
            # Use custom encoder for special types
            result = json.dumps(
                value,
                default=self._default_encoder,
                allow_nan=self.allow_nan,
            )

            if len(result) > self.max_payload_bytes:
                raise CodecError(
                    f"Payload exceeds {self.max_payload_bytes} bytes"
                )

            return result

        except ValueError as e:
            if "out of range" in str(e).lower() or "nan" in str(e).lower():
                raise CodecError(
                    f"Cannot serialize value: {e}. "
                    "NaN and Infinity are not valid JSON."
                ) from e
            raise CodecError(f"Serialization failed: {e}") from e

    def decode(self, payload: str) -> Any:
        """Decode a JSON string to Python value."""
        if len(payload) > self.max_payload_bytes:
            raise CodecError(
                f"Payload exceeds {self.max_payload_bytes} bytes"
            )

        try:
            return json.loads(payload)
        except json.JSONDecodeError as e:
            raise CodecError(f"Invalid JSON: {e}") from e

    def _default_encoder(self, obj: Any) -> Any:
        """Handle special Python types."""
        # numpy/pandas scalars -> Python native
        if hasattr(obj, 'item'):
            native = obj.item()
            # Check for NaN/Inf after conversion
            if isinstance(native, float):
                if math.isnan(native) or math.isinf(native):
                    if not self.allow_nan:
                        raise ValueError(
                            f"Cannot serialize {native} - "
                            "NaN/Infinity not allowed"
                        )
            return native

        # datetime -> ISO string
        if isinstance(obj, datetime):
            return obj.isoformat()

        if isinstance(obj, date):
            return obj.isoformat()

        # Decimal -> string (preserve precision)
        if isinstance(obj, Decimal):
            return str(obj)

        # UUID -> string
        if isinstance(obj, UUID):
            return str(obj)

        # Path -> string
        if isinstance(obj, Path):
            return str(obj)

        # bytes -> base64
        if isinstance(obj, (bytes, bytearray)):
            import base64
            return {
                '__type__': 'bytes',
                'encoding': 'base64',
                'data': base64.b64encode(obj).decode('ascii'),
            }

        # Pydantic models
        if hasattr(obj, 'model_dump'):
            try:
                return obj.model_dump()
            except Exception as e:
                raise ValueError(
                    f"Pydantic model_dump failed: {e}"
                ) from e

        # Fallback
        raise TypeError(
            f"Object of type {type(obj).__name__} is not JSON serializable"
        )
```

### 2. Transport

Transport provides an abstract I/O channel with concrete implementations for different runtimes.

#### 2.1 Transport Interface

```typescript
// src/runtime/transport.ts

import type { Disposable } from './disposable.js';

/**
 * Protocol message format for all transports.
 */
export interface ProtocolMessage {
  id: string;
  type: 'call' | 'instantiate' | 'call_method' | 'dispose_instance';
  module?: string;
  functionName?: string;
  className?: string;
  handle?: string;
  methodName?: string;
  args: unknown[];
  kwargs?: Record<string, unknown>;
}

export interface ProtocolResponse {
  id: string;
  result?: unknown;
  error?: {
    type: string;
    message: string;
    traceback?: string;
  };
}

/**
 * Abstract transport for sending messages across the JS↔Python boundary.
 */
export interface Transport extends Disposable {
  /**
   * Send a message and wait for response.
   * @param message - The protocol message to send
   * @param timeoutMs - Timeout in milliseconds (0 = no timeout)
   * @param signal - Optional abort signal
   * @returns The raw response string
   */
  send(
    message: string,
    timeoutMs: number,
    signal?: AbortSignal
  ): Promise<string>;

  /**
   * Whether the transport is ready to send messages.
   */
  readonly isReady: boolean;
}
```

#### 2.2 ProcessIO Transport

```typescript
// src/runtime/process-io.ts

import { ChildProcess, spawn } from 'child_process';
import { BoundedContext } from './bounded-context.js';
import {
  BridgeProtocolError,
  BridgeTimeoutError,
  BridgeExecutionError,
} from './errors.js';
import type { Transport } from './transport.js';
import type { Disposable } from './disposable.js';

export interface ProcessIOOptions {
  /** Python executable path */
  pythonPath?: string;
  /** Path to the bridge script */
  bridgeScript: string;
  /** Maximum line length for responses */
  maxLineLength?: number;
  /** Restart process after N requests (0 = never) */
  restartAfterRequests?: number;
}

/**
 * ProcessIO wraps a child process with robust stream handling.
 *
 * Features:
 * - Backpressure-aware writes (respects drain events)
 * - Stream error handling (EPIPE, ECONNRESET)
 * - Automatic process restart on failures
 * - Line-based protocol framing
 */
export class ProcessIO extends BoundedContext implements Transport {
  private process?: ChildProcess;
  private readonly pendingRequests = new Map<
    string,
    {
      resolve: (value: string) => void;
      reject: (error: Error) => void;
      timer?: NodeJS.Timeout;
    }
  >();
  private buffer = '';
  private requestCount = 0;
  private writeQueue: Array<{ data: string; resolve: () => void; reject: (e: Error) => void }> = [];
  private isWriting = false;

  constructor(private readonly options: ProcessIOOptions) {
    super();
  }

  protected async doInit(): Promise<void> {
    await this.spawnProcess();
  }

  protected async doDispose(): Promise<void> {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(new BridgeExecutionError('Transport disposed'));
    }
    this.pendingRequests.clear();

    // Kill process
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
    }
  }

  get isReady(): boolean {
    return this.state === 'ready' && this.process !== undefined;
  }

  async send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    if (!this.isReady) {
      await this.init();
    }

    const id = this.extractMessageId(message);

    return new Promise<string>((resolve, reject) => {
      // Set up timeout
      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          this.pendingRequests.delete(id);
          reject(new BridgeTimeoutError(`Request timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      // Set up abort handler
      const abortHandler = () => {
        if (timer) clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(new BridgeTimeoutError('Request aborted'));
      };
      signal?.addEventListener('abort', abortHandler, { once: true });

      // Register pending request
      this.pendingRequests.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', abortHandler);
          resolve(value);
        },
        reject: (error) => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', abortHandler);
          reject(error);
        },
        timer,
      });

      // Queue the write
      this.queueWrite(message + '\n').catch(reject);
    });
  }

  private async spawnProcess(): Promise<void> {
    const pythonPath = this.options.pythonPath ?? 'python3';

    this.process = spawn(pythonPath, [this.options.bridgeScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Handle stdout (responses)
    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.handleStdout(chunk.toString());
    });

    // Handle stderr (errors/logs)
    this.process.stderr?.on('data', (chunk: Buffer) => {
      // Log or handle stderr
      console.error('[Python]', chunk.toString());
    });

    // Handle process errors
    this.process.on('error', (error) => {
      this.handleProcessError(error);
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.handleProcessExit(code, signal);
    });

    // Handle stdin errors (EPIPE, etc.)
    this.process.stdin?.on('error', (error) => {
      this.handleStdinError(error);
    });

    // Wait for ready signal or first response
    await this.waitForReady();
  }

  private async waitForReady(): Promise<void> {
    // Implementation: wait for Python to signal readiness
    // Could be a specific "ready" message or just assume ready after spawn
  }

  private handleStdout(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      this.handleResponseLine(line);
    }
  }

  private handleResponseLine(line: string): void {
    const maxLen = this.options.maxLineLength ?? 100 * 1024 * 1024;
    if (line.length > maxLen) {
      // Find the request ID if possible and reject it
      const idMatch = line.match(/"id"\s*:\s*"([^"]+)"/);
      if (idMatch) {
        const pending = this.pendingRequests.get(idMatch[1]);
        if (pending) {
          pending.reject(new BridgeProtocolError(`Response exceeds max line length: ${maxLen}`));
          this.pendingRequests.delete(idMatch[1]);
        }
      }
      return;
    }

    try {
      const response = JSON.parse(line) as { id: string };
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        pending.resolve(line);
        this.pendingRequests.delete(response.id);
        this.requestCount++;
        this.maybeRestartProcess();
      }
    } catch {
      // Invalid JSON - protocol error
      console.error('[ProcessIO] Invalid JSON response:', line.slice(0, 100));
    }
  }

  private handleProcessError(error: Error): void {
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new BridgeExecutionError(`Process error: ${error.message}`));
    }
    this.pendingRequests.clear();
  }

  private handleProcessExit(code: number | null, signal: string | null): void {
    this.process = undefined;

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(
        new BridgeExecutionError(
          `Process exited unexpectedly (code=${code}, signal=${signal})`
        )
      );
    }
    this.pendingRequests.clear();
  }

  private handleStdinError(error: Error): void {
    // EPIPE means the process closed stdin - it's probably dead
    if ((error as NodeJS.ErrnoException).code === 'EPIPE') {
      this.handleProcessError(new Error('Process stdin closed (EPIPE)'));
      // Restart process
      this.restartProcess();
    }
  }

  /**
   * Queue a write with backpressure handling.
   */
  private queueWrite(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.writeQueue.push({ data, resolve, reject });
      this.processWriteQueue();
    });
  }

  private processWriteQueue(): void {
    if (this.isWriting || this.writeQueue.length === 0) return;
    if (!this.process?.stdin?.writable) {
      // Reject all queued writes
      for (const item of this.writeQueue) {
        item.reject(new BridgeExecutionError('Process stdin not writable'));
      }
      this.writeQueue = [];
      return;
    }

    this.isWriting = true;
    const item = this.writeQueue.shift()!;

    const canContinue = this.process.stdin.write(item.data, (error) => {
      if (error) {
        item.reject(new BridgeExecutionError(`Write failed: ${error.message}`));
      } else {
        item.resolve();
      }
      this.isWriting = false;
      this.processWriteQueue();
    });

    // If write returned false, wait for drain before continuing
    if (!canContinue) {
      this.process.stdin.once('drain', () => {
        this.processWriteQueue();
      });
    }
  }

  private maybeRestartProcess(): void {
    const maxRequests = this.options.restartAfterRequests ?? 0;
    if (maxRequests > 0 && this.requestCount >= maxRequests) {
      this.restartProcess();
    }
  }

  private async restartProcess(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = undefined;
    }
    this.requestCount = 0;
    await this.spawnProcess();
  }

  private extractMessageId(message: string): string {
    const match = message.match(/"id"\s*:\s*"([^"]+)"/);
    if (!match) {
      throw new BridgeProtocolError('Message missing id field');
    }
    return match[1];
  }
}
```

#### 2.3 HttpIO Transport

```typescript
// src/runtime/http-io.ts

import { BoundedContext } from './bounded-context.js';
import { BridgeExecutionError, BridgeTimeoutError } from './errors.js';
import type { Transport } from './transport.js';

export interface HttpIOOptions {
  baseURL: string;
  headers?: Record<string, string>;
}

export class HttpIO extends BoundedContext implements Transport {
  constructor(private readonly options: HttpIOOptions) {
    super();
  }

  protected async doInit(): Promise<void> {
    // HTTP is stateless, nothing to init
  }

  protected async doDispose(): Promise<void> {
    // HTTP is stateless, nothing to dispose
  }

  get isReady(): boolean {
    return this.state === 'ready' || this.state === 'idle';
  }

  async send(message: string, timeoutMs: number, signal?: AbortSignal): Promise<string> {
    const controller = new AbortController();
    const combinedSignal = signal
      ? this.combineSignals(signal, controller.signal)
      : controller.signal;

    let timer: NodeJS.Timeout | undefined;
    if (timeoutMs > 0) {
      timer = setTimeout(() => controller.abort(), timeoutMs);
    }

    try {
      const response = await fetch(this.options.baseURL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.options.headers,
        },
        body: message,
        signal: combinedSignal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new BridgeExecutionError(`HTTP ${response.status}: ${text || response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BridgeTimeoutError(
          timeoutMs > 0
            ? `Request timed out after ${timeoutMs}ms`
            : 'Request aborted'
        );
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private combineSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
    const controller = new AbortController();
    const abort = () => controller.abort();
    s1.addEventListener('abort', abort);
    s2.addEventListener('abort', abort);
    return controller.signal;
  }

  // Required by RuntimeExecution but not used directly
  async call<T>(): Promise<T> { return {} as T; }
  async instantiate<T>(): Promise<T> { return {} as T; }
  async callMethod<T>(): Promise<T> { return {} as T; }
  async disposeInstance(): Promise<void> {}
}
```

### 3. WorkerPool

WorkerPool manages multiple Transport instances for concurrent request handling.

```typescript
// src/runtime/worker-pool.ts

import { BoundedContext } from './bounded-context.js';
import { BridgeTimeoutError, BridgeExecutionError } from './errors.js';
import type { Transport } from './transport.js';
import type { Disposable } from './disposable.js';

export interface WorkerPoolOptions {
  /** Factory function to create transports */
  createTransport: () => Transport;
  /** Maximum number of workers */
  maxWorkers: number;
  /** Timeout for waiting in queue (ms) */
  queueTimeoutMs?: number;
  /** Maximum concurrent requests per worker */
  maxConcurrentPerWorker?: number;
}

interface PooledWorker {
  transport: Transport;
  inFlightCount: number;
}

/**
 * WorkerPool manages a pool of Transport instances with:
 * - Semaphore-based concurrency control
 * - Configurable queue timeout
 * - Proper cleanup on dispose
 */
export class WorkerPool extends BoundedContext {
  private workers: PooledWorker[] = [];
  private readonly waitQueue: Array<{
    resolve: (worker: PooledWorker) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];

  constructor(private readonly options: WorkerPoolOptions) {
    super();
  }

  protected async doInit(): Promise<void> {
    // Create initial workers lazily on first request
  }

  protected async doDispose(): Promise<void> {
    // Reject all waiting requests
    for (const waiter of this.waitQueue) {
      clearTimeout(waiter.timer);
      waiter.reject(new BridgeExecutionError('Pool disposed'));
    }
    this.waitQueue.length = 0;

    // Dispose all workers
    for (const worker of this.workers) {
      await worker.transport.dispose();
    }
    this.workers = [];
  }

  /**
   * Acquire a worker from the pool.
   */
  async acquire(): Promise<PooledWorker> {
    // Try to find an available worker
    const available = this.findAvailableWorker();
    if (available) {
      available.inFlightCount++;
      return available;
    }

    // Try to create a new worker if under limit
    if (this.workers.length < this.options.maxWorkers) {
      const worker = await this.createWorker();
      worker.inFlightCount++;
      return worker;
    }

    // Wait for a worker to become available
    return this.waitForWorker();
  }

  /**
   * Release a worker back to the pool.
   */
  release(worker: PooledWorker): void {
    worker.inFlightCount--;

    // Check if anyone is waiting
    if (this.waitQueue.length > 0 && this.isWorkerAvailable(worker)) {
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timer);
      worker.inFlightCount++;
      waiter.resolve(worker);
    }
  }

  private findAvailableWorker(): PooledWorker | undefined {
    const maxConcurrent = this.options.maxConcurrentPerWorker ?? 1;
    return this.workers.find(w => w.inFlightCount < maxConcurrent);
  }

  private isWorkerAvailable(worker: PooledWorker): boolean {
    const maxConcurrent = this.options.maxConcurrentPerWorker ?? 1;
    return worker.inFlightCount < maxConcurrent;
  }

  private async createWorker(): Promise<PooledWorker> {
    const transport = this.options.createTransport();
    await transport.init();
    this.trackResource(transport);

    const worker: PooledWorker = {
      transport,
      inFlightCount: 0,
    };
    this.workers.push(worker);
    return worker;
  }

  private waitForWorker(): Promise<PooledWorker> {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.options.queueTimeoutMs ?? 30000;

      const timer = setTimeout(() => {
        const idx = this.waitQueue.findIndex(w => w.timer === timer);
        if (idx >= 0) {
          this.waitQueue.splice(idx, 1);
        }
        reject(new BridgeTimeoutError(`Timed out waiting for worker after ${timeoutMs}ms`));
      }, timeoutMs);

      // Use unref so the timer doesn't keep the process alive
      if (typeof timer === 'object' && 'unref' in timer) {
        (timer as NodeJS.Timeout).unref();
      }

      this.waitQueue.push({ resolve, reject, timer });
    });
  }

  // Required by RuntimeExecution
  async call<T>(): Promise<T> { return {} as T; }
  async instantiate<T>(): Promise<T> { return {} as T; }
  async callMethod<T>(): Promise<T> { return {} as T; }
  async disposeInstance(): Promise<void> {}
}
```

### 4. BridgeProtocol

BridgeProtocol ties everything together.

```typescript
// src/runtime/bridge-protocol.ts

import { BoundedContext, type ExecuteOptions } from './bounded-context.js';
import { SafeCodec, type CodecOptions } from './safe-codec.js';
import type { Transport, ProtocolMessage, ProtocolResponse } from './transport.js';
import { BridgeProtocolError } from './errors.js';

export interface BridgeProtocolOptions {
  transport: Transport;
  codec?: CodecOptions;
  defaultTimeoutMs?: number;
}

/**
 * BridgeProtocol combines BoundedContext + SafeCodec + Transport
 * into a unified abstraction for all JS↔Python communication.
 */
export abstract class BridgeProtocol extends BoundedContext {
  protected readonly codec: SafeCodec;
  protected readonly transport: Transport;
  protected readonly defaultTimeoutMs: number;
  private requestId = 0;

  constructor(options: BridgeProtocolOptions) {
    super();
    this.codec = new SafeCodec(options.codec);
    this.transport = options.transport;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30000;
    this.trackResource(this.transport);
  }

  protected async doInit(): Promise<void> {
    await this.transport.init();
  }

  protected async doDispose(): Promise<void> {
    // Transport is tracked and will be disposed by BoundedContext
  }

  /**
   * Send a protocol message and receive a typed response.
   */
  protected async sendMessage<T>(
    message: Omit<ProtocolMessage, 'id'>,
    options: ExecuteOptions<T> = {}
  ): Promise<T> {
    const fullMessage: ProtocolMessage = {
      ...message,
      id: this.generateId(),
    };

    return this.execute(async () => {
      // 1. Encode request (validates args)
      const encoded = this.codec.encodeRequest(fullMessage);

      // 2. Send via transport
      const responseStr = await this.transport.send(
        encoded,
        options.timeoutMs ?? this.defaultTimeoutMs,
        options.signal
      );

      // 3. Decode response (validates result)
      return this.codec.decodeResponse<T>(responseStr);
    }, options);
  }

  private generateId(): string {
    return `req_${Date.now()}_${++this.requestId}`;
  }

  // RuntimeExecution interface
  async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    return this.sendMessage<T>({
      type: 'call',
      module,
      functionName,
      args,
      kwargs,
    });
  }

  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    return this.sendMessage<T>({
      type: 'instantiate',
      module,
      className,
      args,
      kwargs,
    });
  }

  async callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    return this.sendMessage<T>({
      type: 'call_method',
      handle,
      methodName,
      args,
      kwargs,
    });
  }

  async disposeInstance(handle: string): Promise<void> {
    await this.sendMessage<void>({
      type: 'dispose_instance',
      handle,
      args: [],
    });
  }
}
```

## Issues Addressed

### SafeCodec Layer (10 issues)

| Issue | Title | How Addressed |
|-------|-------|---------------|
| #145 | arch: Enhanced codec with explicit edge case handling | SafeCodec provides explicit handling for all edge cases |
| #95 | Python bridge should disallow NaN/Infinity | Python SafeCodec uses `allow_nan=False` |
| #93 | Reject NaN/Infinity in JS arguments | `codec.encodeRequest()` validates before serialize |
| #55 | Surface Pydantic model_dump failures | Python `_default_encoder` wraps model_dump with explicit error |
| #54 | Reject dicts with non-string keys | `assertStringKeys()` validates recursively |
| #53 | Handle bytes/bytearray explicitly | `_default_encoder` converts to base64 marker |
| #52 | Invalid TYWRAP_CODEC_MAX_BYTES error | `maxPayloadBytes` option with explicit error |
| #48 | Add adversarial coverage for codec edge cases | Comprehensive validation in both pipelines |
| #45 | JSON fallback should handle NaN/NaT | Explicit rejection with clear error messages |
| #41 | Serialize numpy/pandas scalar return values | Python `_default_encoder` handles `.item()` |

### Transport Layer (11 issues)

| Issue | Title | How Addressed |
|-------|-------|---------------|
| #144 | arch: Robust ProcessIO wrapper | ProcessIO class with all features |
| #107 | Reset process after stdin write failures | `handleStdinError()` triggers restart |
| #91 | Handle stdio stream errors (EPIPE) | Error handlers on all streams |
| #59 | Handle stdin backpressure | `queueWrite()` with drain handling |
| #47 | Validate protocol error payload shapes | `isErrorResponse()` + `createErrorFromResponse()` |
| #120 | HttpBridge JSON.stringify failures | `safeStringify()` catches and wraps errors |
| #117 | HttpBridge auto-register Arrow decoder | `applyDecoders()` integration point |
| #56 | HTTP handle error payloads, timeouts, JSON | HttpIO with proper error handling |
| #58 | Pyodide surface conversion errors | PyodideIO can use same SafeCodec |

### WorkerPool Layer (9 issues)

| Issue | Title | How Addressed |
|-------|-------|---------------|
| #139 | Replace busy boolean with inFlightRequests | `inFlightCount` per worker |
| #138 | Clear polling timer on timeout | `clearTimeout(waiter.timer)` |
| #99 | Fixed 5s queue timeout | Configurable `queueTimeoutMs` |
| #92 | cleanup timer should unref | `timer.unref()` in waitForWorker |
| #60 | Should not exceed maxProcesses | `maxWorkers` limit enforced |
| #49 | Instance handle lifecycle errors | Explicit in BridgeProtocol |

## Migration Path

### Phase 1: SafeCodec (Week 1)

1. Create `src/runtime/safe-codec.ts`
2. Create `runtime/safe_codec.py`
3. Add comprehensive tests
4. Integrate with existing bridges (non-breaking)

### Phase 2: Transport (Week 2)

1. Create `src/runtime/transport.ts` interface
2. Create `src/runtime/process-io.ts`
3. Create `src/runtime/http-io.ts`
4. Add tests for each transport

### Phase 3: WorkerPool (Week 3)

1. Create `src/runtime/worker-pool.ts`
2. Migrate OptimizedNodeBridge to use WorkerPool
3. Add concurrency tests

### Phase 4: BridgeProtocol Integration (Week 4)

1. Create `src/runtime/bridge-protocol.ts`
2. Refactor NodeBridge to extend BridgeProtocol
3. Refactor HttpBridge to extend BridgeProtocol
4. Refactor PyodideBridge to extend BridgeProtocol
5. Deprecate old bridge implementations

### Phase 5: Cleanup (Week 5)

1. Remove deprecated code
2. Update documentation
3. Close resolved issues

## Consequences

### Positive

- **Consistency**: All bridges use the same validation, serialization, and error handling
- **Reliability**: Stream errors, backpressure, and edge cases are handled uniformly
- **Testability**: Each layer can be tested independently
- **Maintainability**: Single place to fix boundary crossing issues
- **~30 issues resolved**: One architectural change addresses majority of open issues

### Negative

- **Migration effort**: Existing bridges need refactoring
- **Learning curve**: New abstractions to understand
- **Potential breaking changes**: API signatures may change slightly

### Neutral

- **Code size**: More abstraction layers, but cleaner separation
- **Performance**: Minimal overhead from additional validation

## References

- [ADR-001: BoundedContext](./001-bounded-context.md) (implied, PR #150)
- [Issue #149: Implement BoundedContext](https://github.com/bbopen/tywrap/issues/149)
- [PR #150: BoundedContext Implementation](https://github.com/bbopen/tywrap/pull/150)
