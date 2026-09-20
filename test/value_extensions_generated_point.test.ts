import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
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
const fixtureDir = join(process.cwd(), 'test', 'fixtures', 'python');
const fixturePath = join(fixtureDir, 'value_contract_point.py');
const pythonEnvironment = {
  ...process.env,
  PYTHONPATH: [
    fixtureDir,
    join(process.cwd(), 'tywrap_ir'),
    join(process.cwd(), 'test', 'prototypes'),
    process.env.PYTHONPATH,
  ]
    .filter(Boolean)
    .join(delimiter),
};

interface PointInvocationDescriptor {
  requiredCapability: 'dataclassFieldsV2';
  valuePolicy: { dataclass: 'fields-v2' };
  result: PrototypeContract;
}

function analyzedPointIr(): unknown {
  return JSON.parse(
    execFileSync(
      PYTHON ?? 'python3',
      [
        '-c',
        "from tywrap_ir.ir import emit_ir_json; print(emit_ir_json('value_contract_point', pretty=False))",
      ],
      { env: pythonEnvironment, encoding: 'utf8' }
    )
  ) as unknown;
}

function pointConversion(module: PythonModule): ValueConversionDescription {
  const point = module.classes.find(cls => cls.name === 'Point' && cls.kind === 'dataclass');
  if (!point) throw new Error('Analyzed Point dataclass is missing');
  return {
    revision: VALUE_CONTRACT_REVISION,
    resolve(request) {
      if (
        request.direction !== 'output' ||
        request.logicalType.kind !== 'custom' ||
        request.logicalType.name.split('.').at(-1) !== point.name
      ) {
        return DEFAULT_VALUE_CONVERSION.resolve(request);
      }
      const fields: ValueContractField[] = [];
      for (const property of point.properties) {
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

function compilePoint(sourceIr: unknown, useAdapter: boolean, enableAdapter: boolean) {
  const validated = validateIrContract(sourceIr, 'analyzed Point IR');
  expect(validated.ok).toBe(true);
  if (!validated.ok) throw new Error('Analyzed Point IR is invalid');
  const canonical = transformIrToTsModel(validated.contract);
  const module = {
    ...canonical,
    functions: canonical.functions.filter(func => func.name === 'make_point'),
    classes: canonical.classes.filter(cls => cls.name === 'Point'),
  };
  const compiled = compileContract(validated.contract, {
    module,
    generator: new CodeGenerator(),
    conversion: useAdapter ? pointConversion(module) : DEFAULT_VALUE_CONVERSION,
    capabilities: DEFAULT_CALLABLE_CAPABILITIES.map(capability =>
      capability.name === 'dataclass-adapter'
        ? { ...capability, available: enableAdapter }
        : capability
    ),
  });
  return { compiled, ir: validated.contract };
}

function pythonPoint(): unknown {
  return JSON.parse(
    execFileSync(
      PYTHON ?? 'python3',
      [
        '-c',
        "import json; from value_contract_point import Point, make_point; from value_extensions import encode_dataclass; print(json.dumps(encode_dataclass(make_point(), Point), separators=(',', ':')))",
      ],
      {
        env: pythonEnvironment,
        encoding: 'utf8',
      }
    )
  ) as unknown;
}

function pointContractFrom(result: ReturnType<typeof compilePoint>): PrototypeContract {
  const point = result.ir.classes.find(cls => cls.name === 'Point');
  const resolution = result.compiled.callables.find(item => item.name === 'make_point')?.result
    .resolution;
  if (
    !point ||
    !resolution ||
    resolution.status !== 'supported' ||
    resolution.value.kind !== 'record'
  ) {
    throw new Error('Analyzed Point output did not resolve to a record');
  }
  const fields: Record<string, PrototypeContract> = {};
  for (const field of resolution.value.fields) {
    if (field.value.kind !== 'integer' || field.value.constraint !== 'safe-integer') {
      throw new Error(`Unsupported Point field ${field.name}`);
    }
    fields[field.name] = { kind: 'safe-integer' };
  }
  return { kind: 'dataclass', typeId: point.qualname, fields };
}

describe.skipIf(!PYTHON_AVAILABLE || !existsSync(pythonScript) || !existsSync(fixturePath))(
  'generated Point output prototype',
  () => {
    it('keeps defaults, missing capability, and unsupported fields unresolved', () => {
      const pointIr = analyzedPointIr();
      const defaultResult = compilePoint(pointIr, false, false).compiled;
      expect(defaultResult.callables[0]?.result.resolution.status).toBe('unsupported');
      expect(defaultResult.generated.declaration).toContain('Promise<unknown>');

      const missingCapability = compilePoint(pointIr, true, false).compiled;
      expect(missingCapability.callables[0]?.result.resolution.status).toBe('unsupported');

      const unsupportedIr = structuredClone(pointIr) as {
        classes: Array<{ name: string; fields: Array<{ annotation: string }> }>;
      };
      const point = unsupportedIr.classes.find(cls => cls.name === 'Point');
      if (!point) throw new Error('Analyzed Point dataclass is missing');
      point.fields[0]!.annotation = 'object';
      const unsupported = compilePoint(unsupportedIr, true, true).compiled;
      expect(unsupported.callables[0]?.result.resolution.status).toBe('unsupported');
      expect(unsupported.generated.declaration).toContain('Promise<unknown>');
    });

    it('executes a generated Promise<Point> through the Python prototype adapter', async () => {
      const pointIr = analyzedPointIr();
      const result = compilePoint(pointIr, true, true);
      const { compiled } = result;
      const pointContract = pointContractFrom(result);
      const descriptor: PointInvocationDescriptor = {
        requiredCapability: 'dataclassFieldsV2',
        valuePolicy: { dataclass: 'fields-v2' },
        result: pointContract,
      };
      expect(compiled.diagnostics.filter(item => item.severity === 'error')).toEqual([]);
      expect(compiled.callables[0]?.requiredCapabilities).toContain('dataclass-adapter');
      expect(compiled.generated.declaration).toContain('makePoint(): Promise<Point>');
      expect(compiled.generated.declaration).toContain(
        'export type Point = { x: number; y: number; }'
      );
      expect(result.ir.classes.find(cls => cls.name === 'Point')?.fields[1]?.default).toBe(true);
      expect(compiled.generated.typescript).toContain('"constraint":"safe-integer"');
      const bound = new CodeGenerator().generateModuleBindingTemplate(compiled.module);
      expect(bound.declaration).toBe(compiled.generated.declaration);
      expect(bound.typescript).toContain('__tywrapRuntimeProvider().call');
      expect(bound.typescript).not.toContain('getRuntimeBridge().call');

      const temporary = await mkdtemp(join(process.cwd(), 'test', '.tywrap-point-'));
      try {
        const outputPath = join(temporary, 'value_contract_point.generated.mjs');
        const declarationPath = join(temporary, 'value_contract_point.generated.d.ts');
        const consumerPath = join(temporary, 'consumer.ts');
        const binding = `
import { getRuntimeBridge } from 'tywrap/runtime';
type PolicyCall = <T>(
  module: string,
  functionName: string,
  args: unknown[],
  kwargs: Record<string, unknown> | undefined,
  validate: ((result: T) => void) | undefined,
  descriptor: unknown
) => Promise<T>;
function __tywrapRuntimeProvider() {
  const bridge = getRuntimeBridge() as ReturnType<typeof getRuntimeBridge> & {
    callWithValuePolicy?: PolicyCall;
  };
  if (typeof bridge.callWithValuePolicy !== 'function') {
    throw new Error('bridge lacks the Point value-policy adapter');
  }
  return {
    call<T>(
      module: string,
      functionName: string,
      args: unknown[],
      kwargs?: Record<string, unknown>,
      validate?: (result: T) => void
    ): Promise<T> {
      return bridge.callWithValuePolicy!<T>(
        module, functionName, args, kwargs, validate, ${JSON.stringify(descriptor)}
      );
    },
  };
}
`;
        const javascript = ts.transpileModule(bound.typescript + binding, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText;
        await writeFile(outputPath, javascript, 'utf8');
        await writeFile(declarationPath, compiled.generated.declaration, 'utf8');
        await writeFile(
          consumerPath,
          `import { makePoint, type Point } from './value_contract_point.generated.js';
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
        const adapterBridge = {
          async call<T>(): Promise<T> {
            throw new Error('the bound Point wrapper must use the policy adapter');
          },
          async callWithValuePolicy<T>(
            moduleName: string,
            functionName: string,
            _args: unknown[],
            _kwargs?: Record<string, unknown>,
            validate?: (result: T) => void,
            invocation?: PointInvocationDescriptor
          ): Promise<T> {
            expect([moduleName, functionName]).toEqual(['value_contract_point', 'make_point']);
            expect(invocation).toEqual(descriptor);
            if (!invocation) throw new Error('Point invocation descriptor is missing');
            requireCapability(
              bridgeMeta,
              invocation.requiredCapability,
              invocation.valuePolicy.dataclass
            );
            const decoded = decodeExactResponse(wire, invocation.result);
            validateDataclassOrigin(decoded, invocation.result);
            validate?.(decoded as T);
            return decoded as T;
          },
          async dispose(): Promise<void> {},
        };
        setRuntimeBridge(adapterBridge);
        const generated = (await import(pathToFileURL(outputPath).href)) as {
          makePoint: () => Promise<{ x: number; y: number }>;
        };

        await expect(generated.makePoint()).resolves.toEqual({ x: 1, y: 2 });
        setRuntimeBridge({
          async call<T>(): Promise<T> {
            throw new Error('ordinary bridge call must not run');
          },
          async dispose(): Promise<void> {},
        });
        await expect(generated.makePoint()).rejects.toThrow(/lacks the Point value-policy adapter/);
        setRuntimeBridge(adapterBridge);
        bridgeMeta = {};
        await expect(generated.makePoint()).rejects.toThrow(/bridge lacks dataclassFieldsV2/);
        bridgeMeta = { valueCapabilities: ['dataclassFieldsV2'] };
        const valid = pythonPoint() as { fields: Record<string, unknown> };
        for (const bad of [
          { ...valid, fields: { x: 1 } },
          { ...valid, fields: { x: 1, y: 2, z: 3 } },
          { ...valid, fields: { x: '1', y: 2 } },
          { ...valid, type: 'other.Point' },
          { x: 1, y: 2 },
        ]) {
          wire = bad;
          await expect(generated.makePoint()).rejects.toThrow();
        }

        setRuntimeBridge({
          async call<T>(): Promise<T> {
            throw new Error('ordinary bridge call must not run');
          },
          async callWithValuePolicy<T>(
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
