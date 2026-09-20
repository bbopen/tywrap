import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  compileContract,
  DEFAULT_CALLABLE_CAPABILITIES,
  DEFAULT_VALUE_CONVERSION,
  type ValueConversionDescription,
} from '../src/core/callable-compiler.js';
import { CodeGenerator } from '../src/core/generator.js';
import { validateIrContract } from '../src/core/ir-contract.js';
import { transformIrToTsModel } from '../src/core/ir-model.js';
import {
  VALUE_CONTRACT_REVISION,
  type ValueContractField,
} from '../src/contracts/value-contract.js';
import { BridgeValidationError } from '../src/runtime/errors.js';
import { clearRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';
import type { PythonModule } from '../src/types/index.js';
import { PYTHON, PYTHON_AVAILABLE } from './helpers/python-probe.js';
import {
  decodeExactResponse,
  requireCapability,
  validateDataclassOrigin,
  type PrototypeContract,
} from './prototypes/value_extensions.js';

const pythonScript = join(process.cwd(), 'test', 'prototypes', 'value_extensions.py');
const pointContract: PrototypeContract = {
  kind: 'dataclass',
  typeId: '__main__.Point',
  fields: { x: { kind: 'safe-integer' }, y: { kind: 'safe-integer' } },
};

const pointIr = {
  ir_version: '0.4.0',
  module: 'value_extensions',
  functions: [
    {
      name: 'make_point',
      qualname: 'value_extensions.make_point',
      docstring: null,
      parameters: [],
      returns: 'Point',
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
      qualname: 'value_extensions.Point',
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

function pointConversion(module: PythonModule): ValueConversionDescription {
  return {
    revision: VALUE_CONTRACT_REVISION,
    resolve(request) {
      if (
        request.direction !== 'output' ||
        request.logicalType.kind !== 'custom' ||
        request.logicalType.name !== 'Point'
      ) {
        return DEFAULT_VALUE_CONVERSION.resolve(request);
      }
      const fields: ValueContractField[] = [];
      for (const property of module.classes[0]!.properties) {
        const resolved = DEFAULT_VALUE_CONVERSION.resolve({
          ...request,
          logicalType: property.type,
          path: `${request.path}.${property.name}`,
        });
        if (resolved.status !== 'supported') {
          return {
            status: 'unsupported',
            reason: `No value contract for Point.${property.name}`,
            guidance: 'Use a supported dataclass field annotation.',
          };
        }
        fields.push({ name: property.name, value: resolved.value, required: true });
      }
      return {
        status: 'supported',
        value: { kind: 'record', wire: 'json', decodedAs: 'object', fields },
      };
    },
  };
}

function compilePoint(sourceIr: typeof pointIr, useAdapter: boolean, enableAdapter: boolean) {
  const validated = validateIrContract(sourceIr, 'Point prototype IR');
  expect(validated.ok).toBe(true);
  if (!validated.ok) throw new Error('Point prototype IR is invalid');
  const module = transformIrToTsModel(validated.contract);
  return compileContract(validated.contract, {
    module,
    generator: new CodeGenerator(),
    conversion: useAdapter ? pointConversion(module) : DEFAULT_VALUE_CONVERSION,
    capabilities: DEFAULT_CALLABLE_CAPABILITIES.map(capability =>
      capability.name === 'dataclass-adapter'
        ? { ...capability, available: enableAdapter }
        : capability
    ),
  });
}

function pythonPoint(): unknown {
  return JSON.parse(
    execFileSync(PYTHON ?? 'python3', [pythonScript, 'encode-point'], {
      input: JSON.stringify({ x: 1, y: 2 }),
      encoding: 'utf8',
    })
  ) as unknown;
}

describe.skipIf(!PYTHON_AVAILABLE || !existsSync(pythonScript))(
  'generated Point output prototype',
  () => {
    it('keeps defaults, missing capability, and unsupported fields unresolved', () => {
      const defaultResult = compilePoint(pointIr, false, false);
      expect(defaultResult.callables[0]?.result.resolution.status).toBe('unsupported');
      expect(defaultResult.generated.declaration).toContain('Promise<unknown>');

      const missingCapability = compilePoint(pointIr, true, false);
      expect(missingCapability.callables[0]?.result.resolution.status).toBe('unsupported');

      const unsupportedIr = {
        ...pointIr,
        classes: [
          {
            ...pointIr.classes[0]!,
            fields: [
              { ...pointIr.classes[0]!.fields[0]!, annotation: 'object' },
              pointIr.classes[0]!.fields[1]!,
            ],
          },
        ],
      };
      const unsupported = compilePoint(unsupportedIr, true, true);
      expect(unsupported.callables[0]?.result.resolution.status).toBe('unsupported');
      expect(unsupported.generated.declaration).toContain('Promise<unknown>');
    });

    it('executes a generated Promise<Point> through the Python prototype adapter', async () => {
      const compiled = compilePoint(pointIr, true, true);
      expect(compiled.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
      expect(compiled.callables[0]?.requiredCapabilities).toContain('dataclass-adapter');
      expect(compiled.generated.declaration).toContain('makePoint(): Promise<Point>');
      expect(compiled.generated.declaration).toContain(
        'export type Point = { x: number; y: number; }'
      );
      expect(compiled.generated.typescript).toContain('"constraint":"safe-integer"');

      const temporary = await mkdtemp(join(process.cwd(), 'test', '.tywrap-point-'));
      try {
        const outputPath = join(temporary, 'value_extensions.generated.mjs');
        const declarationPath = join(temporary, 'value_extensions.generated.d.ts');
        const consumerPath = join(temporary, 'consumer.ts');
        const javascript = ts.transpileModule(compiled.generated.typescript, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText;
        await writeFile(outputPath, javascript, 'utf8');
        await writeFile(declarationPath, compiled.generated.declaration, 'utf8');
        await writeFile(
          consumerPath,
          `import { makePoint, type Point } from './value_extensions.generated.js';
const result: Promise<Point> = makePoint();
result.then(point => {
  const x: number = point.x;
  const y: number = point.y;
  // @ts-expect-error Point.x is a number.
  const wrong: string = point.x;
  // @ts-expect-error Point has no z field.
  point.z;
  return x + y + wrong.length;
});`,
          'utf8'
        );
        const program = ts.createProgram([consumerPath], {
          module: ts.ModuleKind.NodeNext,
          moduleResolution: ts.ModuleResolutionKind.NodeNext,
          target: ts.ScriptTarget.ES2022,
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
        });
        expect(
          ts
            .getPreEmitDiagnostics(program)
            .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        ).toEqual([]);

        let wire: unknown = pythonPoint();
        let bridgeMeta: unknown = { valueCapabilities: ['dataclassFieldsV2'] };
        setRuntimeBridge({
          async call<T>(
            moduleName: string,
            functionName: string,
            _args: unknown[],
            _kwargs?: Record<string, unknown>,
            validate?: (result: T) => void
          ): Promise<T> {
            expect([moduleName, functionName]).toEqual(['value_extensions', 'make_point']);
            requireCapability(bridgeMeta, 'dataclassFieldsV2', 'fields-v2');
            const decoded = decodeExactResponse(wire, pointContract);
            validateDataclassOrigin(decoded, pointContract);
            validate?.(decoded as T);
            return decoded as T;
          },
          async dispose(): Promise<void> {},
        });
        const generated = (await import(pathToFileURL(outputPath).href)) as {
          makePoint: () => Promise<{ x: number; y: number }>;
        };

        await expect(generated.makePoint()).resolves.toEqual({ x: 1, y: 2 });
        bridgeMeta = {};
        await expect(generated.makePoint()).rejects.toThrow(/bridge lacks dataclassFieldsV2/);
        bridgeMeta = { valueCapabilities: ['dataclassFieldsV2'] };
        const valid = pythonPoint() as { fields: Record<string, unknown> };
        for (const bad of [
          { ...valid, fields: { x: 1 } },
          { ...valid, fields: { x: 1, y: 2, z: 3 } },
          { ...valid, fields: { x: '1', y: 2 } },
          { x: 1, y: 2 },
        ]) {
          wire = bad;
          await expect(generated.makePoint()).rejects.toThrow();
        }

        setRuntimeBridge({
          async call<T>(
            _module: string,
            _functionName: string,
            _args: unknown[],
            _kwargs?: Record<string, unknown>,
            validate?: (result: T) => void
          ): Promise<T> {
            const wrong = { x: '1', y: 2 } as unknown as T;
            validate?.(wrong);
            return wrong;
          },
          async dispose(): Promise<void> {},
        });
        await expect(generated.makePoint()).rejects.toThrow(BridgeValidationError);
      } finally {
        clearRuntimeBridge();
        await rm(temporary, { recursive: true, force: true });
      }
    });
  }
);
