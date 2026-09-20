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
  EXACT_INTEGER_VALUE_CONVERSION,
  type CompiledContract,
} from '../src/core/callable-compiler.js';
import { CodeGenerator } from '../src/core/generator.js';
import { validateIrContract } from '../src/core/ir-contract.js';
import { transformIrToTsModel } from '../src/core/ir-model.js';
import { BridgeValidationError } from '../src/runtime/errors.js';
import { clearRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';
import type { PythonModule } from '../src/types/index.js';
import { PYTHON, PYTHON_AVAILABLE } from './helpers/python-probe.js';
import {
  decodeExactResponse,
  encodeExactRequest,
  type PrototypeContract,
} from './prototypes/value_extensions.js';
import { toExactPrototypeContract } from './prototypes/value_contract_v3_adapter.js';

const fixtureDir = join(process.cwd(), 'test', 'fixtures', 'python');
const fixturePath = join(fixtureDir, 'value_contract_exact_integer.py');
const pythonAdapter = join(process.cwd(), 'test', 'prototypes', 'value_exact_call.py');
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

interface ExactInvocationDescriptor {
  requiredCapability: 'exactIntegerDecimalV2';
  valuePolicy: { integer: 'bigint-v2' };
  args: PrototypeContract;
  result: PrototypeContract;
}

function analyzedIr(): unknown {
  return JSON.parse(
    execFileSync(
      PYTHON ?? 'python3',
      [
        '-c',
        "from tywrap_ir.ir import emit_ir_json; print(emit_ir_json('value_contract_exact_integer', pretty=False))",
      ],
      { env: pythonEnvironment, encoding: 'utf8' }
    )
  ) as unknown;
}

function compileInteger(ir: unknown, exact: boolean, bound = false): CompiledContract {
  const validated = validateIrContract(ir, 'analyzed exact integer IR');
  expect(validated.ok).toBe(true);
  if (!validated.ok) throw new Error('Exact integer IR is invalid');
  const module = transformIrToTsModel(validated.contract);
  const generator = new CodeGenerator();
  return compileContract(validated.contract, {
    module,
    generator: bound
      ? {
          generateModuleDefinition(model: PythonModule, annotatedJSDoc = false) {
            return generator.generateModuleBindingTemplate(model, annotatedJSDoc);
          },
        }
      : generator,
    conversion: exact ? EXACT_INTEGER_VALUE_CONVERSION : DEFAULT_VALUE_CONVERSION,
    capabilities: DEFAULT_CALLABLE_CAPABILITIES.map(capability =>
      capability.name === 'exact-integer-adapter' ? { ...capability, available: exact } : capability
    ),
  });
}

function descriptorFrom(compiled: CompiledContract): ExactInvocationDescriptor {
  const callable = compiled.callables.find(item => item.name === 'combine_exact');
  const functionModel = compiled.module.functions.find(item => item.name === 'combine_exact');
  if (!callable || !functionModel || callable.result.resolution.status !== 'supported') {
    throw new Error('Exact callable result is unresolved');
  }
  const fields: Record<string, PrototypeContract> = {};
  for (const [index, parameter] of functionModel.parameters.entries()) {
    const resolution = callable.parameters[index]?.resolution;
    if (!resolution || resolution.status !== 'supported') {
      throw new Error(`Exact parameter ${parameter.name} is unresolved`);
    }
    fields[parameter.name] = toExactPrototypeContract(resolution.value);
  }
  return {
    requiredCapability: 'exactIntegerDecimalV2',
    valuePolicy: { integer: 'bigint-v2' },
    args: { kind: 'record', fields },
    result: toExactPrototypeContract(callable.result.resolution.value),
  };
}

describe.skipIf(!PYTHON_AVAILABLE || !existsSync(fixturePath) || !existsSync(pythonAdapter))(
  'generated exact integer proof',
  () => {
    it('keeps default numeric types and fails closed without exact adapter capability', () => {
      const ir = analyzedIr();
      const ordinary = compileInteger(ir, false);
      expect(ordinary.generated.declaration).toContain('value: number');
      expect(ordinary.generated.declaration).toContain('nested: number[]');
      expect(ordinary.generated.declaration).toContain('Promise<number>');

      const validated = validateIrContract(ir, 'exact integer capability control');
      expect(validated.ok).toBe(true);
      if (!validated.ok) throw new Error('Exact integer IR is invalid');
      const module = transformIrToTsModel(validated.contract);
      expect(() =>
        compileContract(validated.contract, {
          module,
          generator: new CodeGenerator(),
          conversion: EXACT_INTEGER_VALUE_CONVERSION,
          capabilities: DEFAULT_CALLABLE_CAPABILITIES,
        })
      ).toThrow(/exact-integer-adapter is unavailable/);
    });

    it('executes a bound bigint wrapper with pre-send capability checks', async () => {
      const compiled = compileInteger(analyzedIr(), true, true);
      const descriptor = descriptorFrom(compiled);
      expect(compiled.callables[0]?.requiredCapabilities).toContain('exact-integer-adapter');
      expect(compiled.generated.declaration).toContain('value: bigint');
      expect(compiled.generated.declaration).toContain('nested: bigint[]');
      expect(compiled.generated.declaration).toContain('flag: boolean');
      expect(compiled.generated.declaration).toContain('ratio: number');
      expect(compiled.generated.declaration).toContain('Promise<bigint>');
      expect(compiled.generated.typescript).toContain('"kind":"primitive","type":"bigint"');
      expect(compiled.generated.typescript).toContain('__tywrapRuntimeProvider().call');

      const temporary = await mkdtemp(join(process.cwd(), 'test', '.tywrap-integer-'));
      try {
        const outputPath = join(temporary, 'value_contract_exact_integer.generated.mjs');
        const declarationPath = join(temporary, 'value_contract_exact_integer.generated.d.ts');
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
    meta?: { valueCapabilities?: unknown };
    callWithValuePolicy?: PolicyCall;
  };
  const capabilities = bridge.meta?.valueCapabilities;
  if (!Array.isArray(capabilities) || !capabilities.includes('exactIntegerDecimalV2')) {
    throw new Error('bridge lacks exactIntegerDecimalV2 capability');
  }
  if (typeof bridge.callWithValuePolicy !== 'function') {
    throw new Error('bridge lacks the exact integer value-policy adapter');
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
        const javascript = ts.transpileModule(compiled.generated.typescript + binding, {
          compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        }).outputText;
        await writeFile(outputPath, javascript, 'utf8');
        await writeFile(declarationPath, compiled.generated.declaration, 'utf8');
        await writeFile(
          consumerPath,
          `import { combineExact } from './value_contract_exact_integer.generated.js';
const result: Promise<bigint> = combineExact(1n, [2n], true, 1.5);
result.then(value => {
  const valid: bigint = value;
  // @ts-expect-error Exact result is bigint.
  const wrong: number = value;
  return valid + BigInt(wrong);
});
// @ts-expect-error Exact input is bigint.
combineExact(1, [2n], true, 1.5);
// @ts-expect-error Nested exact input is bigint[].
combineExact(1n, [2], true, 1.5);`,
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

        let sent = 0;
        let responseOverride: unknown;
        const bridge = {
          meta: { valueCapabilities: ['exactIntegerDecimalV2'] },
          async call<T>(): Promise<T> {
            throw new Error('the exact wrapper must use its policy adapter');
          },
          async callWithValuePolicy<T>(
            moduleName: string,
            functionName: string,
            args: unknown[],
            _kwargs?: Record<string, unknown>,
            validate?: (result: T) => void,
            invocation?: ExactInvocationDescriptor
          ): Promise<T> {
            expect([moduleName, functionName]).toEqual([
              'value_contract_exact_integer',
              'combine_exact',
            ]);
            expect(invocation).toEqual(descriptor);
            if (!invocation || invocation.args.kind !== 'record') {
              throw new Error('Exact invocation descriptor is missing');
            }
            const names = Object.keys(invocation.args.fields);
            const input = Object.fromEntries(names.map((name, index) => [name, args[index]]));
            const encoded = encodeExactRequest(input, invocation.args) as Record<string, unknown>;
            const request = {
              module: moduleName,
              functionName,
              params: {
                valuePolicy: invocation.valuePolicy,
                args: names.map(name => encoded[name]),
              },
            };
            const raw = JSON.stringify(request);
            if (new TextEncoder().encode(raw).length > 10 * 1024 * 1024) {
              throw new Error('exact request exceeds byte limit');
            }
            sent += 1;
            const response = JSON.parse(
              execFileSync(
                PYTHON ?? 'python3',
                [pythonAdapter, JSON.stringify(invocation.args), JSON.stringify(this.meta)],
                { input: raw, env: pythonEnvironment, encoding: 'utf8', maxBuffer: 1024 * 1024 }
              )
            ) as unknown;
            const decoded = decodeExactResponse(
              responseOverride === undefined ? response : responseOverride,
              invocation.result
            );
            validate?.(decoded as T);
            return decoded as T;
          },
          async dispose(): Promise<void> {},
        };
        setRuntimeBridge(bridge);
        const generated = (await import(pathToFileURL(outputPath).href)) as {
          combineExact: (
            value: bigint,
            nested: bigint[],
            flag: boolean,
            ratio: number
          ) => Promise<bigint>;
        };

        const positive = 2n ** 80n + 1n;
        const negative = -(2n ** 130n + 7n);
        await expect(generated.combineExact(positive, [7n, negative], true, 1.5)).resolves.toBe(
          positive + 7n + negative
        );
        await expect(generated.combineExact(7n, [2n], true, 0)).resolves.toBe(9n);
        await expect(generated.combineExact(7n, [2n], true, -0)).resolves.toBe(-9n);
        await expect(generated.combineExact(7n, [2n], false, 1.5)).resolves.toBe(-9n);

        const beforeMissing = sent;
        bridge.meta = { valueCapabilities: [] };
        await expect(generated.combineExact(7n, [2n], true, 1.5)).rejects.toThrow(
          /bridge lacks exactIntegerDecimalV2 capability/
        );
        expect(sent).toBe(beforeMissing);
        bridge.meta = { valueCapabilities: ['exactIntegerDecimalV2'] };
        responseOverride = {
          __tywrap__: 'integer',
          codecVersion: 1,
          encoding: 'decimal',
          value: '9',
        };
        await expect(generated.combineExact(7n, [2n], true, 1.5)).rejects.toThrow(
          /invalid integer envelope/
        );
        responseOverride = 9;
        await expect(generated.combineExact(7n, [2n], true, 1.5)).rejects.toThrow(
          /expected integer envelope/
        );

        const bypassBridge = {
          meta: { valueCapabilities: ['exactIntegerDecimalV2'] },
          async call<T>(): Promise<T> {
            throw new Error('ordinary call must not run');
          },
          async callWithValuePolicy<T>(
            _module: string,
            _functionName: string,
            _args: unknown[],
            _kwargs?: Record<string, unknown>,
            validate?: (result: T) => void
          ): Promise<T> {
            const wrong = 9 as unknown as T;
            validate?.(wrong);
            return wrong;
          },
          async dispose(): Promise<void> {},
        };
        setRuntimeBridge(bypassBridge);
        await expect(generated.combineExact(7n, [2n], true, 1.5)).rejects.toThrow(
          BridgeValidationError
        );

        const ordinary = compileInteger(analyzedIr(), false);
        const ordinaryPath = join(temporary, 'value_contract_integer_default.generated.mjs');
        await writeFile(
          ordinaryPath,
          ts.transpileModule(ordinary.generated.typescript, {
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
          }).outputText,
          'utf8'
        );
        let ordinaryCalls = 0;
        let exactCalls = 0;
        const compatibleBridge = {
          async call<T>(): Promise<T> {
            ordinaryCalls += 1;
            return 9 as T;
          },
          async callWithValuePolicy<T>(): Promise<T> {
            exactCalls += 1;
            throw new Error('default calls must not select the exact policy');
          },
          async dispose(): Promise<void> {},
        };
        setRuntimeBridge(compatibleBridge);
        const defaultGenerated = (await import(pathToFileURL(ordinaryPath).href)) as {
          combineExact: (
            value: number,
            nested: number[],
            flag: boolean,
            ratio: number
          ) => Promise<number>;
        };
        await expect(defaultGenerated.combineExact(7, [2], true, 1.5)).resolves.toBe(9);
        expect(ordinaryCalls).toBe(1);
        expect(exactCalls).toBe(0);
      } finally {
        clearRuntimeBridge();
        await rm(temporary, { recursive: true, force: true });
      }
    });
  }
);
