/**
 * Runtime detection utilities for Node.js, Deno, Bun, and Browser environments
 */

/// <reference path="../types/global.d.ts" />

export type Runtime = 'node' | 'deno' | 'bun' | 'browser' | 'unknown';

interface RuntimeInfo {
  name: Runtime;
  version?: string;
  capabilities: RuntimeCapabilities;
}

interface RuntimeCapabilities {
  filesystem: boolean;
  subprocess: boolean;
  webassembly: boolean;
  webworkers: boolean;
  sharedArrayBuffer: boolean;
  fetch: boolean;
}

// Cache for runtime detection to avoid repeated environment checks
let runtimeCache: RuntimeInfo | null = null;

/**
 * Clear runtime cache (for testing purposes only)
 * @internal
 */
export function clearRuntimeCache(): void {
  runtimeCache = null;
}

/**
 * Detect the current JavaScript runtime environment
 * Results are cached and frozen to prevent external mutation
 */
export function detectRuntime(): RuntimeInfo {
  if (runtimeCache) {
    return runtimeCache;
  }
  // Deno detection (must come before Node.js check)
  if (typeof Deno !== 'undefined' && Deno !== null) {
    const capabilities = {
      filesystem: true,
      subprocess: true,
      webassembly: true,
      webworkers: true,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      fetch: true,
    };
    const result: RuntimeInfo = {
      name: 'deno',
      version: Deno.version?.deno,
      capabilities: Object.freeze(capabilities),
    };
    runtimeCache = Object.freeze(result) as RuntimeInfo;
    return runtimeCache;
  }

  // Bun detection
  if (typeof Bun !== 'undefined' && Bun !== null) {
    const capabilities = {
      filesystem: true,
      subprocess: true,
      webassembly: true,
      webworkers: true,
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      fetch: true,
    };
    const result: RuntimeInfo = {
      name: 'bun',
      version: Bun.version,
      capabilities: Object.freeze(capabilities),
    };
    runtimeCache = Object.freeze(result) as RuntimeInfo;
    return runtimeCache;
  }

  // Node.js detection
  if (typeof process !== 'undefined' && process.versions?.node) {
    const capabilities = {
      filesystem: true,
      subprocess: true,
      webassembly: typeof WebAssembly !== 'undefined',
      webworkers: false, // Node.js worker_threads are different
      sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      fetch: typeof fetch !== 'undefined', // Available in Node.js 18+
    };
    const result: RuntimeInfo = {
      name: 'node',
      version: process.versions.node,
      capabilities: Object.freeze(capabilities),
    };
    runtimeCache = Object.freeze(result) as RuntimeInfo;
    return runtimeCache;
  }

  // Browser detection
  if (typeof window !== 'undefined' || typeof self !== 'undefined') {
    const isSecureContext =
      typeof window !== 'undefined'
        ? window.isSecureContext
        : typeof self !== 'undefined'
          ? self.isSecureContext
          : false;

    const capabilities = {
      filesystem: false,
      subprocess: false,
      webassembly: typeof WebAssembly !== 'undefined',
      webworkers: typeof Worker !== 'undefined',
      sharedArrayBuffer: isSecureContext && typeof SharedArrayBuffer !== 'undefined',
      fetch: typeof fetch !== 'undefined',
    };
    const result: RuntimeInfo = {
      name: 'browser',
      capabilities: Object.freeze(capabilities),
    };
    runtimeCache = Object.freeze(result) as RuntimeInfo;
    return runtimeCache;
  }

  const capabilities = {
    filesystem: false,
    subprocess: false,
    webassembly: false,
    webworkers: false,
    sharedArrayBuffer: false,
    fetch: false,
  };
  const result: RuntimeInfo = {
    name: 'unknown',
    capabilities: Object.freeze(capabilities),
  };

  // Cache and freeze the result to prevent external mutation
  runtimeCache = Object.freeze(result) as RuntimeInfo;
  return runtimeCache;
}

/**
 * Check if running in Node.js
 */
export function isNodejs(): boolean {
  return detectRuntime().name === 'node';
}

/**
 * Check if running in Deno
 */
export function isDeno(): boolean {
  return detectRuntime().name === 'deno';
}

/**
 * Check if running in Bun
 */
export function isBun(): boolean {
  return detectRuntime().name === 'bun';
}

/**
 * Check if running in browser
 */
export function isBrowser(): boolean {
  return detectRuntime().name === 'browser';
}

/**
 * Get runtime capabilities
 */
export function getRuntimeCapabilities(): RuntimeCapabilities {
  return detectRuntime().capabilities;
}

/**
 * Check if a specific capability is supported
 */
