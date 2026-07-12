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

/**
 * A decoded value did not match the return annotation emitted into a wrapper.
 *
 * This is deliberately separate from protocol/codec errors: the wire response
 * was sound, but the Python implementation violated its declared contract.
 */
export class BridgeValidationError extends BridgeError {
  readonly declaredType: string;
  readonly receivedShape: string;
  readonly callSite: string;

  constructor(options: { declaredType: string; receivedShape: string; callSite: string }) {
    super(
      `Return validation failed for ${options.callSite}: expected ${options.declaredType}, received ${options.receivedShape}`
    );
    this.declaredType = options.declaredType;
    this.receivedShape = options.receivedShape;
    this.callSite = options.callSite;
  }
}

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
