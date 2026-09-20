/** Isolated value extension prototype. Shipped codecs never import this file. */

export type PrototypeContract =
  | { readonly kind: 'integer' }
  | { readonly kind: 'safe-integer' }
  | { readonly kind: 'float' }
  | { readonly kind: 'boolean' }
  | { readonly kind: 'string' }
  | { readonly kind: 'null' }
  | { readonly kind: 'nullable'; readonly value: PrototypeContract }
  | { readonly kind: 'array'; readonly item: PrototypeContract }
  | { readonly kind: 'record'; readonly fields: Readonly<Record<string, PrototypeContract>> }
  | {
      readonly kind: 'dataclass';
      readonly typeId: string;
      readonly fields: Readonly<Record<string, PrototypeContract>>;
    };

const MAX_DECIMAL_DIGITS = 4096;
const MAX_DEPTH = 64;
const MAX_NODES = 100_000;
const MAX_PAYLOAD_BYTES = 10 * 1024 * 1024;
const DECIMAL = /^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/;
const provenance = new WeakMap<object, PrototypeContract>();

export class PrototypeError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new PrototypeError(`fields differ at ${path}`);
  }
}

function checkPayload(value: unknown, limit: number): void {
  const encoded = JSON.stringify(value);
  if (encoded === undefined || new TextEncoder().encode(encoded).length > limit) {
    throw new PrototypeError(`payload exceeds ${limit} bytes`);
  }
}

function canonicalDecimal(value: unknown, path: string): bigint {
  if (typeof value !== 'string' || !DECIMAL.test(value)) {
    throw new PrototypeError(`noncanonical integer decimal at ${path}`);
  }
  const digits = value.startsWith('-') ? value.length - 1 : value.length;
  if (digits > MAX_DECIMAL_DIGITS) {
    throw new PrototypeError(`integer exceeds ${MAX_DECIMAL_DIGITS} digits at ${path}`);
  }
  return BigInt(value);
}

export function requireCapability(meta: unknown, feature: string, policy: string): void {
  const capabilities = isRecord(meta) ? meta.valueCapabilities : undefined;
  if (!Array.isArray(capabilities) || !capabilities.includes(feature)) {
    throw new PrototypeError(`bridge lacks ${feature} capability`);
  }
  const expected =
    feature === 'exactIntegerDecimalV2'
      ? 'bigint-v2'
      : feature === 'dataclassFieldsV2'
        ? 'fields-v2'
        : undefined;
  if (policy !== expected) {
    throw new PrototypeError(`unsupported per-call value policy ${policy}`);
  }
}

interface WalkState {
  nodes: number;
  active: WeakSet<object>;
}

function visit(state: WalkState, value: unknown, path: string, depth: number): void {
  state.nodes += 1;
  if (depth > MAX_DEPTH) {
    throw new PrototypeError(`maximum depth ${MAX_DEPTH} exceeded at ${path}`);
  }
  if (state.nodes > MAX_NODES) {
    throw new PrototypeError(`maximum nodes ${MAX_NODES} exceeded at ${path}`);
  }
  if (typeof value === 'object' && value !== null) {
    if (state.active.has(value)) {
      throw new PrototypeError(`cycle at ${path}`);
    }
    state.active.add(value);
  }
}

function leave(state: WalkState, value: unknown): void {
  if (typeof value === 'object' && value !== null) {
    state.active.delete(value);
  }
}