export function hasCapability(capability: keyof RuntimeCapabilities): boolean {
  // eslint-disable-next-line security/detect-object-injection
  return getRuntimeCapabilities()[capability];
}

/**
 * Get the best runtime strategy for Python execution
 */
export function getBestPythonRuntime(): 'node' | 'pyodide' | 'http' {
  const runtime = detectRuntime();

  if (runtime.name === 'browser') {
    return 'pyodide';
  }

  if (runtime.capabilities.subprocess) {
    return 'node'; // Works for Node.js, Deno, and Bun
  }

  // Fallback to HTTP bridge
  return 'http';
}

type PathModule = typeof import('node:path');

// Cache for lazy-loaded path module
let pathModule: PathModule | null = null;

/**
 * Lazy load Node.js path module on demand
 */
async function loadPathModule(): Promise<PathModule | null> {
  if (pathModule) {
    return pathModule;
  }

  const runtime = detectRuntime();
  if (runtime.name === 'node') {
    try {
      pathModule = await import('node:path');
      return pathModule;
    } catch {
      // Fallback for older Node.js versions
      pathModule = await import('path');
      return pathModule;
    }
  }

  return null;
}

/**
 * Normalize path by stripping '.' and resolving '..' components
 */
function normalizePath(path: string): string {
  const isAbsolute = path.startsWith('/');
  const segments = path.split('/');
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment === '.' || segment === '') {
      continue; // Skip current directory and empty segments
    } else if (segment === '..') {
      if (normalized.length > 0 && normalized[normalized.length - 1] !== '..') {
        normalized.pop(); // Go up one directory
      } else if (!isAbsolute) {
        normalized.push(segment); // Keep '..' if not absolute and at root
      }
    } else {
      normalized.push(segment);
    }
  }

  const result = normalized.join('/');
  return isAbsolute ? `/${result}` : result;
}

/**
 * Runtime-specific path utilities
 */
export const pathUtils = {
  /**
   * Join paths in a cross-runtime way
   */
  join(...segments: string[]): string {
    const joined = segments
      .filter(Boolean)
      .join('/')
      .replace(/\/+/g, '/') // Replace multiple slashes with single slash
      .replace(/\\/g, '/'); // Normalize backslashes to forward slashes

    return normalizePath(joined);
  },

  /**
   * Join paths asynchronously with enhanced Node.js support
   */
  async joinAsync(...segments: string[]): Promise<string> {
    const runtime = detectRuntime();

    // For Node.js, use the real path module when available
    if (runtime.name === 'node') {
      const pathMod = await loadPathModule();
      if (pathMod?.posix) {
        return pathMod.posix.join(...segments);
      }
    }

    // Fallback implementation with normalization
    const joined = segments
      .filter(Boolean)
      .join('/')
      .replace(/\/+/g, '/') // Replace multiple slashes with single slash
      .replace(/\\/g, '/'); // Normalize backslashes to forward slashes

    return normalizePath(joined);
  },

  /**
   * Resolve absolute path in a cross-runtime way (synchronous)
   */
  resolve(path: string): string {
    const runtime = detectRuntime();

    // Simple synchronous resolution for testing
    if (path.startsWith('/')) {
      return path; // Already absolute
    }

    if (runtime.name === 'node' && typeof process !== 'undefined' && process.cwd) {
      return normalizePath(`${process.cwd()}/${path}`);
    }

    if (runtime.name === 'browser' && typeof location !== 'undefined') {
      return new URL(path, location.href).href;
    }

    // Fallback: normalize and return as-is for relative paths
    return normalizePath(path);
  },

  /**
   * Resolve absolute path in a cross-runtime way (asynchronous)
   */
  async resolveAsync(path: string): Promise<string> {
    const runtime = detectRuntime();

    if (runtime.name === 'node') {
      const pathMod = await loadPathModule();
      if (pathMod) {
        return pathMod.resolve(path);
      }
    }

    if (runtime.name === 'browser') {
      return new URL(path, location.href).href;
    }

    // Fallback: normalize and return as-is
    return normalizePath(path);
  },
};

/**
 * Cross-runtime file system operations
 */
