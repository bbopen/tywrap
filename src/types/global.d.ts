/**
 * Global type declarations for runtime environments
 */

// Deno runtime types
declare namespace DenoTypes {
  interface Version {
    deno: string;
  }

  interface DenoGlobal {
    version: Version;
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
    Command: new (
      cmd: string,
      options?: { args?: string[]; stdout?: string; stderr?: string }
    ) => any;
  }
}

// Bun runtime types
declare namespace BunTypes {
  interface BunGlobal {
    version: string;

    file(path: string): {
      text(): Promise<string>;
    };

    write(path: string, content: string): Promise<void>;

    spawn(
      cmd: string[],
      options?: {
        stdout?: string;
        stderr?: string;
      }
    ): {
      stdout: ReadableStream<Uint8Array>;
      stderr: ReadableStream<Uint8Array>;
      exitCode?: number;
      exited: Promise<number | void>;
      kill?: () => void;
    };
  }
}

// Global runtime declarations
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  var Deno: DenoTypes.DenoGlobal | undefined;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  var Bun: BunTypes.BunGlobal | undefined;
  // Node.js compat for atob in browser-less environments
  function atob(data: string): string;
}

export {};
