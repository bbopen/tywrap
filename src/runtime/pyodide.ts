/**
 * Pyodide runtime bridge (browser)
 */

import { RuntimeBridge } from './base.js';

export interface PyodideBridgeOptions {
  indexURL: string;
  packages?: string[];
}

type LoadPyodide = (options: { indexURL: string }) => Promise<PyodideInstance>;

interface PyodideInstance {
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  globals: { get: (key: string) => unknown; set: (k: string, v: unknown) => void };
  toPy: (obj: unknown) => unknown;
  loadPackage: (name: string | string[]) => Promise<void>;
}

export class PyodideBridge extends RuntimeBridge {
  private readonly indexURL: string;
  private readonly packages: readonly string[];
  private py?: PyodideInstance;
  private initPromise?: Promise<void>;

  constructor(options: PyodideBridgeOptions = { indexURL: 'https://cdn.jsdelivr.net/pyodide/' }) {
    super();
    this.indexURL = options.indexURL;
    this.packages = [...(options.packages ?? [])];
  }

  private async ensureReady(): Promise<void> {
    if (this.py) {
      return;
    }
    // If already initializing, wait for that promise
    if (this.initPromise) {
      return this.initPromise;
    }
    // Start initialization and store the promise to prevent concurrent initialization
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    const loadPyodideFn: LoadPyodide | undefined = await this.resolveLoadPyodide();
    if (!loadPyodideFn) {
      throw new Error('Pyodide is not available in this environment');
    }
    this.py = await loadPyodideFn({ indexURL: this.indexURL });
    if (this.packages.length > 0) {
      await this.py.loadPackage([...this.packages]);
    }
    await this.bootstrapHelpers();
  }

  async init(): Promise<void> {
    await this.ensureReady();
  }

  private async resolveLoadPyodide(): Promise<LoadPyodide | undefined> {
    // Prefer global loadPyodide when present (browser script tag include)
    const g = (globalThis as unknown as { loadPyodide?: LoadPyodide }) ?? {};
    if (typeof g.loadPyodide === 'function') {
      return g.loadPyodide;
    }
    try {
      // Attempt dynamic import if available
      const mod = (await import('pyodide')) as unknown as { loadPyodide?: LoadPyodide };
      if (typeof mod.loadPyodide === 'function') {
        return mod.loadPyodide;
      }
    } catch {
      // Ignore import errors - pyodide may not be installed
      // This is expected in most environments
    }
    return undefined;
  }

  private async bootstrapHelpers(): Promise<void> {
    if (!this.py) {
      return;
    }
    const helper = [
      'import importlib',
      '__tywrap_instances = {}',
      'def __tywrap_call(module, function_name, args, kwargs):',
      '    mod = importlib.import_module(module)',
      '    fn = getattr(mod, function_name)',
      '    return fn(*args, **(kwargs or {}))',
      'def __tywrap_instantiate(module, class_name, args, kwargs):',
      '    mod = importlib.import_module(module)',
      '    cls = getattr(mod, class_name)',
      '    obj = cls(*args, **(kwargs or {}))',
      '    handle = str(id(obj))',
      '    __tywrap_instances[handle] = obj',
      '    return handle',
      'def __tywrap_call_method(handle, method_name, args, kwargs):',
      '    if handle not in __tywrap_instances:',
      '        raise KeyError(f"Unknown handle: {handle}")',
      '    obj = __tywrap_instances[handle]',
      '    fn = getattr(obj, method_name)',
      '    return fn(*args, **(kwargs or {}))',
      'def __tywrap_dispose_instance(handle):',
      '    return __tywrap_instances.pop(handle, None) is not None',
    ].join('\n');
    await this.py.runPythonAsync(helper);
  }

  async call<T = unknown>(
    module: string,
    functionName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureReady();
    const py = this.py;
    if (!py) {
      throw new Error('Pyodide not initialized');
    }
    const fn = py.globals.get('__tywrap_call');
    if (!fn) {
      throw new Error('Pyodide helper not initialized');
    }
    const invoke = fn as (module: string, f: string, a: unknown, k: unknown) => unknown;
    const pyArgs = py.toPy(args ?? []);
    const pyKwargs = py.toPy(kwargs ?? {});
    try {
      const out = invoke(module, functionName, pyArgs, pyKwargs);
      return out as T;
    } finally {
      this.destroyPyProxy(pyArgs);
      this.destroyPyProxy(pyKwargs);
      this.destroyPyProxy(fn);
    }
  }

  async instantiate<T = unknown>(
    module: string,
    className: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureReady();
    const py = this.py;
    if (!py) {
      throw new Error('Pyodide not initialized');
    }
    const fn = py.globals.get('__tywrap_instantiate');
    if (!fn) {
      throw new Error('Pyodide helper not initialized');
    }
    const invoke = fn as (module: string, c: string, a: unknown, k: unknown) => unknown;
    const pyArgs = py.toPy(args ?? []);
    const pyKwargs = py.toPy(kwargs ?? {});
    try {
      const out = invoke(module, className, pyArgs, pyKwargs);
      return out as T;
    } finally {
      this.destroyPyProxy(pyArgs);
      this.destroyPyProxy(pyKwargs);
      this.destroyPyProxy(fn);
    }
  }

  async callMethod<T = unknown>(
    handle: string,
    methodName: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    await this.ensureReady();
    const py = this.py;
    if (!py) {
      throw new Error('Pyodide not initialized');
    }
    const fn = py.globals.get('__tywrap_call_method');
    if (!fn) {
      throw new Error('Pyodide helper not initialized');
    }
    const invoke = fn as (h: string, m: string, a: unknown, k: unknown) => unknown;
    const pyArgs = py.toPy(args ?? []);
    const pyKwargs = py.toPy(kwargs ?? {});
    try {
      const out = invoke(handle, methodName, pyArgs, pyKwargs);
      return out as T;
    } finally {
      this.destroyPyProxy(pyArgs);
      this.destroyPyProxy(pyKwargs);
      this.destroyPyProxy(fn);
    }
  }

  async disposeInstance(handle: string): Promise<void> {
    await this.ensureReady();
    const py = this.py;
    if (!py) {
      throw new Error('Pyodide not initialized');
    }
    const fn = py.globals.get('__tywrap_dispose_instance');
    if (!fn) {
      throw new Error('Pyodide helper not initialized');
    }
    const invoke = fn as (h: string) => unknown;
    try {
      invoke(handle);
    } finally {
      this.destroyPyProxy(fn);
    }
  }

  async dispose(): Promise<void> {
    // Pyodide has no explicit dispose for instance; rely on GC
    this.py = undefined;
  }

  private destroyPyProxy(value: unknown): void {
    if (value && typeof (value as { destroy?: () => void }).destroy === 'function') {
      try {
        (value as { destroy: () => void }).destroy();
      } catch {
        // ignore cleanup failures
      }
    }
  }
}
