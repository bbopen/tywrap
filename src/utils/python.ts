import { detectRuntime, pathUtils } from './runtime.js';

export interface PythonResolveOptions {
  pythonPath?: string;
  virtualEnv?: string;
  cwd?: string;
}

type PathModule = typeof import('node:path');

let nodePathModule: PathModule | null | undefined;

async function loadNodePathModule(): Promise<PathModule | null> {
  if (nodePathModule !== undefined) {
    return nodePathModule;
  }
  const runtime = detectRuntime();
  if (runtime.name === 'node' || runtime.name === 'bun') {
    try {
      nodePathModule = await import('node:path');
      return nodePathModule;
    } catch {
      try {
        nodePathModule = await import('path');
        return nodePathModule;
      } catch {
        nodePathModule = null;
        return nodePathModule;
      }
    }
  }
  nodePathModule = null;
  return nodePathModule;
}

function isWindowsPlatform(): boolean {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }
  const deno = (globalThis as unknown as { Deno?: { build?: { os?: string } } }).Deno;
  return deno?.build?.os === 'windows';
}

function isAbsolutePath(value: string): boolean {
  if (value.startsWith('/')) {
    return true;
  }
  return /^[A-Za-z]:[\\/]/.test(value);
}

export function getDefaultPythonPath(): string {
  return isWindowsPlatform() ? 'python' : 'python3';
}

export async function resolvePythonExecutable(options: PythonResolveOptions = {}): Promise<string> {
  const pythonPath = options.pythonPath?.trim();
  const virtualEnv = options.virtualEnv?.trim();

  if (virtualEnv) {
    const usesDefaultPython = !pythonPath || pythonPath === 'python3' || pythonPath === 'python';
    if (usesDefaultPython) {
      const cwd =
        options.cwd ??
        (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.');
      const isWindows = isWindowsPlatform();
      const binDir = isWindows ? 'Scripts' : 'bin';
      const exe = isWindows ? 'python.exe' : 'python';
      const pathMod = await loadNodePathModule();

      if (pathMod) {
        const venvRoot = pathMod.resolve(cwd, virtualEnv);
        return pathMod.join(venvRoot, binDir, exe);
      }

      const venvRoot = isAbsolutePath(virtualEnv)
        ? pathUtils.join(virtualEnv)
        : pathUtils.join(cwd, virtualEnv);
      return pathUtils.join(venvRoot, binDir, exe);
    }
  }

  if (pythonPath) {
    return pythonPath;
  }

  return getDefaultPythonPath();
}
