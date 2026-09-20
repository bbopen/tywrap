/** Translate resolved v3 nodes into the isolated cross-language test codec. */

import type { ValueContractV3 } from '../../src/contracts/value-contract.js';
import type { PrototypeContract } from './value_extensions.js';

export function toExactPrototypeContract(value: ValueContractV3): PrototypeContract {
  switch (value.kind) {
    case 'integer-exact':
      return { kind: 'integer' };
    case 'boolean':
      return { kind: 'boolean' };
    case 'float':
      return { kind: 'float' };
    case 'sequence':
      return { kind: 'array', item: toExactPrototypeContract(value.item) };
    default:
      throw new Error(`The exact call fixture cannot use ${value.kind}.`);
  }
}