export const fsUtils = {
  /**
   * Check if file system operations are available
   */
  isAvailable(): boolean {
    return hasCapability('filesystem');
  },

  /**
   * Read file in a cross-runtime way
   */
  async readFile(path: string): Promise<string> {
    const runtime = detectRuntime();

    if (!runtime.capabilities.filesystem) {
      throw new Error('File system operations not available in this runtime');
    }

    if (runtime.name === 'deno' && Deno) {
      return await Deno.readTextFile(path);
    }

    if (runtime.name === 'bun' && Bun) {
      const file = Bun.file(path);
      return await file.text();
    }

    if (runtime.name === 'node') {
      // Dynamic import to maintain ESM compatibility
      const { readFile } = await import('fs/promises');
      return await readFile(path, 'utf-8');
    }

    throw new Error(`File system operations not implemented for ${runtime.name}`);
  },

  /**
   * Write file in a cross-runtime way
   */
  async writeFile(path: string, content: string): Promise<void> {
    const runtime = detectRuntime();

    if (!runtime.capabilities.filesystem) {
      throw new Error('File system operations not available in this runtime');
    }

    if (runtime.name === 'deno' && Deno) {
      await Deno.writeTextFile(path, content);
      return;
    }

    if (runtime.name === 'bun' && Bun) {
      await Bun.write(path, content);
      return;
    }

    if (runtime.name === 'node') {
      const { writeFile, mkdir } = await import('fs/promises');
      const parts = path.split('/');
      parts.pop();
      const dir = parts.join('/') || '.';
      try {
        await mkdir(dir, { recursive: true });
      } catch {}
      await writeFile(path, content, 'utf-8');
      return;
    }

    throw new Error(`File system operations not implemented for ${runtime.name}`);
  },
};

/**
 * Cross-runtime subprocess execution
 */
export const processUtils = {
  /**
   * Check if subprocess operations are available
   */
  isAvailable(): boolean {
    return hasCapability('subprocess');
  },

  /**
   * Execute command in a cross-runtime way
   */
  async exec(
    command: string,
    args: string[] = [],
    options: { timeoutMs?: number; env?: Record<string, string | undefined>; cwd?: string } = {}
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const runtime = detectRuntime();

    if (!runtime.capabilities.subprocess) {
      throw new Error('Subprocess operations not available in this runtime');
    }

    if (runtime.name === 'deno' && Deno) {
      const timeoutMs = options.timeoutMs;
      const controller =
        typeof timeoutMs === 'number' && timeoutMs > 0 ? new AbortController() : undefined;
      const timeout =
        controller && typeof timeoutMs === 'number'
          ? setTimeout(() => controller.abort(), timeoutMs)
          : undefined;
      const env: Record<string, string> | undefined =
        options.env && Object.keys(options.env).length > 0
          ? Object.fromEntries(
              Object.entries(options.env)
                .filter(([, value]) => typeof value === 'string')
                .map(([key, value]) => [key, value as string])
            )
          : undefined;

      try {
        const cmd = new Deno.Command(command, {
          args,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(env ? { env } : {}),
          ...(controller ? { signal: controller.signal } : {}),
        });
        const { code, stdout, stderr } = await cmd.output();

        return {
          code,
          stdout: new TextDecoder().decode(stdout),
          stderr: new TextDecoder().decode(stderr),
        };
      } catch (error: unknown) {
        if (controller?.signal.aborted && typeof timeoutMs === 'number') {
          throw new Error(`Command "${command}" timed out after ${timeoutMs}ms`);
        }
        throw error;
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }
    }

    if (runtime.name === 'bun' && Bun) {
      const timeoutMs = options.timeoutMs;
      const mergedEnv: Record<string, string> | undefined = options.env
        ? Object.fromEntries(
            Object.entries({
              ...(typeof process !== 'undefined' ? process.env : {}),
              ...options.env,
            })
              .filter(([, value]) => typeof value === 'string')
              .map(([key, value]) => [key, value as string])
          )
        : undefined;
      const proc = Bun.spawn([command, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(mergedEnv ? { env: mergedEnv } : {}),
      });

      let timedOut = false;
      const timeout =
        typeof timeoutMs === 'number' && timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              proc.kill?.('SIGKILL');
            }, timeoutMs)
          : undefined;

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      await proc.exited;
      if (timeout) {
        clearTimeout(timeout);
      }
      if (timedOut && typeof timeoutMs === 'number') {
        throw new Error(`Command "${command}" timed out after ${timeoutMs}ms`);
      }

      return {
        code: proc.exitCode ?? 0,
        stdout,
        stderr,
      };
    }

    if (runtime.name === 'node') {
      const { spawn } = await import('child_process');
      const { delimiter } = await import('node:path');

      return new Promise((resolve, reject) => {
        const cwd = options.cwd ?? process.cwd();
        const extraPyPath = pathUtils.join(cwd, 'tywrap_ir');
        const env: Record<string, string> = Object.create(null) as Record<string, string>;
        Object.entries(process.env).forEach(([key, value]) => {
          if (value !== undefined) {
            // eslint-disable-next-line security/detect-object-injection -- environment variable keys are user/runtime supplied
            env[key] = value;
          }
        });
        Object.entries(options.env ?? {}).forEach(([key, value]) => {
          if (value === undefined) {
            // eslint-disable-next-line security/detect-object-injection -- environment variable keys are user/runtime supplied
            delete env[key];
            return;
          }
          // eslint-disable-next-line security/detect-object-injection -- environment variable keys are user/runtime supplied
          env[key] = value;
        });
        const existingPyPath = env.PYTHONPATH;
        env.PYTHONPATH = existingPyPath
          ? `${extraPyPath}${delimiter}${existingPyPath}`
          : extraPyPath;
        const child = spawn(command, args, { env, cwd: options.cwd });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timedOut = false;
        const timeout =
          typeof options.timeoutMs === 'number' && options.timeoutMs > 0
            ? setTimeout(() => {
                timedOut = true;
                child.kill('SIGKILL');
              }, options.timeoutMs)
            : undefined;

        const finish = (fn: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (timeout) {
            clearTimeout(timeout);
          }
          fn();
        };

        child.stdout?.on('data', data => {
          stdout += data.toString();
        });

        child.stderr?.on('data', data => {
          stderr += data.toString();
        });

        child.on('close', code => {
          if (timedOut) {
            const timeoutMs = options.timeoutMs;
            finish(() =>
              reject(
                new Error(
                  `Command "${command}" timed out after ${typeof timeoutMs === 'number' ? timeoutMs : 0}ms`
                )
              )
            );
            return;
          }
          finish(() => resolve({ code: code ?? 0, stdout, stderr }));
        });

        child.on('error', error => {
          finish(() => reject(error));
        });
      });
    }

    throw new Error(`Subprocess operations not implemented for ${runtime.name}`);
  },
};

