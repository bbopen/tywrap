import { describe, expect, it } from 'vitest';
import {
  compileContract,
  DEFAULT_CALLABLE_CAPABILITIES,
  DEFAULT_VALUE_CONVERSION,
} from '../src/core/callable-compiler.js';
import { CodeGenerator } from '../src/core/generator.js';
import { validateIrContract } from '../src/core/ir-contract.js';
import type { PythonModule } from '../src/types/index.js';

const rawIr = {
  ir_version: '0.4.0',
  module: 'fixture',
  functions: [
    {
      name: 'select',
      qualname: 'fixture.select',
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
    {
      name: 'nested',
      qualname: 'fixture.nested',
      docstring: null,
      parameters: [],
      returns: 'dict[str, dict[str, int]]',
      is_async: false,
      is_generator: false,
      type_params: [],
      method_kind: 'instance',
      overloads: [],
    },
    {
      name: 'async_value',
      qualname: 'fixture.async_value',
      docstring: null,
      parameters: [],
      returns: 'str',
      is_async: true,
      is_generator: false,
      type_params: [],
      method_kind: 'instance',
      overloads: [],
    },
    {
      name: 'point',
      qualname: 'fixture.point',
      docstring: null,
      parameters: [],
      returns: 'fixture.Point',
      is_async: false,
      is_generator: false,
      type_params: [],
      method_kind: 'instance',
      overloads: [],
    },
  ],
  classes: [
    {
      name: 'Point',
      qualname: 'fixture.Point',
      docstring: null,
      bases: ['object'],
      methods: [],
      typed_dict: false,
      total: null,
      fields: [
        { name: 'x', kind: 'FIELD', annotation: 'int', default: false },
        { name: 'y', kind: 'FIELD', annotation: 'int', default: false },
      ],
      is_protocol: false,
      is_namedtuple: false,
      is_dataclass: true,
      is_pydantic: false,
      type_params: [],
      accessors: [],
    },
  ],
  constants: [],
  type_aliases: [],
  metadata: {},
  warnings: [],
};

const moduleModel: PythonModule = {
  name: 'fixture',
  functions: [
    {
      name: 'select',
      signature: { parameters: [], returnType: { kind: 'custom', name: 'Any' }, isAsync: false, isGenerator: false },
      decorators: [],
      isAsync: false,
      isGenerator: false,
      parameters: [
        {
          name: 'key',
          type: {
            kind: 'union',
            types: [
              { kind: 'primitive', name: 'str' },
              { kind: 'primitive', name: 'int' },
            ],
          },
          optional: false,
          varArgs: false,
          kwArgs: false,
        },
      ],
      returnType: {
        kind: 'union',
        types: [
          { kind: 'primitive', name: 'str' },
          { kind: 'primitive', name: 'int' },
        ],
      },
      overloads: [
        {
          parameters: [
            {
              name: 'key',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'primitive', name: 'str' },
        },
        {
          parameters: [
            {
              name: 'key',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'primitive', name: 'int' },
        },
      ],
    },
    {
      name: 'nested',
      signature: { parameters: [], returnType: { kind: 'custom', name: 'Any' }, isAsync: false, isGenerator: false },
      decorators: [],
      isAsync: false,
      isGenerator: false,
      parameters: [],
      returnType: {
        kind: 'collection',
        name: 'dict',
        itemTypes: [
          { kind: 'primitive', name: 'str' },
          {
            kind: 'collection',
            name: 'dict',
            itemTypes: [
              { kind: 'primitive', name: 'str' },
              { kind: 'primitive', name: 'int' },
            ],
          },
        ],
      },
    },
    {
      name: 'async_value',
      signature: { parameters: [], returnType: { kind: 'primitive', name: 'str' }, isAsync: true, isGenerator: false },
      decorators: [],
      isAsync: true,
      isGenerator: false,
      parameters: [],
      returnType: { kind: 'primitive', name: 'str' },
    },
    {
      name: 'point',
      signature: { parameters: [], returnType: { kind: 'custom', name: 'Point' }, isAsync: false, isGenerator: false },
      decorators: [],
      isAsync: false,
      isGenerator: false,
      parameters: [],
      returnType: { kind: 'custom', name: 'Point' },
    },
  ],
  classes: [
    {
      name: 'Point',
      bases: [],
      methods: [],
      properties: [],
      decorators: [],
      kind: 'dataclass',
    },
  ],
  typeAliases: [],
  imports: [],
  exports: [],
};

describe('compileContract', () => {
  it('resolves overloads and nested records once before emitting both wrapper files', () => {
    const validation = validateIrContract(rawIr, 'fixture contract');
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }

    const compiled = compileContract(validation.contract, {
      module: moduleModel,
      generator: new CodeGenerator(),
      conversion: DEFAULT_VALUE_CONVERSION,
      capabilities: DEFAULT_CALLABLE_CAPABILITIES,
    });

    expect(compiled.files.map(file => file.kind)).toEqual(['typescript', 'declaration']);
    expect(compiled.generated.typescript).toContain(
      'export function select(key: string): Promise<string>;'
    );
    expect(compiled.generated.declaration).toContain(
      'export function select(key: number): Promise<number>;'
    );
    const nested = compiled.callables.find(callable => callable.name === 'nested');
    expect(nested?.result.resolution).toMatchObject({
      status: 'supported',
      value: {
        kind: 'record',
        additionalValues: {
          kind: 'record',
          additionalValues: { kind: 'integer', constraint: 'safe-integer' },
        },
      },
    });
  });

  it('degrades unimplemented dataclass and coroutine outputs with local diagnostics', () => {
    const validation = validateIrContract(rawIr, 'fixture contract');
    expect(validation.ok).toBe(true);
    if (!validation.ok) {
      return;
    }

    const compiled = compileContract(validation.contract, {
      module: moduleModel,
      generator: new CodeGenerator(),
      conversion: DEFAULT_VALUE_CONVERSION,
      capabilities: DEFAULT_CALLABLE_CAPABILITIES,
    });

    expect(compiled.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'coroutine-unsupported', path: '$.functions[2].returns' }),
        expect.objectContaining({ code: 'dataclass-unsupported', path: '$.functions[3].returns' }),
      ])
    );
    expect(compiled.module.functions[2]?.returnType).toEqual({
      kind: 'custom',
      name: 'Any',
      module: 'typing',
    });
    expect(compiled.module.functions[3]?.returnType).toEqual({
      kind: 'custom',
      name: 'Any',
      module: 'typing',
    });
  });
});
