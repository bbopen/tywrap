/** Internal value policy consumed by codecs and callable-contract generation. */
export const VALUE_CONTRACT_REVISION = 1 as const;

/** JSON numbers can carry Python integers exactly only within this range. */
export const MAX_SAFE_JSON_INTEGER = 2 ** 53 - 1;

export type ValueContract =
  | { readonly kind: 'null'; readonly wire: 'json'; readonly decodedAs: 'null' }
  | { readonly kind: 'boolean'; readonly wire: 'json'; readonly decodedAs: 'boolean' }
  | {
      readonly kind: 'integer';
      readonly wire: 'json';
      readonly decodedAs: 'number';
      readonly constraint: 'safe-integer';
    }
  | {
      readonly kind: 'float';
      readonly wire: 'json';
      readonly decodedAs: 'number';
      readonly constraint: 'finite';
    }
  | { readonly kind: 'string'; readonly wire: 'json'; readonly decodedAs: 'string' }
  | {
      readonly kind: 'sequence';
      readonly wire: 'json';
      readonly decodedAs: 'array';
      readonly item: ValueContract;
    }
  | {
      readonly kind: 'record';
      readonly wire: 'json';
      readonly decodedAs: 'object';
      readonly fields: readonly ValueContractField[];
      readonly additionalValues?: ValueContract;
    }
  | {
      readonly kind: 'ndarray-float16';
      readonly wire: 'arrow' | 'json-fallback';
      readonly decodedAs: 'nested-array-or-scalar';
      readonly element: Extract<ValueContract, { kind: 'float' }>;
      readonly dtype: 'float16';
      readonly rank?: number;
    }
  | {
      readonly kind: 'torch-float16';
      readonly wire: 'ndarray-envelope';
      readonly decodedAs: 'tensor-record';
      readonly value: Extract<ValueContract, { kind: 'ndarray-float16' }>;
    }
  | {
      readonly kind: 'unsupported';
      readonly wire: 'none';
      readonly decodedAs: 'never';
      readonly reason: string;
      readonly guidance: string;
    };

export interface ValueContractField {
  readonly name: string;
  readonly value: ValueContract;
  readonly required: boolean;
}

export function isSafeJsonInteger(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_JSON_INTEGER;
}
