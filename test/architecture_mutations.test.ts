import { describe, expect, it } from 'vitest';

import {
  compileContract,
  DEFAULT_CALLABLE_CAPABILITIES,
  DEFAULT_VALUE_CONVERSION,
  type CapabilityDescription,
} from '../src/core/callable-compiler.js';
import { CodeGenerator } from '../src/core/generator.js';
import { validateIrContract } from '../src/core/ir-contract.js';
import { BridgeCodec } from '../src/runtime/bridge-codec.js';
import { BridgeCodecError } from '../src/runtime/errors.js';
import type { PythonModule, PythonType } from '../src/types/index.js';

function tensorEnvelope(): Record<string, unknown> {
  return {
    __tywrap__: 'torch.tensor',
    codecVersion: 1,
    encoding: 'ndarray',
    dtype: 'torch.float16',
    shape: [2],
    device: 'cpu',
    value: {
      __tywrap__: 'ndarray',
      codecVersion: 1,
      encoding: 'json',
      dtype: 'float16',
      shape: [2],
      data: [1.5, -2.25],
    },
  };
}

async function decode(result: unknown): Promise<unknown> {
  return new BridgeCodec().decodeResponseAsync(
    JSON.stringify({ id: 1, protocol: 'tywrap/1', result })
  );
}

async function expectDecodeFailure(result: unknown, marker: string): Promise<void> {
  let caught: unknown;
  try {
    await decode(result);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BridgeCodecError);
  expect(caught).toMatchObject({ codecPhase: 'decode', valueType: marker });
}

function compileReturn(
  returnType: PythonType,
  annotation: string,
  capabilities: readonly CapabilityDescription[] = DEFAULT_CALLABLE_CAPABILITIES
) {
  const rawIr = {
    ir_version: '0.4.0',
    module: 'mutation_fixture',
    functions: [
      {
        name: 'probe',
        qualname: 'mutation_fixture.probe',
        docstring: null,
        parameters: [],
        returns: annotation,
        is_async: false,
        is_generator: false,
        type_params: [],
        method_kind: 'instance',
        overloads: [],
      },
    ],
    classes: [],
    constants: [],
    type_aliases: [],
    metadata: {},
    warnings: [],
  };
  const validation = validateIrContract(rawIr, 'mutation fixture');
  if (!validation.ok) {
    throw new Error(`Mutation fixture did not validate: ${JSON.stringify(validation.diagnostics)}`);
  }
  const module: PythonModule = {
    name: 'mutation_fixture',
    functions: [
      {
        name: 'probe',
        signature: { parameters: [], returnType, isAsync: false, isGenerator: false },
        decorators: [],
        isAsync: false,
        isGenerator: false,
        parameters: [],
        returnType,
      },
    ],
    classes: [],
    imports: [],
    exports: [],
  };
  return compileContract(validation.contract, {
    module,
    generator: new CodeGenerator(),
    conversion: DEFAULT_VALUE_CONVERSION,
    capabilities,
  });
}

describe('architecture contract mutations', () => {
  it('accepts the matching strict v1 Torch envelope', async () => {
    await expect(decode(tensorEnvelope())).resolves.toMatchObject({
      data: [1.5, -2.25],
      shape: [2],
      dtype: 'torch.float16',
      device: 'cpu',
    });
  });

  it('rejects an outer Torch float16 dtype paired with nested float32', async () => {
    const envelope = tensorEnvelope();
    envelope.value = { ...(envelope.value as object), dtype: 'float32' };
    await expectDecodeFailure(envelope, 'torch.tensor');
  });

  it.each([
    {
      name: 'outer shape',
      mutate: (envelope: Record<string, unknown>) => {
        envelope.shape = [1, 2];
      },
    },
    {
      name: 'codec version',
      mutate: (envelope: Record<string, unknown>) => {
        envelope.codecVersion = 2;
      },
    },
    {
      name: 'encoding',
      mutate: (envelope: Record<string, unknown>) => {
        envelope.encoding = 'raw';
      },
    },
  ])('rejects a mutated $name with a structured decode error', async ({ mutate }) => {
    const envelope = tensorEnvelope();
    mutate(envelope);
    await expectDecodeFailure(envelope, 'torch.tensor');
  });

  it('reports an unsupported record key conversion at the return path', () => {
    const compiled = compileReturn(
      {
        kind: 'collection',
        name: 'dict',
        itemTypes: [
          { kind: 'primitive', name: 'int' },
          { kind: 'primitive', name: 'str' },
        ],
      },
      'dict[int, str]'
    );
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'conversion-unsupported',
        path: '$.functions[0].returns',
      })
    );
    expect(compiled.callables[0]?.result.resolution.status).toBe('unsupported');
    expect(compiled.module.functions[0]?.callableContract?.returnValue).toBeUndefined();
  });

  it('reports an unavailable scientific capability at the return path', () => {
    const capabilities = DEFAULT_CALLABLE_CAPABILITIES.map(capability =>
      capability.name === 'scientific-ndarray' ? { ...capability, available: false } : capability
    );
    const compiled = compileReturn(
      {
        kind: 'generic',
        name: 'NDArray',
        module: 'numpy.typing',
        typeArgs: [{ kind: 'custom', name: 'float16', module: 'numpy' }],
      },
      'numpy.typing.NDArray[numpy.float16]',
      capabilities
    );
    expect(compiled.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        code: 'capability-unavailable',
        path: '$.functions[0].returns',
      })
    );
    expect(compiled.callables[0]?.result.resolution.status).toBe('unsupported');
    expect(compiled.module.functions[0]?.callableContract?.returnValue).toBeUndefined();
  });
});