function walk(
  value: unknown,
  contract: PrototypeContract,
  mode: 'encode' | 'decode',
  path: string,
  depth: number,
  state: WalkState
): unknown {
  if (contract.kind === 'nullable') {
    return value === null
      ? walk(null, { kind: 'null' }, mode, path, depth, state)
      : walk(value, contract.value, mode, path, depth, state);
  }
  visit(state, value, path, depth);
  try {
    if (contract.kind === 'null') {
      if (value !== null) throw new PrototypeError(`expected null at ${path}`);
      return null;
    }
    if (contract.kind === 'boolean' || contract.kind === 'string') {
      if (typeof value !== contract.kind) {
        throw new PrototypeError(`expected ${contract.kind} at ${path}`);
      }
      return value;
    }
    if (contract.kind === 'float') {
      if (mode === 'decode' && isRecord(value)) {
        exactKeys(value, ['__tywrap__', 'codecVersion', 'encoding'], path);
        if (
          value.__tywrap__ !== 'float' ||
          value.codecVersion !== 2 ||
          value.encoding !== 'negative-zero'
        ) {
          throw new PrototypeError(`invalid float envelope at ${path}`);
        }
        return -0;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new PrototypeError(`expected finite float at ${path}`);
      }
      if (mode === 'encode' && Object.is(value, -0)) {
        return { __tywrap__: 'float', codecVersion: 2, encoding: 'negative-zero' };
      }
      return value;
    }
    if (contract.kind === 'safe-integer') {
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new PrototypeError(`expected safe integer at ${path}`);
      }
      return value;
    }
    if (contract.kind === 'integer') {
      if (mode === 'encode') {
        if (typeof value !== 'bigint') {
          throw new PrototypeError(`expected bigint at ${path}`);
        }
        const decimal = value.toString();
        canonicalDecimal(decimal, path);
        return { __tywrap__: 'integer', codecVersion: 2, encoding: 'decimal', value: decimal };
      }
      if (!isRecord(value)) {
        throw new PrototypeError(`expected integer envelope at ${path}`);
      }
      exactKeys(value, ['__tywrap__', 'codecVersion', 'encoding', 'value'], path);
      if (
        value.__tywrap__ !== 'integer' ||
        value.codecVersion !== 2 ||
        value.encoding !== 'decimal'
      ) {
        throw new PrototypeError(`invalid integer envelope at ${path}`);
      }
      return canonicalDecimal(value.value, `${path}.value`);
    }
    if (contract.kind === 'array') {
      if (!Array.isArray(value)) throw new PrototypeError(`expected array at ${path}`);
      return value.map((item, index) =>
        walk(item, contract.item, mode, `${path}[${index}]`, depth + 1, state)
      );
    }
    if (contract.kind === 'record') {
      if (!isRecord(value)) throw new PrototypeError(`expected record at ${path}`);
      if (Object.hasOwn(value, '__tywrap__')) {
        throw new PrototypeError(`reserved record key at ${path}.__tywrap__`);
      }
      exactKeys(value, Object.keys(contract.fields), path);
      return Object.fromEntries(
        Object.entries(contract.fields).map(([key, field]) => [
          key,
          walk(value[key], field, mode, `${path}.${key}`, depth + 1, state),
        ])
      );
    }
    if (mode === 'encode') {
      throw new PrototypeError(`dataclass inputs are unsupported at ${path}`);
    }
    if (!isRecord(value)) throw new PrototypeError(`expected dataclass envelope at ${path}`);
    exactKeys(value, ['__tywrap__', 'codecVersion', 'encoding', 'type', 'fields'], path);
    if (
      value.__tywrap__ !== 'dataclass' ||
      value.codecVersion !== 2 ||
      value.encoding !== 'fields' ||
      value.type !== contract.typeId ||
      !isRecord(value.fields)
    ) {
      throw new PrototypeError(`invalid dataclass identity at ${path}`);
    }
    exactKeys(value.fields, Object.keys(contract.fields), `${path}.fields`);
    const decoded = Object.fromEntries(
      Object.entries(contract.fields).map(([key, field]) => [
        key,
        walk(value.fields[key], field, 'decode', `${path}.fields.${key}`, depth + 1, state),
      ])
    );
    provenance.set(decoded, contract);
    return decoded;
  } finally {
    leave(state, value);
  }
}

export function encodeExactRequest(
  value: unknown,
  contract: PrototypeContract,
  maxPayloadBytes = MAX_PAYLOAD_BYTES
): unknown {
  const encoded = walk(value, contract, 'encode', 'args', 0, {
    nodes: 0,
    active: new WeakSet(),
  });
  checkPayload(encoded, maxPayloadBytes);
  return encoded;
}

export function decodeExactResponse(
  value: unknown,
  contract: PrototypeContract,
  maxPayloadBytes = MAX_PAYLOAD_BYTES
): unknown {
  checkPayload(value, maxPayloadBytes);
  return walk(value, contract, 'decode', 'result', 0, {
    nodes: 0,
    active: new WeakSet(),
  });
}

export function validateDataclassOrigin(value: unknown, contract: PrototypeContract): void {
  if (contract.kind !== 'dataclass' || !isRecord(value) || provenance.get(value) !== contract) {
    throw new PrototypeError('value lacks verified dataclass provenance');
  }
}
