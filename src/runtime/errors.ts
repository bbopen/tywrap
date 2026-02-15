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

export class BridgeCodecError extends BridgeError {
  codecPhase?: string;
  valueType?: string;

  constructor(
    message: string,
    options?: { code?: string; cause?: unknown; codecPhase?: string; valueType?: string }
  ) {
    super(message, { code: options?.code, cause: options?.cause });
    this.codecPhase = options?.codecPhase;
    this.valueType = options?.valueType;
  }
}

export class BridgeExecutionError extends BridgeError {
  traceback?: string;
}
