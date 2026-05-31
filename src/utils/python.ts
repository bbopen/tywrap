import {
  detectRuntime,
  pathUtils,
  isAbsolutePath,
  getPythonExecutableName,
  getVenvBinDir,
  getVenvPythonExe,
} from './runtime.js';

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

export function getDefaultPythonPath(): string {
  return getPythonExecutableName();
}

/**
 * Whether the configured pythonPath is the default interpreter (or unset),
 * meaning a virtual environment lookup should take precedence.
 */
function usesDefaultPython(pythonPath: string | undefined): boolean {
  return !pythonPath || pythonPath === 'python3' || pythonPath === 'python';
}

/**
 * Resolve the Python executable inside a virtual environment, preferring the
 * Node path module when available and falling back to cross-runtime pathUtils.
 */
async function resolveVenvPython(virtualEnv: string, cwd: string): Promise<string> {
  const binDir = getVenvBinDir();
  const exe = getVenvPythonExe();
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

export async function resolvePythonExecutable(options: PythonResolveOptions = {}): Promise<string> {
  const pythonPath = options.pythonPath?.trim();
  const virtualEnv = options.virtualEnv?.trim();

  if (virtualEnv && usesDefaultPython(pythonPath)) {
    const cwd =
      options.cwd ??
      (typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : '.');
    return resolveVenvPython(virtualEnv, cwd);
  }

  if (pythonPath) {
    return pythonPath;
  }

  return getDefaultPythonPath();
}
