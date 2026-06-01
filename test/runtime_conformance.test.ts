/**
 * Cross-backend protocol conformance suite.
 *
 * This suite is the lock that keeps every tywrap Python server speaking the
 * SAME on-the-wire protocol ("tywrap/1"). The single JS client must be able to
 * talk to any backend interchangeably, so the same assertions are run against
 * each backend row and compared.
 *
 * Backends exercised (see ConformanceBackend below):
 *   - "node"         : the reference server runtime/python_bridge.py, driven over
 *                      raw JSONL via a child process (LIVE — gated on python).
 *   - "http"         : an in-process node:http fixture that forwards each request
 *                      body to the SAME reference server subprocess (LIVE). This
 *                      is deliberately not a hand-written fake — a fake would be a
 *                      4th divergent implementation.
 *   - "pyodide-core" : the in-WASM Pyodide server's actual code path, exercised
 *                      under local CPython. Because the `pyodide` npm package is a
 *                      peerDependency that is not installed in CI (MODULE_NOT_FOUND),
 *                      an it.skipIf(!pyodideAvailable) real-Pyodide row would skip
 *                      and protect nothing. Instead we run the EXACT generated core
 *                      module (runtime/tywrap_bridge_core.py) the bootstrap embeds,
 *                      invoking core.dispatch_request(..., force_json_markers=True,
 *                      allow_nan=False) the same way pyodide-transport.ts does. This is the
 *                      row that actually validates Pyodide parity on every run.
 *
 * The pyodide-core backend forces JSON marker encoding (no Arrow), so marker
 * cases compare it against the reference server run in TYWRAP_CODEC_FALLBACK=json
 * mode — proving Node-in-json-fallback == Pyodide for each marker.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isNodejs } from '../src/utils/runtime.js';
import { resolvePythonExecutable } from '../src/utils/python.js';
import { BOOTSTRAP_PYTHON } from '../src/runtime/pyodide-transport.js';

// ---------------------------------------------------------------------------
// Availability gates (mirrors the established repo idioms)
// ---------------------------------------------------------------------------

const PROTOCOL = 'tywrap/1';
const PROTOCOL_VERSION = 1;
const REFERENCE_SCRIPT = resolve(process.cwd(), 'runtime/python_bridge.py');
const CORE_MODULE = resolve(process.cwd(), 'runtime/tywrap_bridge_core.py');
const RUNTIME_DIR = resolve(process.cwd(), 'runtime');

const isCi =
  ['1', 'true'].includes((process.env.CI ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.GITHUB_ACTIONS ?? '').toLowerCase()) ||
  ['1', 'true'].includes((process.env.ACT ?? '').toLowerCase());
const caseTimeoutMs = isCi ? 60_000 : 30_000;

function resolvePythonForTests(): string | null {
  const explicit = process.env.TYWRAP_CODEC_PYTHON?.trim();
  if (explicit) {
    return explicit;
  }
  // resolvePythonExecutable is async elsewhere; for the conformance gate we want a
  // synchronous, side-effect-free probe. Fall back to the conventional names.
  for (const candidate of ['python3', 'python']) {
    const res = spawnSync(candidate, ['--version'], { encoding: 'utf-8' });
    if (res.status === 0) {
      return candidate;
    }
  }
  return null;
}

const PYTHON = resolvePythonForTests();

function pythonAvailable(pythonPath: string | null): pythonPath is string {
  if (!pythonPath) return false;
  const res = spawnSync(pythonPath, ['--version'], { encoding: 'utf-8' });
  return res.status === 0;
}

function hasModule(pythonPath: string, moduleName: string): boolean {
  const res = spawnSync(pythonPath, ['-c', `import ${moduleName}`], { encoding: 'utf-8' });
  return res.status === 0;
}

const PYTHON_OK = pythonAvailable(PYTHON) && existsSync(REFERENCE_SCRIPT);
const CORE_OK = PYTHON_OK && existsSync(CORE_MODULE);

// A throwaway fixture module dropped into the runtime dir so backends (whose cwd
// is the runtime dir) can `import` it. It exposes make_model() returning a
// populated pydantic model with a camelCase alias to exercise model_dump(by_alias).
const PYDANTIC_FIXTURE_MODULE = '_tywrap_conformance_fixtures';
const PYDANTIC_FIXTURE_PATH = resolve(RUNTIME_DIR, `${PYDANTIC_FIXTURE_MODULE}.py`);
const PYDANTIC_FIXTURE_SOURCE = `
from pydantic import BaseModel, Field


class _Model(BaseModel):
    user_name: str = Field(alias='userName')
    count: int


def make_model():
    return _Model(userName='ada', count=3)
`;

// A stdlib-only fixture (no third-party deps) exercising every class-member
// category the IR 0.3.0 generator now emits: @classmethod and @staticmethod
// (invoked via call() with a dotted 'Widget.method' name) and @property /
// functools.cached_property (read via call_method with no args). Guards the
// W3c bridge-dispatch support across every backend.
const MEMBER_FIXTURE_MODULE = '_tywrap_member_fixtures';
const MEMBER_FIXTURE_PATH = resolve(RUNTIME_DIR, `${MEMBER_FIXTURE_MODULE}.py`);
const MEMBER_FIXTURE_SOURCE = `
import functools


class Widget:
    label = 'widget'

    def __init__(self, size):
        self.size = size

    @classmethod
    def named(cls):
        return cls.label

    @staticmethod
    def doubled(n):
        return n * 2

    @property
    def area(self):
        return self.size * self.size

    @functools.cached_property
    def cached_area(self):
        return self.size * self.size + 1
`;

// #234 hardening fixture: a sklearn estimator whose constructor stores a callable
// param, so get_params(deep=False) returns a non-JSON value. The bridge must reject
// it with a clear, param-naming error (metadata-only; never pickle). Written only
// when sklearn is importable.
const SKLEARN_HARDENING_MODULE = '_tywrap_sklearn_hardening_fixtures';
const SKLEARN_HARDENING_PATH = resolve(RUNTIME_DIR, `${SKLEARN_HARDENING_MODULE}.py`);
const SKLEARN_HARDENING_SOURCE = `
from sklearn.base import BaseEstimator


class CallableParamEstimator(BaseEstimator):
    def __init__(self, fn=len):
        self.fn = fn


class NestedEstimatorParam(BaseEstimator):
    def __init__(self, inner=None):
        self.inner = inner if inner is not None else CallableParamEstimator()


def make_callable_param():
    return CallableParamEstimator()


def make_nested_estimator_param():
    return NestedEstimatorParam()
`;

const MODULES = {
  numpy: PYTHON_OK ? hasModule(PYTHON, 'numpy') : false,
  pandas: PYTHON_OK ? hasModule(PYTHON, 'pandas') : false,
  scipy: PYTHON_OK ? hasModule(PYTHON, 'scipy') : false,
  torch: PYTHON_OK ? hasModule(PYTHON, 'torch') : false,
  sklearn: PYTHON_OK ? hasModule(PYTHON, 'sklearn') : false,
  pydantic: PYTHON_OK ? hasModule(PYTHON, 'pydantic') : false,
  pyarrow: PYTHON_OK ? hasModule(PYTHON, 'pyarrow') : false,
};

// ---------------------------------------------------------------------------
// Raw JSONL backend driver
// ---------------------------------------------------------------------------

interface WireResponse {
  id: number;
  protocol?: string;
  result?: unknown;
  error?: { type: string; message: string; traceback?: string };
}

interface ConformanceBackend {
  readonly name: string;
  /** Send one raw protocol message object; return the parsed wire response. */
  dispatch(message: Record<string, unknown>): Promise<WireResponse>;
  dispose(): Promise<void>;
}

