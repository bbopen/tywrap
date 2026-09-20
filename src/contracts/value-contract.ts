/** Internal value policy consumed by codecs and callable-contract generation. */
export const VALUE_CONTRACT_REVISION = 2 as const;

/** Exact integer mode uses a separate semantic contract revision. */
export const VALUE_CONTRACT_V3_REVISION = 3 as const;

export type ValueContractRevision =
  | typeof VALUE_CONTRACT_REVISION
  | typeof VALUE_CONTRACT_V3_REVISION;

/** JSON numbers can carry Python integers exactly only within this range. */
export const MAX_SAFE_JSON_INTEGER = 2 ** 53 - 1;

type CommonValueContractLeaf =
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
  | { readonly kind: 'bytes'; readonly wire: 'base64-envelope'; readonly decodedAs: 'Uint8Array' }
  | {
      readonly kind: 'ndarray-float16';
      readonly wire: 'arrow' | 'json-fallback';
      readonly decodedAs: 'nested-array-or-scalar';
      readonly element: Extract<CommonValueContractLeaf, { kind: 'float' }>;
      readonly dtype: 'float16';
      readonly rank?: number;
    }
  | {
      readonly kind: 'torch-float16';
      readonly wire: 'ndarray-envelope';
      readonly decodedAs: 'tensor-record';
      readonly dtype: 'torch.float16';
      readonly value: Extract<CommonValueContractLeaf, { kind: 'ndarray-float16' }>;
    }
  | {
      readonly kind: 'unsupported';
      readonly wire: 'none';
      readonly decodedAs: 'never';
      readonly reason: string;
      readonly guidance: string;
    };

type CompositeValueContract<TValue> =
  | {
      readonly kind: 'sequence';
      readonly wire: 'json';
      readonly decodedAs: 'array';
      readonly item: TValue;
    }
  | {
      readonly kind: 'tuple';
      readonly wire: 'json';
      readonly decodedAs: 'array';
      readonly items: readonly TValue[];
    }
  | {
      readonly kind: 'union';
      readonly wire: 'selected-option';
      readonly decodedAs: 'selected-option';
      readonly options: readonly [TValue, TValue, ...TValue[]];
    }
  | {
      readonly kind: 'record';
      readonly wire: 'json';
      readonly decodedAs: 'object';
      readonly fields: readonly ValueContractField<TValue>[];
      readonly additionalValues?: TValue;
    };

/** Revision 2 remains the default safe-number value contract. */
export type ValueContract = CommonValueContractLeaf | CompositeValueContract<ValueContract>;

export interface ExactIntegerValueContract {
  readonly kind: 'integer-exact';
  readonly wire: 'decimal-string-envelope';
  readonly decodedAs: 'bigint';
  readonly constraint: 'exact-integer';
}

/** Revision 3 adds exact integers without changing revision 2. */
export type ValueContractV3 =
  | CommonValueContractLeaf
  | ExactIntegerValueContract
  | CompositeValueContract<ValueContractV3>;

export interface ValueContractField<TValue = ValueContract> {
  readonly name: string;
  readonly value: TValue;
  readonly required: boolean;
}

export function isSafeJsonInteger(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_JSON_INTEGER;
}
