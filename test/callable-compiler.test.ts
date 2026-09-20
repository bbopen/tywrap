import { describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import {
  compileContract,
  DEFAULT_CALLABLE_CAPABILITIES,
  DEFAULT_VALUE_CONVERSION,
} from '../src/core/callable-compiler.js';
import { CodeGenerator } from '../src/core/generator.js';
import { validateIrContract } from '../src/core/ir-contract.js';
import { BridgeValidationError } from '../src/runtime/errors.js';
import { HttpBridge } from '../src/runtime/http.js';
import { clearRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';
import type { PythonModule, PythonType } from '../src/types/index.js';

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
    expect(compiled.generated.typescript).toContain(
      'export async function select(key: unknown): Promise<unknown>'
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
    const selected = compiled.callables.find(callable => callable.name === 'select');
    expect(selected?.result.resolution).toMatchObject({
      status: 'supported',
      value: {
        kind: 'union',
        options: [
          { kind: 'string', wire: 'json', decodedAs: 'string' },
          { kind: 'integer', wire: 'json', decodedAs: 'number', constraint: 'safe-integer' },
        ],
      },
    });
    expect(compiled.generated.typescript).toContain('selectOverloadReturnValidator(');
    expect(compiled.generated.typescript).toContain('"constraint":"safe-integer"');
  });

  it('rejects a wrong return from the generated wrapper for a selected overload', async () => {
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
    const temporary = await mkdtemp(join(process.cwd(), 'test', '.tywrap-overload-'));
    try {
      const outputPath = join(temporary, 'fixture.generated.mjs');
      const javascript = ts.transpileModule(compiled.generated.typescript, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      await writeFile(outputPath, javascript, 'utf8');
      setRuntimeBridge({
        async call<T>(
          _module: string,
          _functionName: string,
          args: unknown[],
          _kwargs?: Record<string, unknown>,
          validate?: (result: T) => void
        ): Promise<T> {
          const result = (typeof args[0] === 'string' ? 99 : 4) as T;
          validate?.(result);
          return result;
        },
        async dispose(): Promise<void> {},
      });
      const generated = (await import(pathToFileURL(outputPath).href)) as {
        select: (key: string | number) => Promise<string | number>;
      };
      await expect(generated.select('key')).rejects.toThrow(BridgeValidationError);
      await expect(generated.select(2)).resolves.toBe(4);
    } finally {
      clearRuntimeBridge();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('warns when an optional parameter makes two overload inputs overlap', () => {
    const source = rawIr.functions[0]!;
    const key = source.overloads[0]!.parameters[0]!;
    const optionalBase = {
      name: 'base', kind: 'POSITIONAL_OR_KEYWORD', annotation: 'int', default: true,
    };
    const ir = validateIrContract({
      ...rawIr,
      functions: [{
        ...source,
        parameters: [key, optionalBase],
        overloads: [
          { parameters: [key], returns: 'str' },
          { parameters: [key, optionalBase], returns: 'int' },
        ],
      }],
      classes: [],
    }, 'optional overload contract');
    expect(ir.ok).toBe(true);
    if (!ir.ok) {
      return;
    }
    const original = moduleModel.functions[0]!;
    const keyModel = original.overloads![0]!.parameters[0]!;
    const baseModel = {
      ...keyModel,
      name: 'base',
      type: { kind: 'primitive', name: 'int' } as PythonType,
      optional: true,
    };
    const model: PythonModule = {
      ...moduleModel,
      classes: [],
      functions: [{
        ...original,
        parameters: [keyModel, baseModel],
        overloads: [
          { parameters: [keyModel], returnType: { kind: 'primitive', name: 'str' } },
          { parameters: [keyModel, baseModel], returnType: { kind: 'primitive', name: 'int' } },
        ],
      }],
    };
    const compiled = compileContract(ir.contract, {
      module: model,
      generator: new CodeGenerator(),
      conversion: DEFAULT_VALUE_CONVERSION,
      capabilities: DEFAULT_CALLABLE_CAPABILITIES,
    });
    expect(compiled.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'overload-ambiguous', path: '$.functions[0].overloads[1]' }),
    ]));
  });

  it('selects a class method overload without validating its implicit cls receiver', async () => {
    const source = rawIr.functions[0]!;
    const receiver = {
      name: 'cls', kind: 'POSITIONAL_OR_KEYWORD', annotation: null, default: false,
    };
    const stringInput = source.overloads[0]!.parameters[0]!;
    const integerInput = source.overloads[1]!.parameters[0]!;
    const methodIr = {
      ...source,
      name: 'convert',
      qualname: 'fixture.Converter.convert',
      parameters: [receiver, source.parameters[0]!],
      method_kind: 'class',
      overloads: [
        { parameters: [receiver, stringInput], returns: 'str' },
        { parameters: [receiver, integerInput], returns: 'int' },
      ],
    };
    const ir = validateIrContract({
      ...rawIr,
      functions: [],
      classes: [{
        ...rawIr.classes[0]!,
        name: 'Converter',
        qualname: 'fixture.Converter',
        methods: [methodIr],
        fields: [],
        is_dataclass: false,
      }],
    }, 'class overload contract');
    expect(ir.ok).toBe(true);
    if (!ir.ok) {
      return;
    }
    const original = moduleModel.functions[0]!;
    const receiverModel = {
      ...original.parameters[0]!,
      name: 'cls',
      type: { kind: 'custom', name: 'Any', module: 'typing' } as PythonType,
    };
    const method = {
      ...original,
      name: 'convert',
      methodKind: 'class' as const,
      parameters: [receiverModel, original.parameters[0]!],
      overloads: original.overloads?.map(overload => ({
        ...overload,
        parameters: [receiverModel, ...overload.parameters],
      })),
    };
    const model: PythonModule = {
      ...moduleModel,
      functions: [],
      classes: [{
        ...moduleModel.classes[0]!,
        name: 'Converter',
        kind: 'class',
        methods: [method],
        properties: [],
      }],
    };
    const compiled = compileContract(ir.contract, {
      module: model,
      generator: new CodeGenerator(),
      conversion: DEFAULT_VALUE_CONVERSION,
      capabilities: DEFAULT_CALLABLE_CAPABILITIES,
    });
    expect(compiled.diagnostics.some(item => item.path.endsWith('.parameters[0]'))).toBe(false);
    expect(compiled.generated.typescript).toContain('"selectable":true');
    expect(compiled.generated.declaration).toContain('static convert(key: string): Promise<string>;');
    expect(compiled.generated.typescript).toContain(
      'static async convert(key: unknown): Promise<unknown>'
    );

    const temporary = await mkdtemp(join(process.cwd(), 'test', '.tywrap-class-overload-'));
    try {
      const outputPath = join(temporary, 'fixture.generated.mjs');
      const javascript = ts.transpileModule(compiled.generated.typescript, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      await writeFile(outputPath, javascript, 'utf8');
      setRuntimeBridge({
        async call<T>(
          _module: string,
          _functionName: string,
          _args: unknown[],
          _kwargs?: Record<string, unknown>,
          validate?: (result: T) => void
        ): Promise<T> {
          const result = 7 as T;
          validate?.(result);
          return result;
        },
        async dispose(): Promise<void> {},
      });
      const generated = (await import(pathToFileURL(outputPath).href)) as {
        Converter: { convert: (key: string | number) => Promise<string | number> };
      };
      await expect(generated.Converter.convert('key')).rejects.toThrow(BridgeValidationError);
      await expect(generated.Converter.convert(2)).resolves.toBe(7);
    } finally {
      clearRuntimeBridge();
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('validates a generated scalar float16 wrapper from the HTTP codec proof', async () => {
    const source = rawIr.functions[1]!;
    const ir = validateIrContract({
      ...rawIr,
      functions: [{ ...source, name: 'scalar_value', qualname: 'fixture.scalar_value',
        returns: 'numpy.typing.NDArray[numpy.float16]' }],
      classes: [],
    }, 'scalar contract');
    expect(ir.ok).toBe(true);
    if (!ir.ok) {
      return;
    }
    const scalarType: PythonType = {
      kind: 'generic', name: 'NDArray', module: 'numpy.typing',
      typeArgs: [{ kind: 'custom', name: 'float16', module: 'numpy' }],
    };
    const original = moduleModel.functions[1]!;
    const model: PythonModule = {
      ...moduleModel,
      classes: [],
      functions: [{
        ...original,
        name: 'scalar_value',
        returnType: scalarType,
        signature: { ...original.signature, returnType: scalarType },
      }],
    };
    const compiled = compileContract(ir.contract, {
      module: model,
      generator: new CodeGenerator(),
      conversion: DEFAULT_VALUE_CONVERSION,
      capabilities: DEFAULT_CALLABLE_CAPABILITIES,
    });
    expect(compiled.generated.typescript).toContain('"marker":"ndarray","dtype":"float16"');

    let dtype = 'float16';
    let requestId = 0;
    const server = createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        id: ++requestId,
        result: {
          __tywrap__: 'ndarray', codecVersion: 1, encoding: 'json',
          shape: [], dtype, data: 1.5,
        },
      }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const bridge = new HttpBridge({ baseURL: `http://127.0.0.1:${address.port}` });
    const temporary = await mkdtemp(join(process.cwd(), 'test', '.tywrap-scalar-proof-'));
    try {
      const outputPath = join(temporary, 'fixture.generated.mjs');
      const javascript = ts.transpileModule(compiled.generated.typescript, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      await writeFile(outputPath, javascript, 'utf8');
      setRuntimeBridge(bridge);
      const generated = (await import(pathToFileURL(outputPath).href)) as {
        scalarValue: () => Promise<number>;
      };
      await expect(generated.scalarValue()).resolves.toBe(1.5);
      dtype = 'float32';
      await expect(generated.scalarValue()).rejects.toThrow(BridgeValidationError);
    } finally {
      clearRuntimeBridge();
      await bridge.dispose();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('uses revision 2 for selected unions and fixed heterogeneous tuples', () => {
    const union = DEFAULT_VALUE_CONVERSION.resolve({
      direction: 'output',
      path: '$.functions[0].returns',
      logicalType: {
        kind: 'union',
        types: [
          { kind: 'primitive', name: 'str' },
          { kind: 'primitive', name: 'int' },
        ],
      },
    });
    const tuple = DEFAULT_VALUE_CONVERSION.resolve({
      direction: 'output',
      path: '$.functions[1].returns',
      logicalType: {
        kind: 'collection',
        name: 'tuple',
        itemTypes: [
          { kind: 'primitive', name: 'int' },
          { kind: 'primitive', name: 'str' },
        ],
      },
    });

    expect(union).toMatchObject({
      status: 'supported',
      value: { kind: 'union', options: [{ kind: 'string' }, { kind: 'integer' }] },
    });
    expect(tuple).toMatchObject({
      status: 'supported',
      value: { kind: 'tuple', items: [{ kind: 'integer' }, { kind: 'string' }] },
    });
  });

  it('requires dtype evidence before selecting the float16 scientific contract', () => {
    const resolve = (logicalType: PythonType) =>
      DEFAULT_VALUE_CONVERSION.resolve({
        direction: 'output',
        path: '$.functions[0].returns',
        logicalType,
      });

    expect(resolve({ kind: 'custom', name: 'ndarray', module: 'numpy' })).toMatchObject({
      status: 'unresolved',
    });
    expect(resolve({ kind: 'custom', name: 'Tensor', module: 'torch' })).toMatchObject({
      status: 'unresolved',
    });
    expect(resolve({
      kind: 'generic',
      name: 'NDArray',
      module: 'numpy',
      typeArgs: [{ kind: 'custom', name: 'float16', module: 'numpy' }],
    })).toMatchObject({
      status: 'supported',
      value: { kind: 'ndarray-float16', dtype: 'float16' },
    });
  });

  it('keeps the existing bytes RPC shape in the value contract', () => {
    const resolution = DEFAULT_VALUE_CONVERSION.resolve({
      direction: 'output',
      path: '$.functions[0].returns',
      logicalType: { kind: 'primitive', name: 'bytes' },
    });
    expect(resolution).toMatchObject({
      status: 'supported',
      value: { kind: 'bytes', wire: 'base64-envelope', decodedAs: 'Uint8Array' },
    });
  });

  it('matches the outer Torch dtype recorded by the decoder', () => {
    const tensorType: PythonType = {
      kind: 'generic',
      name: 'Tensor',
      module: 'torch',
      typeArgs: [{ kind: 'custom', name: 'float16', module: 'torch' }],
    };
    const resolution = DEFAULT_VALUE_CONVERSION.resolve({
      direction: 'output', path: '$.functions[0].returns', logicalType: tensorType,
    });
    expect(resolution.status).toBe('supported');
    if (resolution.status !== 'supported') {
      return;
    }
    const generated = new CodeGenerator().generateModuleDefinition({
      ...moduleModel,
      classes: [],
      functions: [{
        ...moduleModel.functions[1]!,
        name: 'tensorValue',
        returnType: tensorType,
        callableContract: {
          parameterValues: [], returnValue: resolution.value, overloads: [],
        },
      }],
    });
    expect(generated.typescript).toContain('"marker":"torch.tensor","dtype":"torch.float16"');
  });

  it('rejects a Torch float16 response with a mismatched nested dtype', async () => {
    const source = rawIr.functions[1]!;
    const ir = validateIrContract({
      ...rawIr,
      functions: [{ ...source, name: 'tensor_value', qualname: 'fixture.tensor_value',
        returns: 'torch.Tensor[torch.float16]' }],
      classes: [],
    }, 'Torch contract');
    expect(ir.ok).toBe(true);
    if (!ir.ok) {
      return;
    }
    const tensorType: PythonType = {
      kind: 'generic', name: 'Tensor', module: 'torch',
      typeArgs: [{ kind: 'custom', name: 'float16', module: 'torch' }],
    };
    const original = moduleModel.functions[1]!;
    const model: PythonModule = {
      ...moduleModel,
      classes: [],
      functions: [{
        ...original,
        name: 'tensor_value',
        returnType: tensorType,
        signature: { ...original.signature, returnType: tensorType },
      }],
    };
    const compiled = compileContract(ir.contract, {
      module: model,
      generator: new CodeGenerator(),
      conversion: DEFAULT_VALUE_CONVERSION,
      capabilities: DEFAULT_CALLABLE_CAPABILITIES,
    });
    expect(compiled.generated.typescript).toContain('"marker":"torch.tensor","dtype":"torch.float16"');

    let nestedDtype = 'float16';
    let requestId = 0;
    const server = createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        id: ++requestId,
        result: {
          __tywrap__: 'torch.tensor', codecVersion: 1, encoding: 'ndarray',
          shape: [], dtype: 'torch.float16', device: 'cpu',
          value: {
            __tywrap__: 'ndarray', codecVersion: 1, encoding: 'json',
            shape: [], dtype: nestedDtype, data: 1.5,
          },
        },
      }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as AddressInfo;
    const bridge = new HttpBridge({ baseURL: `http://127.0.0.1:${address.port}` });
    const temporary = await mkdtemp(join(process.cwd(), 'test', '.tywrap-torch-proof-'));
    try {
      const outputPath = join(temporary, 'fixture.generated.mjs');
      const javascript = ts.transpileModule(compiled.generated.typescript, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      await writeFile(outputPath, javascript, 'utf8');
      setRuntimeBridge(bridge);
      const generated = (await import(pathToFileURL(outputPath).href)) as {
        tensorValue: () => Promise<{ data: number; dtype: string }>;
      };
      await expect(generated.tensorValue()).resolves.toMatchObject({
        data: 1.5, dtype: 'torch.float16',
      });
      nestedDtype = 'float32';
      await expect(generated.tensorValue()).rejects.toThrow(/value\.dtype.*must be "float16"/);
    } finally {
      clearRuntimeBridge();
      await bridge.dispose();
      await new Promise<void>((resolve, reject) =>
        server.close(error => (error ? reject(error) : resolve()))
      );
      await rm(temporary, { recursive: true, force: true });
    }
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