/**
 * Long-lived JSONL subprocess driver.
 *
 * Spawns a python process whose stdin/stdout speak the JSONL protocol and
 * resolves each request against the matching response id. Both the reference
 * server and the pyodide-core CPython harness expose the same JSONL loop, so a
 * single driver serves both.
 */
class JsonlProcessBackend implements ConformanceBackend {
  readonly name: string;
  private readonly proc: ReturnType<typeof spawn>;
  private buffer = '';
  private readonly pending = new Map<number, (resp: WireResponse) => void>();
  private nextId = 1;

  constructor(name: string, command: string, args: string[], env: NodeJS.ProcessEnv) {
    this.name = name;
    this.proc = spawn(command, args, {
      cwd: RUNTIME_DIR,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout?.setEncoding('utf-8');
    this.proc.stdout?.on('data', (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let parsed: WireResponse;
      try {
        parsed = JSON.parse(line) as WireResponse;
      } catch {
        continue;
      }
      const resolver = this.pending.get(parsed.id);
      if (resolver) {
        this.pending.delete(parsed.id);
        resolver(parsed);
      }
    }
  }

  dispatch(message: Record<string, unknown>): Promise<WireResponse> {
    const id = typeof message.id === 'number' ? message.id : this.nextId++;
    const full = { protocol: PROTOCOL, ...message, id };
    return new Promise<WireResponse>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`conformance backend ${this.name} timed out for id ${id}`));
      }, caseTimeoutMs);
      this.pending.set(id, resp => {
        clearTimeout(timer);
        resolvePromise(resp);
      });
      this.proc.stdin?.write(`${JSON.stringify(full)}\n`);
    });
  }

  async dispose(): Promise<void> {
    try {
      this.proc.stdin?.end();
    } catch {
      // ignore
    }
    this.proc.kill();
  }
}

/**
 * HTTP backend: an in-process node:http server that forwards each request body
 * (a single JSONL protocol message) to the SAME reference server subprocess and
 * returns its JSONL response line. Routing through the real server keeps this
 * from becoming a divergent 4th implementation.
 */
class HttpReferenceBackend implements ConformanceBackend {
  readonly name = 'http';
  private readonly inner: JsonlProcessBackend;
  private server?: ReturnType<typeof createServer>;
  private baseURL = '';

  constructor(env: NodeJS.ProcessEnv) {
    this.inner = new JsonlProcessBackend('http-inner', PYTHON as string, [REFERENCE_SCRIPT], env);
  }

  async start(): Promise<void> {
    this.server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c as Buffer));
      req.on('end', () => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as Record<string, unknown>;
        } catch {
          res.statusCode = 400;
          res.end('bad json');
          return;
        }
        this.inner
          .dispatch(message)
          .then(resp => {
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify(resp));
          })
          .catch(err => {
            res.statusCode = 500;
            res.end(String(err));
          });
      });
    });
    await new Promise<void>((resolveServer, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(0, '127.0.0.1', () => resolveServer());
    });
    const address = this.server?.address() as AddressInfo;
    this.baseURL = `http://127.0.0.1:${address.port}`;
  }

  async dispatch(message: Record<string, unknown>): Promise<WireResponse> {
    const id = typeof message.id === 'number' ? message.id : 1;
    const full = { protocol: PROTOCOL, ...message, id };
    const resp = await fetch(this.baseURL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(full),
    });
    return (await resp.json()) as WireResponse;
  }

  async dispose(): Promise<void> {
    await this.inner.dispose();
    if (this.server) {
      await new Promise<void>(resolveClose => this.server?.close(() => resolveClose()));
    }
  }
}

// ---------------------------------------------------------------------------
// pyodide-core CPython harness
// ---------------------------------------------------------------------------

