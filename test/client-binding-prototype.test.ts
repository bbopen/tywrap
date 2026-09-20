import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { BridgeDisposedError } from 'tywrap';
import { HttpBridge } from 'tywrap/http';
import { NodeBridge } from 'tywrap/node';
import { clearRuntimeBridge, getRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';

import {
  compileContract,
  DEFAULT_CALLABLE_CAPABILITIES,
  DEFAULT_VALUE_CONVERSION,
} from '../src/core/callable-compiler.js';
import {
  renderClientBindingPrototype,
  type BindingPrototypeCode,
} from '../src/core/client-binding-prototype.js';
import { CodeGenerator } from '../src/core/generator.js';
import { validateIrContract } from '../src/core/ir-contract.js';
import { transformIrToTsModel } from '../src/core/ir-model.js';
import { createBridgeReloader } from '../src/dev.js';
import { generate } from '../src/tywrap.js';
import type { GeneratedCode, PythonModule, RuntimeExecution } from '../src/types/index.js';
import { getDefaultPythonPath } from '../src/utils/python.js';
import { processUtils } from '../src/utils/runtime.js';
import { PYTHON_AVAILABLE } from './helpers/python-probe.js';

interface FixtureApi {
  environment(): Promise<string>;
  createClient(): Promise<string>;
  dispose(): Promise<string>;
  identity<T>(value: T): Promise<T>;
  select(value: string | number): Promise<string | number>;
  scale(value: number, factor?: number): Promise<number>;
  kwOnly(kwargs?: { label: string }): Promise<string>;
  echoBytes(value: Uint8Array): Promise<Uint8Array>;
  invalidReturn(): Promise<number>;
  fail(): Promise<string>;
  Client: { label(value: string): Promise<string> };
}

interface FixtureHandle {
  api: FixtureApi;
  dispose(): void;
}

interface ClientModule {
  bindRuntime(runtime: RuntimeExecution): FixtureHandle;
}

interface LegacyModule {
  environment(): Promise<string>;
  scale(value: number, factor?: number): Promise<number>;
  kwOnly(kwargs?: { label: string }): Promise<string>;
  echoBytes(value: Uint8Array): Promise<Uint8Array>;
  invalidReturn(): Promise<number>;
  Client: { label(value: string): Promise<string> };
}

class LabeledRuntime implements RuntimeExecution {
  disposed = false;

  constructor(readonly label: string) {}

  async call<T = unknown>(
    _module: string,
    _functionName: string,
    _args: unknown[],
    _kwargs?: Record<string, unknown>,
    validate?: (result: T) => void
  ): Promise<T> {
    if (this.disposed) throw new BridgeDisposedError('Bridge has been disposed');
    const result = this.label as T;
    validate?.(result);
    return result;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
  }
}

const fixtureA = resolve('test/fixtures/python/binding_a');
const fixtureB = resolve('test/fixtures/python/binding_b');
const bridgeScript = resolve('runtime/python_bridge.py');
const pythonPath = getDefaultPythonPath();
const defaultExcludedExports = new Set([
  'dataclass',
  'property',
  'staticmethod',
  'classmethod',
  'abstractmethod',
  'cached_property',
]);

async function bindingTemplate(
  outputDir: string,
  moduleName: string
): Promise<{ baseline: GeneratedCode; template: GeneratedCode; module: PythonModule }> {
  const contractPath = join(outputDir, `${moduleName}.contract.json`);
  const parsed: unknown = JSON.parse(await readFile(contractPath, 'utf8'));
  const validated = validateIrContract(parsed, contractPath, { allowOmittedMetadata: true });
  if (!validated.ok || !validated.contract) {
    throw new Error(`Invalid generated contract: ${JSON.stringify(validated.diagnostics)}`);
  }
  const generator = new CodeGenerator();
  const model = transformIrToTsModel(validated.contract);
  model.functions = model.functions.filter(func => !defaultExcludedExports.has(func.name));
  model.classes = model.classes.filter(cls => !defaultExcludedExports.has(cls.name));
  const compiled = compileContract(validated.contract, {
    module: model,
    generator,
    conversion: DEFAULT_VALUE_CONVERSION,
    capabilities: DEFAULT_CALLABLE_CAPABILITIES,
  });
  const emittedSource = await readFile(join(outputDir, `${moduleName}.generated.ts`), 'utf8');
  const emittedDeclaration = await readFile(
    join(outputDir, `${moduleName}.generated.d.ts`),
    'utf8'
  );
  if (
    compiled.generated.typescript !== emittedSource ||
    compiled.generated.declaration !== emittedDeclaration
  ) {
    throw new Error('Compiled contract differs from default generated output');
  }
  return {
    baseline: compiled.generated,
    template: generator.generateModuleBindingTemplate(compiled.module),
    module: compiled.module,
  };
}

describe.skipIf(!PYTHON_AVAILABLE)('explicit generated client binding prototype', () => {
  let temporary = '';
  let generatedDir = '';
  let originalSource = '';
  let originalDeclaration = '';
  let supportsOverloadExtraction = false;
  let compiledModule: PythonModule;
  let prototype: BindingPrototypeCode;
  let clientModule: ClientModule;
  let legacyModule: LegacyModule;

  beforeAll(async () => {
    const overloadProbe = await processUtils.exec(
      pythonPath,
      ['-c', 'import typing; print(int(hasattr(typing, "get_overloads")))'],
      { timeoutMs: 10_000 }
    );
    expect(overloadProbe.code, overloadProbe.stderr).toBe(0);
    supportsOverloadExtraction = overloadProbe.stdout.trim() === '1';
    temporary = await mkdtemp(join(process.cwd(), 'test', '.tywrap-binding-'));
    generatedDir = join(temporary, 'generated');
    const generated = await generate({
      pythonModules: { binding_fixture: { runtime: 'node', typeHints: 'strict' } },
      pythonImportPath: [fixtureA],
      output: { dir: generatedDir, format: 'esm', declaration: true, sourceMap: false },
      runtime: { node: { pythonPath } },
      performance: { caching: false, batching: false, compression: 'none' },
    });
    expect(generated.failures).toEqual([]);
    originalSource = await readFile(join(generatedDir, 'binding_fixture.generated.ts'), 'utf8');
    originalDeclaration = await readFile(
      join(generatedDir, 'binding_fixture.generated.d.ts'),
      'utf8'
    );
    const compiled = await bindingTemplate(generatedDir, 'binding_fixture');
    compiledModule = compiled.module;
    expect(compiled.baseline.typescript).toBe(originalSource);
    expect(compiled.baseline.declaration).toBe(originalDeclaration);
    prototype = renderClientBindingPrototype(
      {
        typescript: originalSource,
        declaration: originalDeclaration,
        metadata: { generatedAt: new Date(0), sourceFiles: [], runtime: 'auto', optimizations: [] },
      },
      compiled.template,
      'binding_fixture'
    );

    const files = [
      ['binding_fixture.generated', prototype.typescript, prototype.declaration],
      [
        'binding_fixture.generated.core',
        prototype.bindingPrototype.core.typescript,
        prototype.bindingPrototype.core.declaration,
      ],
      [
        'binding_fixture.generated.client',
        prototype.bindingPrototype.client.typescript,
        prototype.bindingPrototype.client.declaration,
      ],
    ] as const;
    for (const [stem, source, declaration] of files) {
      await writeFile(join(generatedDir, `${stem}.ts`), source, 'utf8');
      await writeFile(join(generatedDir, `${stem}.d.ts`), declaration, 'utf8');
      const javascript = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      await writeFile(join(generatedDir, `${stem}.js`), javascript, 'utf8');
    }
    clientModule = (await import(
      pathToFileURL(join(generatedDir, 'binding_fixture.generated.client.js')).href
    )) as ClientModule;
    legacyModule = (await import(
      pathToFileURL(join(generatedDir, 'binding_fixture.generated.js')).href
    )) as LegacyModule;
  }, 60_000);

  afterAll(async () => {
    clearRuntimeBridge();
    if (temporary) await rm(temporary, { recursive: true, force: true });
  });

  it('uses one generated call implementation and keeps default bytes intact', () => {
    const core = prototype.bindingPrototype.core.typescript;
    const callableCount = (originalSource.match(/getRuntimeBridge\(\)\.call/g) ?? []).length;
    expect(callableCount).toBeGreaterThan(0);
    expect(core.match(/__tywrapRuntimeProvider\(\)\.call/g)).toHaveLength(callableCount);
    expect(prototype.typescript).not.toContain('.call<');
    expect(prototype.bindingPrototype.client.typescript).not.toContain('.call<');
    expect(originalSource).toContain('getRuntimeBridge().call');
    expect(originalDeclaration).toContain('export class Client');

    const sourceBytes = Buffer.byteLength(originalSource);
    const declarationBytes = Buffer.byteLength(originalDeclaration);
    const optInSourceBytes =
      Buffer.byteLength(prototype.typescript) +
      Buffer.byteLength(core) +
      Buffer.byteLength(prototype.bindingPrototype.client.typescript);
    const optInDeclarationBytes =
      Buffer.byteLength(prototype.declaration) +
      Buffer.byteLength(prototype.bindingPrototype.core.declaration) +
      Buffer.byteLength(prototype.bindingPrototype.client.declaration);
    const sourceDeltaPerCallable = (optInSourceBytes - sourceBytes) / callableCount;
    expect(sourceDeltaPerCallable).toBeGreaterThan(0);
    console.info(
      JSON.stringify({
        fixture: 'binding_fixture',
        callableCount,
        sourceBytes,
        declarationBytes,
        optInSourceBytes,
        optInDeclarationBytes,
        sourceDeltaPerCallable,
      })
    );
  });

  it('executes an allocated runtime getter without falling back to the registry', async () => {
    const getter = '__tywrapRuntimeProvider1';
    const template = new CodeGenerator().generateModuleBindingTemplate(
      compiledModule,
      false,
      getter
    );
    const allocated = renderClientBindingPrototype(
      {
        typescript: originalSource,
        declaration: originalDeclaration,
        metadata: { generatedAt: new Date(0), sourceFiles: [], runtime: 'auto', optimizations: [] },
      },
      template,
      'binding_fixture',
      getter
    );
    expect(allocated.bindingPrototype.core.typescript).toContain(`${getter}().call`);
    expect(allocated.bindingPrototype.core.typescript).not.toContain('getRuntimeBridge().call');
    const allocatedDir = join(temporary, 'allocated');
    await mkdir(allocatedDir);
    for (const [stem, source] of [
      ['binding_fixture.generated.core', allocated.bindingPrototype.core.typescript],
      ['binding_fixture.generated.client', allocated.bindingPrototype.client.typescript],
    ] as const) {
      const javascript = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      await writeFile(join(allocatedDir, `${stem}.js`), javascript, 'utf8');
    }
    const module = (await import(
      pathToFileURL(join(allocatedDir, 'binding_fixture.generated.client.js')).href
    )) as ClientModule;
    const handle = module.bindRuntime(new LabeledRuntime('allocated'));
    try {
      await expect(handle.api.environment()).resolves.toBe('allocated');
    } finally {
      handle.dispose();
    }
  });

  it('keeps two Python environments separate across interleaved and concurrent calls', async () => {
    clearRuntimeBridge();
    const bridgeA = new NodeBridge({
      pythonPath,
      scriptPath: bridgeScript,
      env: { PYTHONPATH: fixtureA },
    });
    const bridgeB = new NodeBridge({
      pythonPath,
      scriptPath: bridgeScript,
      env: { PYTHONPATH: fixtureB },
    });
    const a = clientModule.bindRuntime(bridgeA);
    const b = clientModule.bindRuntime(bridgeB);
    try {
      expect(() => getRuntimeBridge()).toThrow('No runtime bridge configured');
      expect(await Promise.all([a.api.environment(), b.api.environment()])).toEqual(['A', 'B']);
      expect(await a.api.environment()).toBe('A');
      expect(await b.api.environment()).toBe('B');
      expect(await Promise.all([b.api.Client.label('x'), a.api.Client.label('y')])).toEqual([
        'B:x',
        'A:y',
      ]);
      expect(await a.api.createClient()).toBe('A-client');
      expect(await a.api.dispose()).toBe('A-dispose');
      expect(await a.api.identity('x')).toBe('x');
      expect(await a.api.select(4)).toBe(4);
      expect(await a.api.select('four')).toBe('four');
      expect(await a.api.scale(3)).toBe(3);
      expect(await a.api.scale(3, 4)).toBe(12);
      expect(await a.api.kwOnly({ label: 'ok' })).toBe('A:ok');
      expect(await a.api.echoBytes(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));

      await expect(a.api.invalidReturn()).rejects.toThrow('Return validation failed');
      await expect(a.api.kwOnly()).rejects.toThrow('Missing required keyword-only');
      await expect(a.api.fail()).rejects.toThrow('A-failure');
      await expect(a.api.scale('bad' as never)).rejects.toThrow();
      await expect(b.api.environment()).resolves.toBe('B');
      expect(() => getRuntimeBridge()).toThrow('No runtime bridge configured');

      const shared = clientModule.bindRuntime(bridgeB);
      b.dispose();
      await expect(b.api.environment()).rejects.toBeInstanceOf(BridgeDisposedError);
      await expect(shared.api.environment()).resolves.toBe('B');
      expect(bridgeB.isDisposed).toBe(false);
      shared.dispose();

      a.dispose();
      a.dispose();
      await expect(a.api.environment()).rejects.toBeInstanceOf(BridgeDisposedError);
      await expect(bridgeA.call('binding_fixture', 'environment', [])).resolves.toBe('A');
      const ownerHandle = clientModule.bindRuntime(bridgeA);
      await bridgeA.dispose();
      await expect(ownerHandle.api.environment()).rejects.toBeInstanceOf(BridgeDisposedError);
    } finally {
      a.dispose();
      b.dispose();
      await Promise.all([bridgeA.dispose(), bridgeB.dispose()]);
    }
  }, 30_000);

  it('keeps legacy argument, conversion, and return validation on the registry path', async () => {
    const bridge = new NodeBridge({
      pythonPath,
      scriptPath: bridgeScript,
      env: { PYTHONPATH: fixtureA },
    });
    setRuntimeBridge(bridge);
    try {
      expect(await legacyModule.scale(3, 4)).toBe(12);
      expect(await legacyModule.kwOnly({ label: 'ok' })).toBe('A:ok');
      expect(await legacyModule.echoBytes(new Uint8Array([4, 5]))).toEqual(new Uint8Array([4, 5]));
      await expect(legacyModule.kwOnly()).rejects.toThrow('Missing required keyword-only');
      await expect(legacyModule.invalidReturn()).rejects.toThrow('Return validation failed');
      expect(await legacyModule.Client.label('x')).toBe('A:x');
    } finally {
      clearRuntimeBridge();
      await bridge.dispose();
    }
  }, 30_000);

  it('keeps a call started before handle disposal on its selected bridge', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const runtime: RuntimeExecution = {
      async call<T>(): Promise<T> {
        await gate;
        return 'ready' as T;
      },
      async dispose(): Promise<void> {},
    };
    const handle = clientModule.bindRuntime(runtime);
    const started = handle.api.environment();
    handle.dispose();
    release();
    await expect(started).resolves.toBe('ready');
    await expect(handle.api.environment()).rejects.toBeInstanceOf(BridgeDisposedError);
  });

  it('uses the same companion with Node and HTTP bridges', async () => {
    const server = createServer((request, response) => {
      request.resume();
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ id: 1, result: 'H' }));
    });
    await new Promise<void>(resolveServer => server.listen(0, '127.0.0.1', resolveServer));
    const address = server.address() as AddressInfo;
    const node = new NodeBridge({
      pythonPath,
      scriptPath: bridgeScript,
      env: { PYTHONPATH: fixtureA },
    });
    const http = new HttpBridge({ baseURL: `http://127.0.0.1:${address.port}` });
    try {
      const a = clientModule.bindRuntime(node);
      const h = clientModule.bindRuntime(http);
      expect(await Promise.all([a.api.environment(), h.api.environment()])).toEqual(['A', 'H']);
    } finally {
      await Promise.all([node.dispose(), http.dispose()]);
      await new Promise<void>(resolveServer => server.close(() => resolveServer()));
    }
  }, 30_000);

  it('keeps bound and legacy behavior explicit across successful and failed reloads', async () => {
    let nextLabel = 'A';
    const reloader = await createBridgeReloader(async () => {
      if (nextLabel === 'fail') throw new Error('reload failed');
      return new LabeledRuntime(nextLabel);
    });
    try {
      const oldBridge = reloader.current();
      const oldHandle = clientModule.bindRuntime(oldBridge);
      expect(await oldHandle.api.environment()).toBe('A');
      expect(await legacyModule.environment()).toBe('A');

      nextLabel = 'B';
      await reloader.reload();
      const newHandle = clientModule.bindRuntime(reloader.current());
      await vi.waitFor(() => expect(oldBridge.disposed).toBe(true));
      await expect(oldHandle.api.environment()).rejects.toBeInstanceOf(BridgeDisposedError);
      expect(await newHandle.api.environment()).toBe('B');
      expect(await legacyModule.environment()).toBe('B');

      nextLabel = 'fail';
      await expect(reloader.reload()).rejects.toThrow('reload failed');
      expect(reloader.current().label).toBe('B');
      expect(await newHandle.api.environment()).toBe('B');
      expect(await legacyModule.environment()).toBe('B');
    } finally {
      await reloader.dispose();
      clearRuntimeBridge();
    }
  });

  it('typechecks overloads, generics, optional arguments, and the class namespace', async () => {
    const consumer = join(generatedDir, 'binding-consumer.ts');
    const selectSignatures = (originalDeclaration.match(/^export function select\(/gm) ?? [])
      .length;
    expect(selectSignatures).toBe(supportsOverloadExtraction ? 2 : 1);
    const selectChecks = supportsOverloadExtraction
      ? `const b: Promise<number> = client.api.select(2);
const c: Promise<string> = client.api.select('x');
// @ts-expect-error the string overload returns a string
const wrong: Promise<number> = client.api.select('x');
void wrong;`
      : `const b: Promise<string | number> = client.api.select(2);
const c: Promise<string | number> = client.api.select('x');`;
    await writeFile(
      consumer,
      `import { bindRuntime, type RuntimeExecution } from './binding_fixture.generated.client.js';
declare const runtime: RuntimeExecution;
const client = bindRuntime(runtime);
const a: Promise<string> = client.api.identity<string>('x');
${selectChecks}
const d: Promise<number> = client.api.scale(2);
const e: Promise<number> = client.api.scale(2, 3);
const f: Promise<string> = client.api.Client.label('x');
const g: Promise<string> = client.api.kwOnly({ label: 'x' });
const h: Promise<Uint8Array> = client.api.echoBytes(new Uint8Array([1]));
void [a, b, c, d, e, f, g, h];
`,
      'utf8'
    );
    const tscPath = join(process.cwd(), 'node_modules', 'typescript', 'lib', 'tsc.js');
    const compiled = await processUtils.exec(
      process.execPath,
      [
        tscPath,
        '--ignoreConfig',
        '--noEmit',
        '--pretty',
        'false',
        '--strict',
        '--target',
        'ES2022',
        '--lib',
        'ES2022,DOM,DOM.Iterable',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--skipLibCheck',
        consumer,
      ],
      { cwd: process.cwd(), timeoutMs: 30_000 }
    );
    expect(compiled.code, compiled.stdout || compiled.stderr).toBe(0);
  }, 30_000);

  it('records source and declaration size for a representative module', async () => {
    const comparisonDir = await mkdtemp(join(process.cwd(), 'test', '.tywrap-binding-size-'));
    try {
      const result = await generate({
        pythonModules: { advanced_types: { runtime: 'node', typeHints: 'strict' } },
        pythonImportPath: [resolve('test/fixtures/python')],
        output: { dir: comparisonDir, format: 'esm', declaration: true, sourceMap: false },
        runtime: { node: { pythonPath } },
        performance: { caching: false, batching: false, compression: 'none' },
      });
      expect(result.failures).toEqual([]);
      const compiled = await bindingTemplate(comparisonDir, 'advanced_types');
      const source = compiled.baseline.typescript;
      const declaration = compiled.baseline.declaration;
      const rendered = renderClientBindingPrototype(
        {
          typescript: source,
          declaration,
          metadata: {
            generatedAt: new Date(0),
            sourceFiles: [],
            runtime: 'auto',
            optimizations: [],
          },
        },
        compiled.template,
        'advanced_types'
      );
      const callableCount = (source.match(/getRuntimeBridge\(\)\.call/g) ?? []).length;
      expect(callableCount).toBeGreaterThan(0);
      const sourceBytes = Buffer.byteLength(source);
      const declarationBytes = Buffer.byteLength(declaration);
      const optInSourceBytes =
        Buffer.byteLength(rendered.typescript) +
        Buffer.byteLength(rendered.bindingPrototype.core.typescript) +
        Buffer.byteLength(rendered.bindingPrototype.client.typescript);
      const optInDeclarationBytes =
        Buffer.byteLength(rendered.declaration) +
        Buffer.byteLength(rendered.bindingPrototype.core.declaration) +
        Buffer.byteLength(rendered.bindingPrototype.client.declaration);
      console.info(
        JSON.stringify({
          fixture: 'advanced_types',
          callableCount,
          sourceBytes,
          declarationBytes,
          optInSourceBytes,
          optInDeclarationBytes,
          sourceDeltaPerCallable: (optInSourceBytes - sourceBytes) / callableCount,
        })
      );
    } finally {
      await rm(comparisonDir, { recursive: true, force: true });
    }
  }, 60_000);
});
