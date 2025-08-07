/**
 * HTTP runtime bridge
 */

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
    return res as T;
  }

  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const payload: HttpInstantiatePayload = { module, className, args, kwargs };
    const res = await this.post(`${this.baseURL}/instantiate`, payload);
    return res as T;
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
