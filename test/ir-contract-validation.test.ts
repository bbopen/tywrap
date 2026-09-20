import { describe, expect, it } from 'vitest';
import { TYWRAP_IR_VERSION, validateIrContract } from '../src/core/ir-contract.js';

const validContract = {
  ir_version: TYWRAP_IR_VERSION,
  module: 'fixture',
  functions: [
    {
      name: 'get_value',
      qualname: 'fixture.get_value',
      docstring: null,
      parameters: [
        { name: 'key', kind: 'POSITIONAL_OR_KEYWORD', annotation: 'str | int', default: false },
      ],
      returns: 'str | int',
      is_async: false,
      is_generator: false,
      type_params: [],
      method_kind: 'instance',
      overloads: [
        {
          parameters: [
            { name: 'key', kind: 'POSITIONAL_OR_KEYWORD', annotation: 'str', default: false },
          ],
          returns: 'str',
        },
        {
          parameters: [
            { name: 'key', kind: 'POSITIONAL_OR_KEYWORD', annotation: 'int', default: false },
          ],
          returns: 'int',
        },
      ],
    },
  ],
  classes: [],
  constants: [],
  type_aliases: [],
  metadata: {},
  warnings: [],
};

describe('validateIrContract', () => {
  it('accepts the complete IR 0.4 callable shape, including overloads', () => {
    const result = validateIrContract(validContract, 'fixture contract');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.contract.functions[0]?.overloads).toHaveLength(2);
    }
  });

  it('reports each malformed nested overload field at its JSON path', () => {
    const invalid = structuredClone(validContract);
    invalid.functions[0]!.overloads[1]!.parameters[0]!.kind = 'MALFORMED';
    invalid.functions[0]!.overloads[1]!.returns = 42 as unknown as string;

    const result = validateIrContract(invalid, 'fixture contract');

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'contract-invalid',
            path: '$.functions[0].overloads[1].parameters[0].kind',
          }),
          expect.objectContaining({
            code: 'contract-invalid',
            path: '$.functions[0].overloads[1].returns',
          }),
        ])
      );
    }
  });

  it('keeps IR version mismatch separate from structural diagnostics', () => {
    const invalid = { ...validContract, ir_version: '0.3.0' };
    const result = validateIrContract(invalid, 'fixture contract');

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'ir-version-mismatch', path: '$.ir_version' })
      );
    }
  });

  it('reads stable offline contracts without extractor metadata', () => {
    const offline = Object.fromEntries(
      Object.entries(validContract).filter(([key]) => key !== 'metadata')
    );
    const live = validateIrContract(offline, 'live IR');
    expect(live).toMatchObject({ ok: false });

    const saved = validateIrContract(offline, 'saved contract', {
      allowOmittedMetadata: true,
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.contract.metadata).toEqual({});
    }
  });

  it('bounds malformed-contract diagnostics', () => {
    const invalid = {
      ...validContract,
      functions: Array.from({ length: 120 }, () => ({ name: 2 })),
    };
    const result = validateIrContract(invalid, 'bad contract');
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(result.diagnostics.length).toBeLessThanOrEqual(101);
      expect(result.diagnostics.at(-1)?.message).toContain('more than 100 contract errors');
    }
  });

  it('rejects contracts that exceed the shared entry traversal limit', () => {
    const oversized = { ...validContract, warnings: Array(100_001).fill('warning') };
    const result = validateIrContract(oversized, 'large contract');
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) {
      expect(
        result.diagnostics.some(diagnostic =>
          diagnostic.message.includes('100000 entry validation limit')
        )
      ).toBe(true);
    }
  });
});