/**
 * Runs the EXACT Pyodide bootstrap source (src/runtime/pyodide-transport.ts
 * BOOTSTRAP_PYTHON) under CPython, then drives it via a thin stdin loop calling
 * its real __tywrap_dispatch. This exercises the production glue end-to-end on
 * every CI run — the generated core constant the bootstrap inlines, the
 * exec-into-sys.modules mechanism, and the actual __tywrap_dispatch error
 * ladder — not merely a re-import of tywrap_bridge_core.py. The only thing left
 * unvalidated is the in-WASM runtime itself (pyodide is an uninstalled peerDep);
 * the protocol/serialization behavior is fully covered here.
 */
const PYODIDE_CORE_HARNESS = `${BOOTSTRAP_PYTHON}

import sys as __tywrap_driver_sys
for __tywrap_line in __tywrap_driver_sys.stdin:
    __tywrap_line = __tywrap_line.strip()
    if not __tywrap_line:
        continue
    __tywrap_driver_sys.stdout.write(__tywrap_dispatch(__tywrap_line) + '\\n')
    __tywrap_driver_sys.stdout.flush()
`;

// The harness inlines the full ~31 KB bootstrap. Passing it via `python -c "..."`
// overflows Windows' ~32 KB command-line limit (spawn ENAMETOOLONG), so it is
// written to a file and executed as `python <file>` instead.
const PYODIDE_HARNESS_PATH = resolve(RUNTIME_DIR, '_tywrap_conformance_harness.py');

// ---------------------------------------------------------------------------
// Backend construction
// ---------------------------------------------------------------------------

const describeNodeOnly = isNodejs() ? describe : describe.skip;

