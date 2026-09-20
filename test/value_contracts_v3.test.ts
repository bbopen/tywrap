import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  VALUE_CONTRACT_REVISION,
  VALUE_CONTRACT_V3_REVISION,
  type ExactIntegerValueContract,
  type ValueContractV3,
} from '../src/contracts/value-contract.js';

const specification = JSON.parse(
  readFileSync(new URL('../docs/maintainers/value-contracts.v3.json', import.meta.url), 'utf8')
) as {
  revision: number;
  base: { file: string; revision: number; sha256: string };
  valueEnvelopeCodecVersion: number;
  callPolicy: string;
  requiredCapability: string;
  rules: {
    'integer-exact': {
      contract: ExactIntegerValueContract;
      decimalGrammar: string;
      maximumDigitsWithoutSign: number;
    };
  };
};

const fixtures = JSON.parse(
  readFileSync(
    new URL('../docs/maintainers/value-contract-fixtures.v3.json', import.meta.url),
    'utf8'
  )
) as {
  revision: number;
  integerCases: readonly {
    logicalDecimal: string;
    envelope: { __tywrap__: string; codecVersion: number; encoding: string; value: string };
  }[];
  rejectedDecimals: readonly string[];
};

describe('exact integer value policy', () => {
  it('pins revision 3 to the unchanged revision-2 source', () => {
    const base = readFileSync(
      new URL(`../docs/maintainers/${specification.base.file}`, import.meta.url)
    );
    const baseRevision = JSON.parse(base.toString('utf8')) as { revision: number };
    expect(specification.revision).toBe(VALUE_CONTRACT_V3_REVISION);
    expect(fixtures.revision).toBe(VALUE_CONTRACT_V3_REVISION);
    expect(specification.base.revision).toBe(VALUE_CONTRACT_REVISION);
    expect(baseRevision.revision).toBe(VALUE_CONTRACT_REVISION);
    expect(createHash('sha256').update(base).digest('hex')).toBe(specification.base.sha256);
  });

  it('keeps semantic revision, envelope version, and call policy distinct', () => {
    expect(specification.revision).toBe(3);
    expect(specification.valueEnvelopeCodecVersion).toBe(2);
    expect(specification.callPolicy).toBe('bigint-v2');
    expect(specification.requiredCapability).toBe('exactIntegerDecimalV2');
    expect(specification.rules['integer-exact'].contract).toEqual({
      kind: 'integer-exact',
      wire: 'decimal-string-envelope',
      decodedAs: 'bigint',
      constraint: 'exact-integer',
    });
  });

  it('permits exact integer leaves inside the shared composite shapes', () => {
    const nested: ValueContractV3 = {
      kind: 'record',
      wire: 'json',
      decodedAs: 'object',
      fields: [
        {
          name: 'values',
          required: true,
          value: {
            kind: 'sequence',
            wire: 'json',
            decodedAs: 'array',
            item: specification.rules['integer-exact'].contract,
          },
        },
      ],
    };
    expect(nested.fields[0]?.value.kind).toBe('sequence');
  });

  it('fixes the canonical decimal grammar and proof values', () => {
    const rule = specification.rules['integer-exact'];
    const decimal = new RegExp(rule.decimalGrammar);
    expect(rule.maximumDigitsWithoutSign).toBe(4096);
    for (const fixture of fixtures.integerCases) {
      expect(decimal.test(fixture.logicalDecimal)).toBe(true);
      expect(fixture.envelope).toEqual({
        __tywrap__: 'integer',
        codecVersion: 2,
        encoding: 'decimal',
        value: fixture.logicalDecimal,
      });
    }
    for (const value of fixtures.rejectedDecimals) {
      expect(decimal.test(value)).toBe(false);
    }
  });
});