/**
 * Platform detection utilities
 */

/**
 * Check if running on Windows
 */
export function isWindows(): boolean {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'win32';
  }
  const deno = (globalThis as unknown as { Deno?: { build?: { os?: string } } }).Deno;
  return deno?.build?.os === 'windows';
}

/**
 * Check if running on macOS
 */
export function isMacOS(): boolean {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'darwin';
  }
  const deno = (globalThis as unknown as { Deno?: { build?: { os?: string } } }).Deno;
  return deno?.build?.os === 'darwin';
}

/**
 * Check if running on Linux
 */
export function isLinux(): boolean {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform === 'linux';
  }
  const deno = (globalThis as unknown as { Deno?: { build?: { os?: string } } }).Deno;
  return deno?.build?.os === 'linux';
}

/**
 * Check if a path is absolute
 */
export function isAbsolutePath(path: string): boolean {
  // Unix absolute paths
  if (path.startsWith('/')) {
    return true;
  }
  // Windows absolute paths (e.g., C:\, D:/)
  return /^[A-Za-z]:[\\/]/.test(path);
}

/**
 * Get the path separator for the current platform
 */
export function getPathSeparator(): string {
  return isWindows() ? '\\' : '/';
}

/**
 * Get the default Python executable name for the current platform
 */
export function getPythonExecutableName(): string {
  return isWindows() ? 'python' : 'python3';
}

/**
 * Get the virtual environment bin directory name
 */
export function getVenvBinDir(): string {
  return isWindows() ? 'Scripts' : 'bin';
}

/**
 * Get the Python executable filename in a virtual environment
 */
export function getVenvPythonExe(): string {
  return isWindows() ? 'python.exe' : 'python';
}

/**
 * Cross-runtime hashing and stable stringify utilities
 */
export const hashUtils = {
  async sha256Hex(text: string): Promise<string> {
    const runtime = detectRuntime();
    // Node path
    if (runtime.name === 'node') {
      try {
        const crypto = await import('node:crypto');
        return crypto.createHash('sha256').update(text).digest('hex');
      } catch {
        // fallthrough to web crypto
      }
    }
    // Web/Deno/Bun path via SubtleCrypto
    if (typeof globalThis.crypto?.subtle !== 'undefined') {
      const data = new TextEncoder().encode(text);
      const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
      const bytes = Array.from(new Uint8Array(digest));
      return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
    }
	  // Fallback to DJB2 (non-crypto) for unknown runtimes
	  let hash = 5381;
	  for (let i = 0; i < text.length; i++) {
	    hash = (hash << 5) + hash + text.charCodeAt(i);
	    hash |= 0;
	  }
	  // Match sha256 hex shape (64 chars) so callers can rely on fixed-length output.
	  return Math.abs(hash).toString(16).padStart(64, '0');
	},
  };
