import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { generate } from '../src/tywrap.js';
import { BridgeValidationError } from '../src/runtime/errors.js';
import { getDefaultPythonPath } from '../src/utils/python.js';
import { processUtils } from '../src/utils/runtime.js';
import { clearRuntimeBridge, setRuntimeBridge } from 'tywrap/runtime';

const pythonPath = getDefaultPythonPath();

function options(outputDir: string) {
  return {
    pythonModules: { math: { typeHints: 'strict' as const } },
    output: { dir: outputDir, format: 'esm' as const, declaration: false, sourceMap: false },
    runtime: { node: { pythonPath } },
    performance: { caching: false, batching: false, compression: 'none' as const },
  };
}

describe('pinned IR contracts', () => {
  it('keeps extracted positional-only overloads bound to their return types', async () => {
    const tempDir = await mkdtemp(join(process.cwd(), 'test', '.tywrap-positional-'));
    try {
      const outputDir = join(tempDir, 'generated');
      const result = await generate({
        ...options(outputDir),
        pythonModules: { positional_overloads: { typeHints: 'strict' as const } },
        pythonImportPath: ['test/fixtures/python'],
        output: { dir: outputDir, format: 'esm', declaration: true, sourceMap: false },
      });
      expect(result.failures).toEqual([]);

      const contract = JSON.parse(
        await readFile(join(outputDir, 'positional_overloads.contract.json'), 'utf8')
      ) as {
        functions: Array<{
          name: string;
          parameters: Array<{ name: string; kind: string; default: boolean }>;
          overloads: Array<{
            parameters: Array<{ name: string; kind: string; default: boolean }>;
            returns: string;
          }>;
        }>;
      };
      const choose = contract.functions.find(func => func.name === 'choose');
      expect(choose?.parameters.map(param => [param.name, param.kind, param.default])).toEqual([
        ['value', 'POSITIONAL_ONLY', false],
        ['bias', 'POSITIONAL_OR_KEYWORD', true],
        ['loud', 'KEYWORD_ONLY', true],
      ]);

      const hasOverloadExtraction = await processUtils.exec(pythonPath, [
        '-c',
        'import typing; raise SystemExit(0 if hasattr(typing, "get_overloads") else 1)',
      ]);
      if (hasOverloadExtraction.code === 0) {
        expect(choose?.overloads).toHaveLength(2);
        expect(
          choose?.overloads.map(overload => overload.parameters.map(param => param.kind))
        ).toEqual([
          ['POSITIONAL_ONLY', 'POSITIONAL_OR_KEYWORD', 'KEYWORD_ONLY'],
          ['POSITIONAL_ONLY', 'POSITIONAL_OR_KEYWORD', 'KEYWORD_ONLY'],
        ]);
        expect(choose?.overloads.map(overload => overload.returns)).toEqual([
          expect.stringMatching(/str$/),
          expect.stringMatching(/int$/),
        ]);

        const consumerPath = join(outputDir, 'consumer.ts');
        await writeFile(
          join(outputDir, 'contract.d.ts'),
          await readFile(join(outputDir, 'positional_overloads.generated.d.ts'), 'utf8'),
          'utf8'
        );
        await writeFile(
          consumerPath,
          [
            "import { choose } from './contract.js';",
            "const text: Promise<string> = choose('a');",
            "const loudText: Promise<string> = choose('a', undefined, { loud: true });",
            'const number: Promise<number> = choose(4, 2, { loud: true });',
            'void text;',
            'void loudText;',
            'void number;',
            '// @ts-expect-error value is positional-only',
            "choose('a', undefined, { value: 'b' });",
            '// @ts-expect-error the string overload returns a string',
            "const wrong: Promise<number> = choose('a');",
            'void wrong;',
          ].join('\n'),
          'utf8'
        );
        const program = ts.createProgram([consumerPath], {
          noEmit: true,
          strict: true,
          skipLibCheck: true,
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          types: [],
        });
        expect(
          ts
            .getPreEmitDiagnostics(program)
            .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        ).toEqual([]);
      } else {
        expect(choose?.overloads).toEqual([]);
      }

      const source = await readFile(join(outputDir, 'positional_overloads.generated.ts'), 'utf8');
      const javascript = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      const runtimePath = join(tempDir, 'positional_overloads.generated.mjs');
      await writeFile(runtimePath, javascript, 'utf8');
      const calls: Array<{ args: unknown[]; kwargs?: Record<string, unknown> }> = [];
      let wrongStringReturn = false;
      setRuntimeBridge({
        async call<T>(
          _module: string,
          _functionName: string,
          args: unknown[],
          kwargs?: Record<string, unknown>,
          validate?: (result: T) => void
        ): Promise<T> {
          calls.push({ args: [...args], kwargs });
          const value =
            typeof args[0] === 'string'
              ? wrongStringReturn
                ? 7
                : args[0]
              : Number(args[0]) + Number(args[1] ?? 0);
          validate?.(value as T);
          return value as T;
        },
        async dispose(): Promise<void> {},
      });
      const generated = (await import(pathToFileURL(runtimePath).href)) as {
        choose: (...args: unknown[]) => Promise<unknown>;
      };
      await expect(generated.choose('a')).resolves.toBe('a');
      await expect(generated.choose('a', undefined, { loud: true })).resolves.toBe('a');
      await expect(generated.choose(4, 2, { loud: true })).resolves.toBe(6);
      await expect(generated.choose('a', undefined, { value: 'b' })).rejects.toThrow(
        /positional-only argument "value"/
      );
      expect(calls).toHaveLength(3);
      expect(calls[0]?.args).toEqual(['a']);
      expect(calls[1]).toEqual({ args: ['a'], kwargs: { loud: true } });
      expect(calls[2]).toEqual({ args: [4, 2], kwargs: { loud: true } });
      if (hasOverloadExtraction.code === 0) {
        wrongStringReturn = true;
        await expect(generated.choose('a')).rejects.toThrow(BridgeValidationError);
      }
    } finally {
      clearRuntimeBridge();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('writes stable sorted contracts and detects contract drift in check mode', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-'));
    try {
      const outputDir = join(tempDir, 'generated');
      const result = await generate(options(outputDir));
      const contractPath = result.written.find(path => path.endsWith('math.contract.json'));
      expect(contractPath).toBeDefined();

      const first = await readFile(contractPath as string, 'utf8');
      const parsed = JSON.parse(first) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(Object.keys(parsed).sort());
      expect(parsed).not.toHaveProperty('metadata');
      await generate(options(outputDir));
      expect(await readFile(contractPath as string, 'utf8')).toBe(first);

      await writeFile(contractPath as string, '{"drift":true}\n', 'utf8');
      const check = await generate(options(outputDir), { check: true });
      expect(check.outOfDate).toContain(contractPath);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('is byte-identical across Python processes with different hash seeds', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-seeds-'));
    const originalSeed = process.env.PYTHONHASHSEED;
    try {
      const seededOptions = (outputDir: string) => ({
        ...options(outputDir),
        pythonModules: { contract_determinism: { typeHints: 'strict' as const } },
        pythonImportPath: ['test/fixtures/python'],
      });

      process.env.PYTHONHASHSEED = '1';
      await generate(seededOptions(join(tempDir, 'seed-1')));
      process.env.PYTHONHASHSEED = '987654';
      await generate(seededOptions(join(tempDir, 'seed-2')));

      const first = await readFile(
        join(tempDir, 'seed-1', 'contract_determinism.contract.json'),
        'utf8'
      );
      const second = await readFile(
        join(tempDir, 'seed-2', 'contract_determinism.contract.json'),
        'utf8'
      );
      expect(second).toBe(first);
    } finally {
      if (originalSeed === undefined) {
        delete process.env.PYTHONHASHSEED;
      } else {
        process.env.PYTHONHASHSEED = originalSeed;
      }
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('generates from contractInput without spawning Python', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-input-'));
    try {
      const outputDir = join(tempDir, 'generated');
      const first = await generate(options(outputDir));
      const contractPath = first.written.find(path =>
        path.endsWith('math.contract.json')
      ) as string;
      const originalOutput = await readFile(join(outputDir, 'math.generated.ts'), 'utf8');

      const fromContract = await generate({
        ...options(outputDir),
        contractInput: contractPath,
        runtime: { node: { pythonPath: join(tempDir, 'python-must-not-run') } },
      });
      expect(fromContract.failures).toEqual([]);
      expect(await readFile(join(outputDir, 'math.generated.ts'), 'utf8')).toBe(originalOutput);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps a supported NumPy float16 contract strict in offline and check modes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-float16-'));
    try {
      const contractPath = join(tempDir, 'scientific.contract.json');
      await writeFile(
        contractPath,
        JSON.stringify({
          ir_version: '0.4.0',
          module: 'scientific_fixture',
          functions: [
            {
              name: 'value',
              qualname: 'scientific_fixture.value',
              docstring: null,
              parameters: [],
              returns: 'numpy.ndarray[tuple[typing.Any, ...], numpy.dtype[numpy.float16]]',
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
          warnings: [
            'Return annotation for scientific_fixture.value resolves outside analyzed module: numpy.ndarray.',
          ],
        }),
        'utf8'
      );
      const configured = {
        ...options(join(tempDir, 'generated')),
        pythonModules: { scientific_fixture: { typeHints: 'strict' as const } },
        contractInput: contractPath,
      };
      const first = await generate(configured);
      expect(first.failures).toEqual([]);
      expect(first.warnings).toEqual([]);
      const emitted = await readFile(
        join(tempDir, 'generated', 'scientific_fixture.generated.ts'),
        'utf8'
      );
      expect(emitted).toContain('value(): Promise<__tywrapFloat16Value>');
      expect(emitted).toContain('"marker":"ndarray","dtype":"float16"');
      const check = await generate(configured, { check: true });
      expect(check.failures).toEqual([]);
      expect(check.warnings).toEqual([]);
      expect(check.outOfDate).toEqual([]);

      const foreign = JSON.parse(await readFile(contractPath, 'utf8')) as {
        functions: Array<{ returns: string }>;
        warnings: string[];
      };
      foreign.functions[0]!.returns =
        'numpy.ndarray[tuple[typing.Any, ...], numpy.dtype[external.float16]]';
      await writeFile(contractPath, JSON.stringify(foreign), 'utf8');
      const rejected = await generate(configured);
      expect(
        rejected.warnings.some(warning =>
          warning.includes('no value conversion is defined for numpy.ndarray')
        )
      ).toBe(true);
      expect(
        rejected.warnings.some(warning =>
          warning.includes('resolves outside analyzed module: numpy.ndarray')
        )
      ).toBe(true);

      foreign.functions[0]!.returns =
        'numpy.ndarray[tuple[typing.Any, ...], numpy.dtype[numpy.float16]]';
      foreign.warnings[0] =
        'Return annotation for scientific_fixture.value resolves outside analyzed module: numpy.Opaque.';
      await writeFile(contractPath, JSON.stringify(foreign), 'utf8');
      const unrelated = await generate(configured);
      expect(
        unrelated.warnings.some(warning =>
          warning.includes('resolves outside analyzed module: numpy.Opaque')
        )
      ).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  // Windows cannot run the fake-interpreter shim: extensionless sh scripts
  // fail with ENOENT and .cmd files fail with EINVAL (Node's batch-file spawn
  // mitigation; the production spawn rightly never sets shell:true). The
  // version-check logic under test is platform-independent TypeScript and is
  // exercised on the Linux and macOS matrix legs.
  it.skipIf(process.platform === 'win32')(
    'fails clearly when Python IR reports a different schema version',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-version-'));
      try {
        const fakePython = join(tempDir, 'fake-python');
        await writeFile(
          fakePython,
          '#!/bin/sh\nprintf \'{"ir_version":"0.3.0","module":"math"}\\n\'\n',
          'utf8'
        );
        await chmod(fakePython, 0o755);

        const result = await generate({
          ...options(join(tempDir, 'generated')),
          runtime: { node: { pythonPath: fakePython } },
        });
        expect(result.failures).toEqual([
          expect.objectContaining({
            code: 'ir-version-mismatch',
            message: expect.stringContaining(
              'TypeScript expects 0.4.0, but Python IR for math declares 0.3.0'
            ),
          }),
        ]);
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    }
  );

  it('rejects same-version contracts with missing collection fields', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'tywrap-ir-contract-shape-'));
    try {
      const contractPath = join(tempDir, 'malformed.contract.json');
      await writeFile(
        contractPath,
        JSON.stringify({ ir_version: '0.4.0', module: 'math', functions: [] }),
        'utf8'
      );
      const result = await generate({
        ...options(join(tempDir, 'generated')),
        contractInput: contractPath,
      });
      expect(result.failures).toEqual([
        expect.objectContaining({
          code: 'contract-invalid',
          message: expect.stringContaining('missing required array field classes'),
        }),
      ]);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
