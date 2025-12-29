export class BridgeError extends Error {
  code?: string;
  constructor(message: string, options?: { code?: string; cause?: unknown }) {
    super(message);
    this.name = new.target.name;
    this.code = options?.code;
    if (options?.cause) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class BridgeProtocolError extends BridgeError {}
export class BridgeTimeoutError extends BridgeError {}
export class BridgeDisposedError extends BridgeError {}

export class BridgeExecutionError extends BridgeError {
  traceback?: string;
}
