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

let runtimeCache: RuntimeInfo | null = null;

/**
 * Detect the current JavaScript runtime environment. The result is cached so
 * subsequent calls avoid repeating environment checks.
 */
export function detectRuntime(): RuntimeInfo {
  if (runtimeCache) {
    return runtimeCache;
  }

  // Deno detection (must come before Node.js check)
  if (typeof Deno !== 'undefined') {
    runtimeCache = {
      name: 'deno',
      version: Deno.version?.deno,
      capabilities: {
        filesystem: true,
        subprocess: true,
        webassembly: true,
        webworkers: true,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        fetch: true,
      },
    };
    return runtimeCache;
  }

  // Bun detection
  if (typeof Bun !== 'undefined') {
    runtimeCache = {
      name: 'bun',
      version: Bun.version,
      capabilities: {
        filesystem: true,
        subprocess: true,
        webassembly: true,
        webworkers: true,
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        fetch: true,
      },
    };
    return runtimeCache;
  }

  // Node.js detection
  if (typeof process !== 'undefined' && process.versions?.node) {
    runtimeCache = {
      name: 'node',
      version: process.versions.node,
      capabilities: {
        filesystem: true,
        subprocess: true,
        webassembly: typeof WebAssembly !== 'undefined',
        webworkers: false, // Node.js worker_threads are different
        sharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
        fetch: typeof fetch !== 'undefined', // Available in Node.js 18+
      },
    };
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

    runtimeCache = {
      name: 'browser',
      capabilities: {
        filesystem: false,
        subprocess: false,
        webassembly: typeof WebAssembly !== 'undefined',
        webworkers: typeof Worker !== 'undefined',
        sharedArrayBuffer: isSecureContext && typeof SharedArrayBuffer !== 'undefined',
        fetch: typeof fetch !== 'undefined',
      },
    };
    return runtimeCache;
  }

  runtimeCache = {
    name: 'unknown',
    capabilities: {
      filesystem: false,
      subprocess: false,
      webassembly: false,
      webworkers: false,
      sharedArrayBuffer: false,
      fetch: false,
    },
  };
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

const runtimeInfo = detectRuntime();

interface PathModule {
  join(...paths: string[]): string;
  resolve(...paths: string[]): string;
}

let pathModule: PathModule | null = null;
if (runtimeInfo.name !== 'browser' && runtimeInfo.name !== 'unknown') {
  try {
    pathModule = await import('node:path');
  } catch {
    pathModule = null;
  }
}

/**
 * Runtime-specific path utilities
 */
export const pathUtils = {
  /**
   * Join paths in a cross-runtime way
   */
  join(...segments: string[]): string {
    if (runtimeInfo.name === 'browser' || !pathModule?.join) {
      const parts: string[] = [];
      let absolute = false;

      for (const segment of segments) {
        if (!segment) {
          continue;
        }
        if (segment.startsWith('/')) {
          absolute = true;
        }
        for (const part of segment.split('/')) {
          if (!part || part === '.') {
            continue;
          }
          if (part === '..') {
            if (parts.length && parts[parts.length - 1] !== '..') {
              parts.pop();
            } else if (!absolute) {
              parts.push('..');
            }
            continue;
          }
          parts.push(part);
        }
      }

      return `${absolute ? '/' : ''}${parts.join('/')}`;
    }
    return pathModule.join(...segments);
  },

  /**
   * Resolve absolute path in a cross-runtime way
   */
  resolve(...segments: string[]): string {
    if (runtimeInfo.name === 'browser') {
      return new URL(segments.join('/'), location.href).href;
    }
    if (pathModule?.resolve) {
      return pathModule.resolve(...segments);
    }
    return segments.join('/');
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
    args: string[] = []
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    const runtime = detectRuntime();

    if (!runtime.capabilities.subprocess) {
      throw new Error('Subprocess operations not available in this runtime');
    }

    if (runtime.name === 'deno' && Deno) {
      const cmd = new Deno.Command(command, { args });
      const { code, stdout, stderr } = await cmd.output();

      return {
        code,
        stdout: new TextDecoder().decode(stdout),
        stderr: new TextDecoder().decode(stderr),
      };
    }

    if (runtime.name === 'bun' && Bun) {
      const proc = Bun.spawn([command, ...args], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      await proc.exited;

      return {
        code: proc.exitCode ?? 0,
        stdout,
        stderr,
      };
    }

    if (runtime.name === 'node') {
      const { spawn } = await import('child_process');

      return new Promise((resolve, reject) => {
        const extraPyPath = pathUtils.join(process.cwd(), 'tywrap_ir');
        const env = {
          ...process.env,
          PYTHONPATH: `${extraPyPath}${process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ''}`,
        };
        const child = spawn(command, args, { env });
        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', data => {
          stdout += data.toString();
        });

        child.stderr?.on('data', data => {
          stderr += data.toString();
        });

        child.on('close', code => {
          resolve({ code: code ?? 0, stdout, stderr });
        });

        child.on('error', reject);
      });
    }

    throw new Error(`Subprocess operations not implemented for ${runtime.name}`);
  },
};

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
    return Math.abs(hash).toString(16);
  },
};
