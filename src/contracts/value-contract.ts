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

interface SequenceContract<TValue> {
  readonly kind: 'sequence';
  readonly wire: 'json';
  readonly decodedAs: 'array';
  readonly item: TValue;
}

interface TupleContract<TValue> {
  readonly kind: 'tuple';
  readonly wire: 'json';
  readonly decodedAs: 'array';
  readonly items: readonly TValue[];
}

interface UnionContract<TValue> {
  readonly kind: 'union';
  readonly wire: 'selected-option';
  readonly decodedAs: 'selected-option';
  readonly options: readonly [TValue, TValue, ...TValue[]];
}

interface RecordContract<TValue> {
  readonly kind: 'record';
  readonly wire: 'json';
  readonly decodedAs: 'object';
  readonly fields: readonly ValueContractField<TValue>[];
  readonly additionalValues?: TValue;
}

interface V2SequenceContract extends SequenceContract<ValueContract> {}
interface V2TupleContract extends TupleContract<ValueContract> {}
interface V2UnionContract extends UnionContract<ValueContract> {}
interface V2RecordContract extends RecordContract<ValueContract> {}

/** Revision 2 remains the default safe-number value contract. */
export type ValueContract =
  | CommonValueContractLeaf
  | V2SequenceContract
  | V2TupleContract
  | V2UnionContract
  | V2RecordContract;

export interface ExactIntegerValueContract {
  readonly kind: 'integer-exact';
  readonly wire: 'decimal-string-envelope';
  readonly decodedAs: 'bigint';
  readonly constraint: 'exact-integer';
}

interface V3SequenceContract extends SequenceContract<ValueContractV3> {}
interface V3TupleContract extends TupleContract<ValueContractV3> {}
interface V3UnionContract extends UnionContract<ValueContractV3> {}
interface V3RecordContract extends RecordContract<ValueContractV3> {}

/** Revision 3 adds exact integers without changing revision 2. */
export type ValueContractV3 =
  | CommonValueContractLeaf
  | ExactIntegerValueContract
  | V3SequenceContract
  | V3TupleContract
  | V3UnionContract
  | V3RecordContract;

export interface ValueContractField<TValue = ValueContract> {
  readonly name: string;
  readonly value: TValue;
  readonly required: boolean;
}

export function containsExactInteger(value: ValueContractV3): boolean {
  switch (value.kind) {
    case 'integer-exact':
      return true;
    case 'sequence':
      return containsExactInteger(value.item);
    case 'tuple':
      return value.items.some(containsExactInteger);
    case 'union':
      return value.options.some(containsExactInteger);
    case 'record':
      return (
        value.fields.some(field => containsExactInteger(field.value)) ||
        (value.additionalValues !== undefined && containsExactInteger(value.additionalValues))
      );
    default:
      return false;
  }
}

export function isSafeJsonInteger(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) <= MAX_SAFE_JSON_INTEGER;
}
