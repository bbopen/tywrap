/**
 * HTTP runtime bridge
 */

import { decodeValueAsync } from '../utils/codec.js';

import { RuntimeBridge } from './base.js';

export interface HttpBridgeOptions {
  baseURL: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface HttpCallPayload {
  module: string;
  functionName: string;
  args: unknown[];
  kwargs?: Record<string, unknown>;
}

interface HttpInstantiatePayload {
  module: string;
  className: string;
  args: unknown[];
  kwargs?: Record<string, unknown>;
}

interface HttpCallMethodPayload {
  handle: string;
  methodName: string;
  args: unknown[];
  kwargs?: Record<string, unknown>;
}

interface HttpDisposePayload {
  handle: string;
}

export class HttpBridge extends RuntimeBridge {
  private readonly baseURL: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(options: HttpBridgeOptions = { baseURL: 'http://localhost:8000' }) {
    super();
    this.baseURL = options.baseURL.replace(/\/$/, '');
    this.headers = { 'content-type': 'application/json', ...(options.headers ?? {}) };
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const payload: HttpCallPayload = { module, functionName, args, kwargs };
    const res = await this.post(`${this.baseURL}/call`, payload);
    return (await decodeValueAsync(res)) as T;
  }

  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const payload: HttpInstantiatePayload = { module, className, args, kwargs };
    const res = await this.post(`${this.baseURL}/instantiate`, payload);
    return (await decodeValueAsync(res)) as T;
  }

  async callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const payload: HttpCallMethodPayload = { handle, methodName, args, kwargs };
    const res = await this.post(`${this.baseURL}/call_method`, payload);
    return (await decodeValueAsync(res)) as T;
  }

  async disposeInstance(handle: string): Promise<void> {
    const payload: HttpDisposePayload = { handle };
    await this.post(`${this.baseURL}/dispose_instance`, payload);
  }

  async dispose(): Promise<void> {
    // stateless
  }

  private async post(url: string, body: unknown): Promise<unknown> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
      if (!resp.ok) {
        const text = await safeText(resp);
        throw new Error(`HTTP ${resp.status}: ${text || resp.statusText}`);
      }
      const ct = resp.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        return (await resp.json()) as unknown;
      }
      const text = await resp.text();
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text as unknown;
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return await resp.text();
  } catch {
    return '';
  }
}