describeNodeOnly('Cross-backend protocol conformance', () => {
  let nodeBackend: JsonlProcessBackend | undefined;
  let nodeJsonBackend: JsonlProcessBackend | undefined;
  let httpBackend: HttpReferenceBackend | undefined;
  let coreBackend: JsonlProcessBackend | undefined;

  beforeAll(async () => {
    if (!PYTHON_OK) return;
    if (MODULES.pydantic) {
      writeFileSync(PYDANTIC_FIXTURE_PATH, PYDANTIC_FIXTURE_SOURCE, 'utf-8');
    }
    // stdlib-only — written unconditionally so the member-dispatch case runs
    // on every backend that has a Python interpreter.
    writeFileSync(MEMBER_FIXTURE_PATH, MEMBER_FIXTURE_SOURCE, 'utf-8');
    if (MODULES.sklearn) {
      writeFileSync(SKLEARN_HARDENING_PATH, SKLEARN_HARDENING_SOURCE, 'utf-8');
    }
    const baseEnv = { ...process.env } as NodeJS.ProcessEnv;
    const jsonEnv = { ...process.env, TYWRAP_CODEC_FALLBACK: 'json' } as NodeJS.ProcessEnv;

    nodeBackend = new JsonlProcessBackend('node', PYTHON, [REFERENCE_SCRIPT], baseEnv);
    nodeJsonBackend = new JsonlProcessBackend('node-json', PYTHON, [REFERENCE_SCRIPT], jsonEnv);
    httpBackend = new HttpReferenceBackend(baseEnv);
    await httpBackend.start();

    if (CORE_OK) {
      writeFileSync(PYODIDE_HARNESS_PATH, PYODIDE_CORE_HARNESS, 'utf-8');
      coreBackend = new JsonlProcessBackend('pyodide-core', PYTHON, [PYODIDE_HARNESS_PATH], baseEnv);
    }
  });

  afterAll(async () => {
    await nodeBackend?.dispose();
    await nodeJsonBackend?.dispose();
    await httpBackend?.dispose();
    await coreBackend?.dispose();
    try {
      rmSync(PYDANTIC_FIXTURE_PATH, { force: true });
    } catch {
      // ignore
    }
    try {
      rmSync(PYODIDE_HARNESS_PATH, { force: true });
    } catch {
      // ignore
    }
    try {
      rmSync(MEMBER_FIXTURE_PATH, { force: true });
    } catch {
      // ignore
    }
    try {
      rmSync(SKLEARN_HARDENING_PATH, { force: true });
    } catch {
      // ignore
    }
  });

  // The set of backends whose marker encoding is JSON (no Arrow). The reference
  // server in default mode emits Arrow, so for marker equality we compare the
  // pyodide-core row against the reference run in TYWRAP_CODEC_FALLBACK=json mode.
  const jsonMarkerBackends = (): Array<{
    name: string;
    backend: () => JsonlProcessBackend | undefined;
  }> => [
    { name: 'node-json', backend: () => nodeJsonBackend },
    { name: 'pyodide-core', backend: () => coreBackend },
  ];

  const liveBackends = (): Array<{
    name: string;
    get: () => ConformanceBackend | undefined;
  }> => [
    { name: 'node', get: () => nodeBackend },
    { name: 'http', get: () => httpBackend },
    { name: 'pyodide-core', get: () => coreBackend },
  ];

  // -------------------------------------------------------------------------
  // Case 1: inline JSON round-trips
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK)(
    'inline JSON round-trip parity (math.sqrt + echo of primitives/nested)',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        const sqrt = await backend.dispatch({
          method: 'call',
          params: { module: 'math', functionName: 'sqrt', args: [16], kwargs: {} },
        });
        expect(sqrt.error, `${name} sqrt error`).toBeUndefined();
        expect(sqrt.result, `${name} sqrt result`).toBe(4);
        expect(sqrt.protocol, `${name} sqrt protocol`).toBe(PROTOCOL);

        // Echo a structured payload back through json.loads (identity function).
        const payload = { a: 1, b: 'two', c: [true, false, null], d: { e: 3.5 } };
        const echo = await backend.dispatch({
          method: 'call',
          params: {
            module: 'json',
            functionName: 'loads',
            args: [JSON.stringify(payload)],
            kwargs: {},
          },
        });
        expect(echo.error, `${name} echo error`).toBeUndefined();
        expect(echo.result, `${name} echo result`).toEqual(payload);
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 5/14: Python errors + malformed request parity
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK)(
    'python error and malformed-request envelope parity',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        // Handler error -> error envelope with traceback.
        const handlerErr = await backend.dispatch({
          method: 'call',
          params: { module: 'math', functionName: 'sqrt', args: [-1], kwargs: {} },
        });
        // math.sqrt(-1) raises ValueError in CPython.
        expect(handlerErr.error, `${name} handler error present`).toBeDefined();
        expect(handlerErr.error?.type, `${name} handler error type`).toBe('ValueError');
        expect(typeof handlerErr.error?.traceback, `${name} handler traceback`).toBe('string');
        expect(handlerErr.protocol, `${name} error protocol`).toBe(PROTOCOL);

        // Unknown method -> protocol error, NO traceback.
        const unknown = await backend.dispatch({ method: 'nope', params: {} });
        expect(unknown.error?.message, `${name} unknown method`).toBe('Unknown method: nope');
        expect(unknown.error?.traceback, `${name} unknown traceback omitted`).toBeUndefined();

        // Bad protocol.
        const badProto = await backend.dispatch({
          id: 7,
          protocol: 'bogus',
          method: 'meta',
          params: {},
        });
        expect(badProto.error?.message, `${name} bad protocol`).toBe('Invalid protocol: bogus');

        // Missing method.
        const missingMethod = await backend.dispatch({ params: {} } as Record<string, unknown>);
        expect(missingMethod.error?.message, `${name} missing method`).toBe('Missing method');

        // Unknown instance handle.
        const badHandle = await backend.dispatch({
          method: 'call_method',
          params: { handle: 'nope', methodName: 'x', args: [], kwargs: {} },
        });
        expect(badHandle.error?.message, `${name} bad handle`).toBe(
          'Unknown instance handle: nope'
        );
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 6: capabilities / meta parity
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK)(
    'meta returns all 11 fields with correct types and per-backend identity',
    async () => {
      const requiredFields: Array<[string, string]> = [
        ['protocol', 'string'],
        ['protocolVersion', 'number'],
        ['bridge', 'string'],
        ['pythonVersion', 'string'],
        ['codecFallback', 'string'],
        ['arrowAvailable', 'boolean'],
        ['scipyAvailable', 'boolean'],
        ['torchAvailable', 'boolean'],
        ['sklearnAvailable', 'boolean'],
        ['instances', 'number'],
      ];

      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;
        const meta = await backend.dispatch({ method: 'meta', params: {} });
        expect(meta.error, `${name} meta error`).toBeUndefined();
        const m = meta.result as Record<string, unknown>;
        for (const [field, ty] of requiredFields) {
          expect(typeof m[field], `${name} meta.${field} type`).toBe(ty);
        }
        expect(m.protocol, `${name} meta protocol`).toBe(PROTOCOL);
        expect(m.protocolVersion, `${name} meta protocolVersion`).toBe(PROTOCOL_VERSION);
        // pid must be a positive integer (subprocess) OR null (pyodide).
        expect(
          (typeof m.pid === 'number' && Number.isInteger(m.pid) && m.pid > 0) || m.pid === null,
          `${name} meta.pid`
        ).toBe(true);
      }

      // Backend identity: reference is python-subprocess, core reports pyodide.
      const nodeMeta = await nodeBackend!.dispatch({ method: 'meta', params: {} });
      expect((nodeMeta.result as Record<string, unknown>).bridge).toBe('python-subprocess');
      if (coreBackend) {
        const coreMeta = await coreBackend.dispatch({ method: 'meta', params: {} });
        const cm = coreMeta.result as Record<string, unknown>;
        expect(cm.bridge).toBe('pyodide');
        expect(cm.pid).toBe(null);
        expect(cm.arrowAvailable).toBe(false);
        expect(cm.codecFallback).toBe('json');
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 9: instance lifecycle + meta.instances
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK)(
    'instantiate / call_method / dispose_instance lifecycle parity',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        const before = await backend.dispatch({ method: 'meta', params: {} });
        const beforeCount = (before.result as Record<string, unknown>).instances as number;

        // decimal.Decimal('2.5') -> instance; call_method as_integer_ratio? Use a stable stdlib class.
        const inst = await backend.dispatch({
          method: 'instantiate',
          params: {
            module: 'collections',
            className: 'Counter',
            args: [['a', 'a', 'b']],
            kwargs: {},
          },
        });
        expect(inst.error, `${name} instantiate error`).toBeUndefined();
        const handle = inst.result as string;
        expect(typeof handle, `${name} handle type`).toBe('string');

        const mid = await backend.dispatch({ method: 'meta', params: {} });
        expect(
          (mid.result as Record<string, unknown>).instances,
          `${name} instances incremented`
        ).toBe(beforeCount + 1);

        const called = await backend.dispatch({
          method: 'call_method',
          params: { handle, methodName: 'most_common', args: [1], kwargs: {} },
        });
        expect(called.error, `${name} call_method error`).toBeUndefined();
        expect(called.result, `${name} most_common`).toEqual([['a', 2]]);

        const disposed = await backend.dispatch({
          method: 'dispose_instance',
          params: { handle },
        });
        expect(disposed.result, `${name} dispose true`).toBe(true);

        const disposedAgain = await backend.dispatch({
          method: 'dispose_instance',
          params: { handle },
        });
        expect(disposedAgain.result, `${name} dispose false`).toBe(false);

        const after = await backend.dispatch({ method: 'meta', params: {} });
        expect(
          (after.result as Record<string, unknown>).instances,
          `${name} instances back to baseline`
        ).toBe(beforeCount);
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // classmethod/staticmethod (dotted call) + property/cached_property
  // (accessor read) dispatch parity — the IR 0.3.0 member surface.
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK)(
    'classmethod/staticmethod and property/cached_property dispatch parity',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        // @classmethod via a dotted call() name (cls bound to the class).
        const named = await backend.dispatch({
          method: 'call',
          params: { module: MEMBER_FIXTURE_MODULE, functionName: 'Widget.named', args: [], kwargs: {} },
        });
        expect(named.error, `${name} classmethod error`).toBeUndefined();
        expect(named.result, `${name} classmethod result`).toBe('widget');

        // @staticmethod via a dotted call() name.
        const doubled = await backend.dispatch({
          method: 'call',
          params: { module: MEMBER_FIXTURE_MODULE, functionName: 'Widget.doubled', args: [21], kwargs: {} },
        });
        expect(doubled.error, `${name} staticmethod error`).toBeUndefined();
        expect(doubled.result, `${name} staticmethod result`).toBe(42);

        const inst = await backend.dispatch({
          method: 'instantiate',
          params: { module: MEMBER_FIXTURE_MODULE, className: 'Widget', args: [5], kwargs: {} },
        });
        expect(inst.error, `${name} member instantiate error`).toBeUndefined();
        const handle = inst.result as string;

        // @property: read via call_method with no args — the bridge must return
        // the value, not try to call it.
        const area = await backend.dispatch({
          method: 'call_method',
          params: { handle, methodName: 'area', args: [], kwargs: {} },
        });
        expect(area.error, `${name} property error`).toBeUndefined();
        expect(area.result, `${name} property result`).toBe(25);

        // @cached_property: same shape; classification must survive the cached
        // second read.
        for (const attempt of [1, 2]) {
          const cached = await backend.dispatch({
            method: 'call_method',
            params: { handle, methodName: 'cached_area', args: [], kwargs: {} },
          });
          expect(cached.error, `${name} cached_property error (read ${attempt})`).toBeUndefined();
          expect(cached.result, `${name} cached_property result (read ${attempt})`).toBe(26);
        }

        // An accessor read that supplies arguments is a malformed request and
        // must fail loudly rather than silently dropping the args.
        const accessorWithArgs = await backend.dispatch({
          method: 'call_method',
          params: { handle, methodName: 'area', args: [1], kwargs: {} },
        });
        expect(accessorWithArgs.error, `${name} accessor-with-args rejected`).toBeDefined();

        await backend.dispatch({ method: 'dispose_instance', params: { handle } });
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 7: NaN / Infinity rejection (top-level AND nested)
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK)(
    'NaN/Infinity are rejected as typed errors, not emitted as invalid tokens',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        // Top-level NaN: float('nan')
        const topNaN = await backend.dispatch({
          method: 'call',
          params: { module: 'builtins', functionName: 'float', args: ['nan'], kwargs: {} },
        });
        expect(topNaN.error, `${name} top-level NaN rejected`).toBeDefined();
        expect(topNaN.error?.message, `${name} NaN message`).toMatch(/NaN/i);

        // Nested infinity inside a dict/list.
        const nestedInf = await backend.dispatch({
          method: 'call',
          params: {
            module: 'json',
            functionName: 'loads',
            // json.loads accepts Infinity by default, producing a nested float('inf')
            args: ['{"vals": [1, Infinity, 3]}'],
            kwargs: {},
          },
        });
        expect(nestedInf.error, `${name} nested inf rejected`).toBeDefined();
        expect(nestedInf.error?.message, `${name} inf message`).toMatch(/nan|inf/i);
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 8: bytes round-trip (Uint8Array envelope AND legacy envelope)
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK)(
    'bytes request envelopes decode to Python bytes and echo back',
    async () => {
      const raw = [104, 105]; // "hi"
      const b64 = Buffer.from(raw).toString('base64');

      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        // New JS BridgeCodec shape.
        const modern = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'len',
            args: [{ __tywrap_bytes__: true, b64 }],
            kwargs: {},
          },
        });
        expect(modern.error, `${name} modern bytes error`).toBeUndefined();
        expect(modern.result, `${name} modern bytes len`).toBe(2);

        // Legacy envelope.
        const legacy = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'len',
            args: [{ __type__: 'bytes', encoding: 'base64', data: b64 }],
            kwargs: {},
          },
        });
        expect(legacy.error, `${name} legacy bytes error`).toBeUndefined();
        expect(legacy.result, `${name} legacy bytes len`).toBe(2);

        // Echoing bytes back re-encodes to the legacy response envelope.
        const echo = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'bytes',
            args: [{ __tywrap_bytes__: true, b64 }],
            kwargs: {},
          },
        });
        expect(echo.error, `${name} bytes echo error`).toBeUndefined();
        expect(echo.result, `${name} bytes echo envelope`).toEqual({
          __type__: 'bytes',
          encoding: 'base64',
          data: b64,
        });
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 10: stdlib type serialization
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK)(
    'stdlib scalar serialization parity (datetime/date/Decimal/UUID/Path/timedelta)',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        const decimalRes = await backend.dispatch({
          method: 'call',
          params: { module: 'decimal', functionName: 'Decimal', args: ['2.50'], kwargs: {} },
        });
        expect(decimalRes.error, `${name} decimal error`).toBeUndefined();
        expect(decimalRes.result, `${name} decimal -> str`).toBe('2.50');

        const uuidRes = await backend.dispatch({
          method: 'call',
          params: {
            module: 'uuid',
            functionName: 'UUID',
            args: ['12345678-1234-5678-1234-567812345678'],
            kwargs: {},
          },
        });
        expect(uuidRes.result, `${name} uuid -> str`).toBe('12345678-1234-5678-1234-567812345678');

        const dateRes = await backend.dispatch({
          method: 'call',
          params: { module: 'datetime', functionName: 'date', args: [2026, 5, 29], kwargs: {} },
        });
        expect(dateRes.result, `${name} date -> isoformat`).toBe('2026-05-29');

        const pathRes = await backend.dispatch({
          method: 'call',
          params: { module: 'pathlib', functionName: 'PurePosixPath', args: ['/a/b'], kwargs: {} },
        });
        expect(pathRes.result, `${name} path -> str`).toBe('/a/b');

        const tdRes = await backend.dispatch({
          method: 'call',
          params: {
            module: 'datetime',
            functionName: 'timedelta',
            args: [],
            kwargs: { seconds: 90 },
          },
        });
        expect(tdRes.result, `${name} timedelta -> total_seconds`).toBe(90);
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 11: BridgeCodec value edge cases (set/frozenset, complex rejection)
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK)(
    'set serializes to list and complex is rejected',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        const setRes = await backend.dispatch({
          method: 'call',
          params: { module: 'builtins', functionName: 'set', args: [[1]], kwargs: {} },
        });
        expect(setRes.error, `${name} set error`).toBeUndefined();
        expect(setRes.result, `${name} set -> list`).toEqual([1]);

        const complexRes = await backend.dispatch({
          method: 'call',
          params: { module: 'builtins', functionName: 'complex', args: [1, 2], kwargs: {} },
        });
        expect(complexRes.error, `${name} complex rejected`).toBeDefined();
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 2: the 6 markers (compared between node-json and pyodide-core)
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK || !MODULES.numpy)(
    'ndarray marker JSON-fallback parity',
    async () => {
      for (const { name, backend } of jsonMarkerBackends()) {
        const b = backend();
        if (!b) continue;
        const res = await b.dispatch({
          method: 'call',
          params: { module: 'numpy', functionName: 'array', args: [[1, 2, 3]], kwargs: {} },
        });
        expect(res.error, `${name} ndarray error`).toBeUndefined();
        const env = res.result as Record<string, unknown>;
        expect(env.__tywrap__, `${name} ndarray marker`).toBe('ndarray');
        expect(env.encoding, `${name} ndarray encoding`).toBe('json');
        expect(env.codecVersion, `${name} ndarray codecVersion`).toBe(1);
        expect(env.data, `${name} ndarray data`).toEqual([1, 2, 3]);
      }
    },
    caseTimeoutMs
  );

  it.skipIf(!PYTHON_OK || !MODULES.pandas)(
    'dataframe + series marker JSON-fallback parity',
    async () => {
      for (const { name, backend } of jsonMarkerBackends()) {
        const b = backend();
        if (!b) continue;
        const handle = await b.dispatch({
          method: 'instantiate',
          params: {
            module: 'pandas',
            className: 'DataFrame',
            args: [{ x: [1, 2], y: [3, 4] }],
            kwargs: {},
          },
        });
        const df = await b.dispatch({
          method: 'call_method',
          params: { handle: handle.result as string, methodName: 'copy', args: [], kwargs: {} },
        });
        expect(df.error, `${name} dataframe error`).toBeUndefined();
        const dfEnv = df.result as Record<string, unknown>;
        expect(dfEnv.__tywrap__, `${name} dataframe marker`).toBe('dataframe');
        expect(dfEnv.encoding, `${name} dataframe encoding`).toBe('json');
        expect(dfEnv.data, `${name} dataframe data`).toEqual([
          { x: 1, y: 3 },
          { x: 2, y: 4 },
        ]);

        const series = await b.dispatch({
          method: 'call',
          params: { module: 'pandas', functionName: 'Series', args: [[10, 20]], kwargs: {} },
        });
        expect(series.error, `${name} series error`).toBeUndefined();
        const sEnv = series.result as Record<string, unknown>;
        expect(sEnv.__tywrap__, `${name} series marker`).toBe('series');
        expect(sEnv.encoding, `${name} series encoding`).toBe('json');
        expect(sEnv.data, `${name} series data`).toEqual([10, 20]);
      }
    },
    caseTimeoutMs
  );

  it.skipIf(!PYTHON_OK || !MODULES.scipy)(
    'scipy.sparse marker parity (json-only)',
    async () => {
      for (const { name, backend } of jsonMarkerBackends()) {
        const b = backend();
        if (!b) continue;
        const res = await b.dispatch({
          method: 'call',
          params: {
            module: 'scipy.sparse',
            functionName: 'csr_matrix',
            args: [
              [
                [1, 0],
                [0, 2],
              ],
            ],
            kwargs: {},
          },
        });
        expect(res.error, `${name} sparse error`).toBeUndefined();
        const env = res.result as Record<string, unknown>;
        expect(env.__tywrap__, `${name} sparse marker`).toBe('scipy.sparse');
        expect(env.format, `${name} sparse format`).toBe('csr');
        expect(env.shape, `${name} sparse shape`).toEqual([2, 2]);
        expect(env.data, `${name} sparse data`).toEqual([1, 2]);
      }
    },
    caseTimeoutMs
  );

  it.skipIf(!PYTHON_OK || !MODULES.torch)(
    'torch.tensor marker parity (nested ndarray, json fallback)',
    async () => {
      for (const { name, backend } of jsonMarkerBackends()) {
        const b = backend();
        if (!b) continue;
        const res = await b.dispatch({
          method: 'call',
          params: {
            module: 'torch',
            functionName: 'tensor',
            args: [
              [
                [1, 2],
                [3, 4],
              ],
            ],
            kwargs: {},
          },
        });
        expect(res.error, `${name} torch error`).toBeUndefined();
        const env = res.result as Record<string, unknown>;
        expect(env.__tywrap__, `${name} torch marker`).toBe('torch.tensor');
        expect(env.encoding, `${name} torch encoding`).toBe('ndarray');
        expect(env.shape, `${name} torch shape`).toEqual([2, 2]);
        expect(env.device, `${name} torch device`).toBe('cpu');
        const value = env.value as Record<string, unknown>;
        expect(value.__tywrap__, `${name} torch nested marker`).toBe('ndarray');
        expect(value.encoding, `${name} torch nested encoding`).toBe('json');
      }
    },
    caseTimeoutMs
  );

  it.skipIf(!PYTHON_OK || !MODULES.sklearn)(
    'sklearn.estimator marker parity (metadata-only)',
    async () => {
      for (const { name, backend } of jsonMarkerBackends()) {
        const b = backend();
        if (!b) continue;
        const res = await b.dispatch({
          method: 'call',
          params: {
            module: 'sklearn.linear_model',
            functionName: 'LinearRegression',
            args: [],
            kwargs: {},
          },
        });
        expect(res.error, `${name} sklearn error`).toBeUndefined();
        const env = res.result as Record<string, unknown>;
        expect(env.__tywrap__, `${name} sklearn marker`).toBe('sklearn.estimator');
        expect(env.className, `${name} sklearn className`).toBe('LinearRegression');
        expect(env.module, `${name} sklearn module`).toContain('sklearn');
        expect(typeof env.params, `${name} sklearn params`).toBe('object');
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // #234 envelope hardening — SUPPORTED scipy formats beyond CSR (CSC/COO/empty)
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK || !MODULES.scipy)(
    'scipy.sparse CSC / COO / empty supported-format parity (json-only)',
    async () => {
      for (const { name, backend } of jsonMarkerBackends()) {
        const b = backend();
        if (!b) continue;

        // CSC
        const csc = await b.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            args: ['__import__("scipy.sparse").sparse.csc_matrix([[1, 0], [0, 2]])'],
            kwargs: {},
          },
        });
        expect(csc.error, `${name} csc error`).toBeUndefined();
        const cscEnv = csc.result as Record<string, unknown>;
        expect(cscEnv.format, `${name} csc format`).toBe('csc');
        expect(cscEnv.shape, `${name} csc shape`).toEqual([2, 2]);
        expect(Array.isArray(cscEnv.indptr), `${name} csc indptr`).toBe(true);

        // COO
        const coo = await b.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            args: ['__import__("scipy.sparse").sparse.coo_matrix([[1, 0], [0, 2]])'],
            kwargs: {},
          },
        });
        expect(coo.error, `${name} coo error`).toBeUndefined();
        const cooEnv = coo.result as Record<string, unknown>;
        expect(cooEnv.format, `${name} coo format`).toBe('coo');
        expect(Array.isArray(cooEnv.row), `${name} coo row`).toBe(true);
        expect(Array.isArray(cooEnv.col), `${name} coo col`).toBe(true);

        // Empty CSR (no stored entries)
        const empty = await b.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            args: ['__import__("scipy.sparse").sparse.csr_matrix((3, 3))'],
            kwargs: {},
          },
        });
        expect(empty.error, `${name} empty csr error`).toBeUndefined();
        const emptyEnv = empty.result as Record<string, unknown>;
        expect(emptyEnv.format, `${name} empty format`).toBe('csr');
        expect(emptyEnv.data, `${name} empty data`).toEqual([]);
        expect(emptyEnv.shape, `${name} empty shape`).toEqual([3, 3]);
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // #234 envelope hardening — scipy EXPLICIT FAILURES (format / complex dtype)
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK || !MODULES.scipy)(
    'scipy.sparse rejects unsupported format and complex dtype clearly',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        // DIA format is unsupported -> clear rejection naming the supported set.
        const dia = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            args: ['__import__("scipy.sparse").sparse.dia_matrix(__import__("numpy").eye(3))'],
            kwargs: {},
          },
        });
        expect(dia.error, `${name} dia rejected`).toBeDefined();
        expect(dia.error?.message, `${name} dia message`).toMatch(/Unsupported scipy sparse format/);
        expect(dia.error?.message, `${name} dia mentions supported set`).toMatch(/csr\/csc\/coo/);

        // Complex dtype is unsupported -> clear rejection.
        const complex = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            args: [
              '__import__("scipy.sparse").sparse.csr_matrix(' +
                '__import__("numpy").array([[1+2j, 0], [0, 3+4j]]))',
            ],
            kwargs: {},
          },
        });
        expect(complex.error, `${name} complex sparse rejected`).toBeDefined();
        expect(complex.error?.message, `${name} complex sparse message`).toMatch(
          /[Cc]omplex .*sparse .*not supported/
        );
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // #234 envelope hardening — torch EXPLICIT FAILURES + opt-in default rejection
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK || !MODULES.torch)(
    'torch rejects sparse / quantized / meta / complex tensors clearly',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        // Sparse COO tensor -> reject with a sparse-specific message (NOT a
        // misleading "not contiguous"), and the message must not be bypassable
        // by an opt-in (default rejection is what the live backends exercise).
        const sparse = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            args: [
              '__import__("torch").sparse_coo_tensor(' +
                '__import__("torch").tensor([[0, 1], [1, 0]]), ' +
                '__import__("torch").tensor([3.0, 4.0]), (2, 2))',
            ],
            kwargs: {},
          },
        });
        expect(sparse.error, `${name} sparse tensor rejected`).toBeDefined();
        expect(sparse.error?.message, `${name} sparse message`).toMatch(
          /[Ss]parse tensors are not supported/
        );

        // Quantized tensor -> reject with a dequantize hint (was an opaque
        // "unsupported ScalarType" deep in torch before hardening).
        const quant = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            args: [
              '__import__("torch").quantize_per_tensor(' +
                '__import__("torch").tensor([1.0, 2.0]), 0.1, 0, __import__("torch").qint8)',
            ],
            kwargs: {},
          },
        });
        expect(quant.error, `${name} quantized rejected`).toBeDefined();
        expect(quant.error?.message, `${name} quantized message`).toMatch(/quantized/i);

        // Meta tensor -> reject with a materialize hint (NOT the generic non-CPU
        // message), and it must NOT be presented as opt-in-able.
        const meta = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            args: ['__import__("torch").empty(3, device="meta")'],
            kwargs: {},
          },
        });
        expect(meta.error, `${name} meta rejected`).toBeDefined();
        expect(meta.error?.message, `${name} meta message`).toMatch(/meta tensors/i);
        expect(meta.error?.message, `${name} meta not opt-in`).not.toMatch(
          /TYWRAP_TORCH_ALLOW_COPY/
        );

        // Complex tensor -> reject (was a SILENT corruption: emitted Python
        // complex tuples the JS decoder cannot parse).
        const complex = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            args: ['__import__("torch").tensor([1+2j, 3+4j])'],
            kwargs: {},
          },
        });
        expect(complex.error, `${name} complex tensor rejected`).toBeDefined();
        expect(complex.error?.message, `${name} complex tensor message`).toMatch(
          /[Cc]omplex tensors are not supported/
        );
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // #234 envelope hardening — torch non-CPU/non-contiguous default rejection.
  // A CPU non-contiguous tensor (transpose of a 2D tensor) is the portable way
  // to exercise the contiguous opt-in gate without needing a GPU.
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK || !MODULES.torch)(
    'torch rejects a non-contiguous tensor by default (opt-in required)',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;
        const nonContig = await backend.dispatch({
          method: 'call',
          params: {
            module: 'builtins',
            functionName: 'eval',
            // .t() returns a non-contiguous view of a 2D tensor.
            args: ['__import__("torch").tensor([[1.0, 2.0], [3.0, 4.0]]).t()'],
            kwargs: {},
          },
        });
        expect(nonContig.error, `${name} non-contiguous rejected`).toBeDefined();
        expect(nonContig.error?.message, `${name} non-contiguous message`).toMatch(
          /not contiguous/
        );
        expect(nonContig.error?.message, `${name} non-contiguous opt-in hint`).toMatch(
          /TYWRAP_TORCH_ALLOW_COPY/
        );
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // #234 envelope hardening — sklearn rejects non-JSON params (callable/nested),
  // naming the offending param. Metadata-only: NEVER pickle/joblib.
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK || !MODULES.sklearn)(
    'sklearn rejects callable / nested-estimator params with a clear, param-naming error',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;

        const callable = await backend.dispatch({
          method: 'call',
          params: {
            module: SKLEARN_HARDENING_MODULE,
            functionName: 'make_callable_param',
            args: [],
            kwargs: {},
          },
        });
        expect(callable.error, `${name} callable param rejected`).toBeDefined();
        expect(callable.error?.message, `${name} callable param message`).toMatch(
          /param 'fn' is not JSON-serializable/
        );
        expect(callable.error?.message, `${name} callable mentions metadata-only`).toMatch(
          /metadata only/
        );

        const nested = await backend.dispatch({
          method: 'call',
          params: {
            module: SKLEARN_HARDENING_MODULE,
            functionName: 'make_nested_estimator_param',
            args: [],
            kwargs: {},
          },
        });
        expect(nested.error, `${name} nested estimator param rejected`).toBeDefined();
        expect(nested.error?.message, `${name} nested param message`).toMatch(
          /param 'inner' is not JSON-serializable/
        );
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 12: Pydantic model serialization
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK || !MODULES.pydantic)(
    'pydantic model serialization parity (model_dump by_alias)',
    async () => {
      for (const { name, get } of liveBackends()) {
        const backend = get();
        if (!backend) continue;
        // The fixture module (written in beforeAll) exposes make_model() that
        // returns a populated pydantic BaseModel with a camelCase alias, so we
        // verify the serializer takes the model_dump(by_alias=True) path.
        const res = await backend.dispatch({
          method: 'call',
          params: {
            module: PYDANTIC_FIXTURE_MODULE,
            functionName: 'make_model',
            args: [],
            kwargs: {},
          },
        });
        expect(res.error, `${name} pydantic model error`).toBeUndefined();
        expect(res.result, `${name} pydantic model_dump by_alias`).toEqual({
          userName: 'ada',
          count: 3,
        });
      }
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Case 13: Node default-Arrow vs Node json-fallback equivalence (markers)
  // -------------------------------------------------------------------------
  it.skipIf(!PYTHON_OK || !MODULES.numpy)(
    'pyodide-core JSON markers match node json-fallback exactly',
    async () => {
      if (!coreBackend || !nodeJsonBackend) return;
      const req = {
        method: 'call',
        params: { module: 'numpy', functionName: 'array', args: [[1, 2, 3]], kwargs: {} },
      };
      const coreRes = await coreBackend.dispatch(req);
      const nodeRes = await nodeJsonBackend.dispatch(req);
      expect(coreRes.result).toEqual(nodeRes.result);
    },
    caseTimeoutMs
  );

  // -------------------------------------------------------------------------
  // Drift guard: generated bootstrap constant must equal the source .py
  // -------------------------------------------------------------------------
  it('generated pyodide bootstrap core constant is in sync with the source module', async () => {
    const generatedPath = resolve(process.cwd(), 'src/runtime/pyodide-bootstrap-core.generated.ts');
    if (!existsSync(generatedPath) || !existsSync(CORE_MODULE)) {
      // Generated file or source not present yet (pre-implementation RED phase).
      expect(existsSync(generatedPath), 'generated bootstrap constant exists').toBe(true);
      return;
    }
    const source = readFileSync(CORE_MODULE, 'utf-8');
    const generated = readFileSync(generatedPath, 'utf-8');
    // The generated module embeds the source verbatim inside a template string.
    // A round-trip check: the source content (JSON-encoded) must appear in the file.
    expect(generated.includes(JSON.stringify(source))).toBe(true);
  });
});
