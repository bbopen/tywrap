/**
 * CodeGenerator - TypeScript wrapper generation
 */

import type {
  PythonFunction,
  PythonClass,
  PythonModule,
  GeneratedCode,
  TypescriptType,
} from '../types/index.js';
import { globalCache } from '../utils/cache.js';

import { TypeMapper } from './mapper.js';

export class CodeGenerator {
  private readonly mapper: TypeMapper;
  private readonly reservedTsIdentifiers = new Set([
    'default',
    'delete',
    'new',
    'class',
    'function',
    'var',
    'let',
    'const',
    'enum',
    'export',
    'import',
    'return',
    'extends',
    'implements',
    'interface',
    'package',
    'private',
    'protected',
    'public',
    'static',
    'yield',
    'await',
    'async',
    'null',
    'true',
    'false',
  ]);

  constructor(mapper: TypeMapper = new TypeMapper()) {
    this.mapper = mapper;
  }

  /**
   * Convert Python snake_case to TypeScript camelCase and escape reserved words
   */
  private escapeIdentifier(name: string, options: { preserveCase?: boolean } = {}): string {
    if (!name) {
      return '_';
    }

    // First, normalize unicode characters
    let safe = this.normalizeUnicode(name);

    // Then handle special characters and make it a valid identifier
    safe = safe.replace(/[^a-zA-Z0-9_]/g, '_');
    if (/^[0-9]/.test(safe)) {
      safe = `_${safe}`;
    }

    // Convert snake_case to camelCase unless preserveCase is true
    if (!options.preserveCase) {
      safe = this.toCamelCase(safe);
    }

    // Check for reserved words after conversion
    if (this.reservedTsIdentifiers.has(safe)) {
      return `_${safe}_`;
    }

    return safe;
  }

  /**
   * Convert snake_case to camelCase
   */
  private toCamelCase(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Convert unicode characters to ASCII equivalents for better compatibility
   */
  private normalizeUnicode(str: string): string {
    // Basic unicode normalization - convert accented characters to ASCII equivalents
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
      .replace(/[^\x00-\x7F]/g, char => {
        // Map common unicode characters to ASCII equivalents
        const unicodeMap = new Map([
          ['ñ', 'n'],
          ['ü', 'u'],
          ['ß', 'ss'],
          ['æ', 'ae'],
          ['œ', 'oe'],
          ['ø', 'o'],
          ['€', 'euro'],
          // Add more mappings as needed
        ]);
        return unicodeMap.get(char) ?? char.charCodeAt(0).toString(16);
      });
  }

  generateFunctionWrapper(
    func: PythonFunction,
    moduleName?: string,
    annotatedJSDoc = false
  ): GeneratedCode {
    const jsdoc = this.generateJsDoc(
      func.docstring,
      annotatedJSDoc ? func.parameters.map(p => String(p.type)) : undefined
    );
    const filteredParams = func.parameters.filter(p => p.name !== 'self' && p.name !== 'cls');
    const keywordOnlyParams = filteredParams.filter(p => p.keywordOnly);
    const positionalOnlyNames = filteredParams.filter(p => p.positionalOnly).map(p => p.name);
    const hasVarKwArgs = filteredParams.some(p => p.kwArgs);
    const needsKwargsParam = keywordOnlyParams.length > 0 || hasVarKwArgs;

    const varArgsParam = filteredParams.find(p => p.varArgs);
    const needsVarArgsArray = Boolean(varArgsParam) && needsKwargsParam;

    const positionalParams = filteredParams.filter(p => !p.keywordOnly && !p.varArgs && !p.kwArgs);

    const tsTypeForValue = (p: (typeof filteredParams)[number]): string =>
      this.typeToTs(this.mapper.mapPythonType(p.type, 'value'));

    const kwargsType = (() => {
      if (!needsKwargsParam) {
        return '';
      }
      if (keywordOnlyParams.length === 0 && hasVarKwArgs) {
        return 'Record<string, unknown>';
      }
      const props = keywordOnlyParams
        .map(p => `${JSON.stringify(p.name)}${p.optional ? '?' : ''}: ${tsTypeForValue(p)};`)
        .join(' ');
      const obj = `{ ${props} }`;
      return hasVarKwArgs ? `(${obj} & Record<string, unknown>)` : obj;
    })();

    const renderPositionalParam = (
      p: (typeof positionalParams)[number],
      forceRequired = false
    ): string => {
      const pname = this.escapeIdentifier(p.name);
      const opt = !forceRequired && p.optional ? '?' : '';
      return `${pname}${opt}: ${tsTypeForValue(p)}`;
    };

    const renderVarArgsParam = (forceRequired = false): string | null => {
      if (!varArgsParam) {
        return null;
      }
      const pname = this.escapeIdentifier(varArgsParam.name);
      if (!needsVarArgsArray) {
        return `...${pname}: unknown[]`;
      }
      const opt = forceRequired ? '' : '?';
      return `${pname}${opt}: unknown[]`;
    };

    const renderKwargsParam = (forceRequired = false): string | null => {
      if (!needsKwargsParam) {
        return null;
      }
      const opt = forceRequired ? '' : '?';
      return `kwargs${opt}: ${kwargsType}`;
    };

    const implParams: string[] = [];
    for (const p of positionalParams) {
      implParams.push(renderPositionalParam(p));
    }
    const varArgsDecl = renderVarArgsParam(false);
    if (varArgsDecl) {
      implParams.push(varArgsDecl);
    }
    const kwargsDecl = needsKwargsParam ? `kwargs?: ${kwargsType}` : null;
    if (kwargsDecl) {
      implParams.push(kwargsDecl);
    }
    const paramDecl = implParams.join(', ');

    const callArgParts: string[] = positionalParams.map(p => this.escapeIdentifier(p.name));
    if (varArgsParam) {
      const vname = this.escapeIdentifier(varArgsParam.name);
      callArgParts.push(needsVarArgsArray ? `...(${vname} ?? [])` : `...${vname}`);
    }
    const callArgsArray = `[${callArgParts.join(', ')}]`;
    const hasKwArgs = needsKwargsParam;
    const returnType = this.typeToTs(this.mapper.mapPythonType(func.returnType, 'return'));
    const fname = this.escapeIdentifier(func.name);
    const moduleId = moduleName ?? '__main__';

    // Overloads: generate trailing optional parameter drop variants (exclude *args/**kwargs).
    // Why: Python APIs frequently have many optional tail params. TypeScript callers expect
    // `fn(a)`, `fn(a, b)`, ... all to typecheck. We emit a family of overloads that progressively
    // "drop" optional tail args, but also include the full positional signature (<= length) so a
    // call that supplies all args still matches an overload.
    const firstOptionalIndex = positionalParams.findIndex(p => p.optional);
    const requiredKwOnlyNames = keywordOnlyParams.filter(p => !p.optional).map(p => p.name);
    const overloads: string[] = [];
    if (requiredKwOnlyNames.length > 0) {
      // Required keyword-only params must be represented with a required `kwargs` parameter.
      // Avoid "required after optional" by emitting overloads where all preceding parameters are required.
      const requiredPosCount =
        firstOptionalIndex >= 0 ? firstOptionalIndex : positionalParams.length;
      for (let i = requiredPosCount; i <= positionalParams.length; i++) {
        const head = positionalParams.slice(0, i).map(p => renderPositionalParam(p, true));
        const rest: string[] = [];
        const v = renderVarArgsParam(true);
        if (v) {
          rest.push(v);
        }
        const k = renderKwargsParam(true);
        if (k) {
          rest.push(k);
        }
        overloads.push(
          `export function ${fname}(${[...head, ...rest].join(', ')}): Promise<${returnType}>;`
        );
      }
    } else if (firstOptionalIndex >= 0) {
      for (let i = firstOptionalIndex; i <= positionalParams.length; i++) {
        const head = positionalParams.slice(0, i).map(p => renderPositionalParam(p));
        const rest: string[] = [];
        const v = renderVarArgsParam(false);
        if (v) {
          rest.push(v);
        }
        const k = renderKwargsParam(false);
        if (k) {
          rest.push(k);
        }
        overloads.push(
          `export function ${fname}(${[...head, ...rest].join(', ')}): Promise<${returnType}>;`
        );
      }
    }

    const overloadDecl = overloads.length > 0 ? `${overloads.join('\n')}\n` : '';
    const guardLines: string[] = [];
    if (hasKwArgs && positionalOnlyNames.length > 0) {
      guardLines.push(
        `  const __positionalOnly = ${JSON.stringify(positionalOnlyNames)} as const;`
      );
      guardLines.push(`  for (const key of __positionalOnly) {`);
      guardLines.push(`    if (kwargs && Object.prototype.hasOwnProperty.call(kwargs, key)) {`);
      guardLines.push(
        `      throw new Error(\`${func.name} does not accept positional-only argument "\${key}" as a keyword argument\`);`
      );
      guardLines.push(`    }`);
      guardLines.push(`  }`);
    }
    if (hasKwArgs && requiredKwOnlyNames.length > 0) {
      guardLines.push(
        `  const __requiredKwOnly = ${JSON.stringify(requiredKwOnlyNames)} as const;`
      );
      guardLines.push(`  const __missing: string[] = [];`);
      guardLines.push(`  for (const key of __requiredKwOnly) {`);
      guardLines.push(`    if (!kwargs || !Object.prototype.hasOwnProperty.call(kwargs, key)) {`);
      guardLines.push(`      __missing.push(key);`);
      guardLines.push(`    }`);
      guardLines.push(`  }`);
      guardLines.push(`  if (__missing.length > 0) {`);
      guardLines.push(
        `    throw new Error(\`Missing required keyword-only arguments for ${func.name}: \${__missing.join(', ')}\`);`
      );
      guardLines.push(`  }`);
    }
    const guards = guardLines.length > 0 ? `${guardLines.join('\n')}\n` : '';

    const ts = `${jsdoc}${overloadDecl}export async function ${fname}(${paramDecl}): Promise<${returnType}> {
${guards}  return getRuntimeBridge().call('${moduleId}', '${func.name}', ${callArgsArray}${
      hasKwArgs ? ', kwargs' : ''
    });
}
`;

    return this.wrap(ts, [func.name]);
  }

  generateClassWrapper(
    cls: PythonClass,
    moduleName?: string,
    _annotatedJSDoc = false
  ): GeneratedCode {
    const jsdoc = this.generateJsDoc(cls.docstring);
    // Structural type aliases for special kinds
    if (cls.decorators.includes('__typed_dict__') || cls.kind === 'typed_dict') {
      const props = cls.properties
        .map(p => {
          const pname = this.escapeIdentifier(p.name);
          const opt = (p as unknown as { optional?: boolean }).optional === true ? '?' : '';
          const t = this.typeToTs(this.mapper.mapPythonType(p.type, 'value'));
          return `${pname}${opt}: ${t};`;
        })
        .join(' ');
      const cname = this.escapeIdentifier(cls.name);
      const ts = `${jsdoc}export type ${cname} = { ${props} }\n`;
      return this.wrap(ts, [cls.name]);
    }

    if (cls.kind === 'namedtuple') {
      // NamedTuple -> readonly tuple type alias `[T1, T2, ...]`
      const elements = cls.properties.map(p =>
        this.typeToTs(this.mapper.mapPythonType(p.type, 'value'))
      );
      const cname = this.escapeIdentifier(cls.name);
      const ts = `${jsdoc}export type ${cname} = readonly [${elements.join(', ')}]\n`;
      return this.wrap(ts, [cls.name]);
    }

    if (cls.kind === 'protocol') {
      // Protocol -> structural interface-like type alias for attributes and callables (subset)
      const props = cls.properties
        .map(
          p =>
            `${this.escapeIdentifier(p.name)}: ${this.typeToTs(this.mapper.mapPythonType(p.type, 'value'))};`
        )
        .join(' ');
      const methods = cls.methods
        .map(m => {
          const fparams = m.parameters.filter(p => p.name !== 'self' && p.name !== 'cls');
          const paramsDecl = fparams
            .map(
              p =>
                `${this.escapeIdentifier(p.name)}${p.optional ? '?' : ''}: ${this.typeToTs(this.mapper.mapPythonType(p.type, 'value'))}`
            )
            .join(', ');
          const returnType = this.typeToTs(this.mapper.mapPythonType(m.returnType, 'return'));
          return `${this.escapeIdentifier(m.name)}: (${paramsDecl}) => ${returnType};`;
        })
        .join(' ');
      const cname = this.escapeIdentifier(cls.name);
      const ts = `${jsdoc}export type ${cname} = { ${props} ${methods} }\n`;
      return this.wrap(ts, [cls.name]);
    }

    if (cls.kind === 'dataclass' || cls.kind === 'pydantic') {
      // Data containers -> object type alias
      const props = cls.properties
        .map(p => {
          const pname = this.escapeIdentifier(p.name);
          const opt = (p as unknown as { optional?: boolean }).optional === true ? '?' : '';
          const t = this.typeToTs(this.mapper.mapPythonType(p.type, 'value'));
          return `${pname}${opt}: ${t};`;
        })
        .join(' ');
      const cname = this.escapeIdentifier(cls.name);
      const ts = `${jsdoc}export type ${cname} = { ${props} }\n`;
      return this.wrap(ts, [cls.name]);
    }
    const sortedMethods = [...cls.methods].sort((a, b) => a.name.localeCompare(b.name));
    const tsValueType = (p: (typeof cls.methods)[number]['parameters'][number]): string =>
      this.typeToTs(this.mapper.mapPythonType(p.type, 'value'));

    const methodBodies = sortedMethods
      .filter(m => m.name !== '__init__')
      .map(m => {
        const fparams = m.parameters.filter(p => p.name !== 'self' && p.name !== 'cls');

        const keywordOnlyParams = fparams.filter(p => p.keywordOnly);
        const positionalOnlyNames = fparams.filter(p => p.positionalOnly).map(p => p.name);
        const hasVarKwArgs = fparams.some(p => p.kwArgs);
        const needsKwargsParam = keywordOnlyParams.length > 0 || hasVarKwArgs;
        const varArgsParam = fparams.find(p => p.varArgs);
        const needsVarArgsArray = Boolean(varArgsParam) && needsKwargsParam;
        const positionalParams = fparams.filter(p => !p.keywordOnly && !p.varArgs && !p.kwArgs);

        const kwargsType = (() => {
          if (!needsKwargsParam) {
            return '';
          }
          if (keywordOnlyParams.length === 0 && hasVarKwArgs) {
            return 'Record<string, unknown>';
          }
          const props = keywordOnlyParams
            .map(p => `${JSON.stringify(p.name)}${p.optional ? '?' : ''}: ${tsValueType(p)};`)
            .join(' ');
          const obj = `{ ${props} }`;
          return hasVarKwArgs ? `(${obj} & Record<string, unknown>)` : obj;
        })();

        const paramsDeclParts: string[] = [];
        for (const p of positionalParams) {
          paramsDeclParts.push(
            `${this.escapeIdentifier(p.name)}${p.optional ? '?' : ''}: ${tsValueType(p)}`
          );
        }
        if (varArgsParam) {
          const vname = this.escapeIdentifier(varArgsParam.name);
          paramsDeclParts.push(
            needsVarArgsArray ? `${vname}?: unknown[]` : `...${vname}: unknown[]`
          );
        }
        if (needsKwargsParam) {
          paramsDeclParts.push(`kwargs?: ${kwargsType}`);
        }
        const paramsDecl = paramsDeclParts.join(', ');

        const callArgParts: string[] = positionalParams.map(p => this.escapeIdentifier(p.name));
        if (varArgsParam) {
          const vname = this.escapeIdentifier(varArgsParam.name);
          callArgParts.push(needsVarArgsArray ? `...(${vname} ?? [])` : `...${vname}`);
        }
        const callArgsArray = `[${callArgParts.join(', ')}]`;

        const requiredKwOnlyNames = keywordOnlyParams.filter(p => !p.optional).map(p => p.name);
        const guardLines: string[] = [];
        if (needsKwargsParam && positionalOnlyNames.length > 0) {
          guardLines.push(
            `    const __positionalOnly = ${JSON.stringify(positionalOnlyNames)} as const;`
          );
          guardLines.push(`    for (const key of __positionalOnly) {`);
          guardLines.push(
            `      if (kwargs && Object.prototype.hasOwnProperty.call(kwargs, key)) {`
          );
          guardLines.push(
            `        throw new Error(\`${m.name} does not accept positional-only argument "\${key}" as a keyword argument\`);`
          );
          guardLines.push(`      }`);
          guardLines.push(`    }`);
        }
        if (needsKwargsParam && requiredKwOnlyNames.length > 0) {
          guardLines.push(
            `    const __requiredKwOnly = ${JSON.stringify(requiredKwOnlyNames)} as const;`
          );
          guardLines.push(`    const __missing: string[] = [];`);
          guardLines.push(`    for (const key of __requiredKwOnly) {`);
          guardLines.push(
            `      if (!kwargs || !Object.prototype.hasOwnProperty.call(kwargs, key)) {`
          );
          guardLines.push(`        __missing.push(key);`);
          guardLines.push(`      }`);
          guardLines.push(`    }`);
          guardLines.push(`    if (__missing.length > 0) {`);
          guardLines.push(
            `      throw new Error(\`Missing required keyword-only arguments for ${m.name}: \${__missing.join(', ')}\`);`
          );
          guardLines.push(`    }`);
        }
        const guards = guardLines.length > 0 ? `${guardLines.join('\n')}\n` : '';

        const returnType = this.typeToTs(this.mapper.mapPythonType(m.returnType, 'return'));
        return `  async ${this.escapeIdentifier(m.name)}(${paramsDecl}): Promise<${returnType}> {
${guards}    return getRuntimeBridge().callMethod(this.__handle, '${m.name}', ${callArgsArray}${
          needsKwargsParam ? ', kwargs' : ''
        });
  }`;
      })
      .join('\n');

    // Constructor typing from __init__
    const init = cls.methods.find(m => m.name === '__init__');
    const ctorSpec = (() => {
      if (!init) {
        return {
          paramsDecl: `...args: unknown[]`,
          callArgsArray: `[...args]`,
          hasKwargs: false,
          guardLines: [] as string[],
        };
      }

      const fparams = init.parameters.filter(p => p.name !== 'self' && p.name !== 'cls');
      const keywordOnlyParams = fparams.filter(p => p.keywordOnly);
      const positionalOnlyNames = fparams.filter(p => p.positionalOnly).map(p => p.name);
      const hasVarKwArgs = fparams.some(p => p.kwArgs);
      const needsKwargsParam = keywordOnlyParams.length > 0 || hasVarKwArgs;
      const varArgsParam = fparams.find(p => p.varArgs);
      const needsVarArgsArray = Boolean(varArgsParam) && needsKwargsParam;
      const positionalParams = fparams.filter(p => !p.keywordOnly && !p.varArgs && !p.kwArgs);

      const kwargsType = (() => {
        if (!needsKwargsParam) {
          return '';
        }
        if (keywordOnlyParams.length === 0 && hasVarKwArgs) {
          return 'Record<string, unknown>';
        }
        const props = keywordOnlyParams
          .map(p => `${JSON.stringify(p.name)}${p.optional ? '?' : ''}: ${tsValueType(p)};`)
          .join(' ');
        const obj = `{ ${props} }`;
        return hasVarKwArgs ? `(${obj} & Record<string, unknown>)` : obj;
      })();

      const paramsDeclParts: string[] = [];
      for (const p of positionalParams) {
        paramsDeclParts.push(
          `${this.escapeIdentifier(p.name)}${p.optional ? '?' : ''}: ${tsValueType(p)}`
        );
      }
      if (varArgsParam) {
        const vname = this.escapeIdentifier(varArgsParam.name);
        paramsDeclParts.push(needsVarArgsArray ? `${vname}?: unknown[]` : `...${vname}: unknown[]`);
      }
      if (needsKwargsParam) {
        paramsDeclParts.push(`kwargs?: ${kwargsType}`);
      }
      const paramsDecl = paramsDeclParts.join(', ');

      const callArgParts: string[] = positionalParams.map(p => this.escapeIdentifier(p.name));
      if (varArgsParam) {
        const vname = this.escapeIdentifier(varArgsParam.name);
        callArgParts.push(needsVarArgsArray ? `...(${vname} ?? [])` : `...${vname}`);
      }
      const callArgsArray = `[${callArgParts.join(', ')}]`;

      const requiredKwOnlyNames = keywordOnlyParams.filter(p => !p.optional).map(p => p.name);
      const guardLines: string[] = [];
      if (needsKwargsParam && positionalOnlyNames.length > 0) {
        guardLines.push(
          `    const __positionalOnly = ${JSON.stringify(positionalOnlyNames)} as const;`
        );
        guardLines.push(`    for (const key of __positionalOnly) {`);
        guardLines.push(`      if (kwargs && Object.prototype.hasOwnProperty.call(kwargs, key)) {`);
        guardLines.push(
          `        throw new Error(\`__init__ does not accept positional-only argument "\${key}" as a keyword argument\`);`
        );
        guardLines.push(`      }`);
        guardLines.push(`    }`);
      }
      if (needsKwargsParam && requiredKwOnlyNames.length > 0) {
        guardLines.push(
          `    const __requiredKwOnly = ${JSON.stringify(requiredKwOnlyNames)} as const;`
        );
        guardLines.push(`    const __missing: string[] = [];`);
        guardLines.push(`    for (const key of __requiredKwOnly) {`);
        guardLines.push(
          `      if (!kwargs || !Object.prototype.hasOwnProperty.call(kwargs, key)) {`
        );
        guardLines.push(`        __missing.push(key);`);
        guardLines.push(`      }`);
        guardLines.push(`    }`);
        guardLines.push(`    if (__missing.length > 0) {`);
        guardLines.push(
          `      throw new Error(\`Missing required keyword-only arguments for __init__: \${__missing.join(', ')}\`);`
        );
        guardLines.push(`    }`);
      }

      return { paramsDecl, callArgsArray, hasKwargs: needsKwargsParam, guardLines };
    })();

    const cname = this.escapeIdentifier(cls.name);
    const moduleId = moduleName ?? '__main__';
    const methodsSection = methodBodies ? `\n${methodBodies}\n` : '\n';
    const ctorGuards = ctorSpec.guardLines.length > 0 ? `${ctorSpec.guardLines.join('\n')}\n` : '';
    const ts = `${jsdoc}export class ${cname} {
  private readonly __handle: string;
  private constructor(handle: string) { this.__handle = handle; }
  static async create(${ctorSpec.paramsDecl}): Promise<${cname}> {
${ctorGuards}    const handle = await getRuntimeBridge().instantiate<string>('${moduleId}', '${cls.name}', ${ctorSpec.callArgsArray}${
      ctorSpec.hasKwargs ? ', kwargs' : ''
    });
    return new ${cname}(handle);
  }
  static fromHandle(handle: string): ${cname} { return new ${cname}(handle); }${methodsSection}  async disposeHandle(): Promise<void> { await getRuntimeBridge().disposeInstance(this.__handle); }
}
`;

    return this.wrap(ts, [cls.name]);
  }

  /**
   * Generate TypeScript wrapper for Python module with caching
   */
  async generateModule(
    module: PythonModule,
    options: { moduleName: string; exportAll?: boolean; annotatedJSDoc?: boolean } = {
      moduleName: 'unknown',
    }
  ): Promise<GeneratedCode> {
    // Check cache first
    const cached = await globalCache.getCachedGeneration(module, options);
    if (cached) {
      return cached;
    }

    const startTime = performance.now();
    const result = this.generateModuleDefinition(module, options.annotatedJSDoc);
    const computeTime = performance.now() - startTime;

    // Cache the result
    await globalCache.setCachedGeneration(module, options, result, computeTime);

    return result;
  }

  generateModuleDefinition(module: PythonModule, annotatedJSDoc = false): GeneratedCode {
    const functionCodes = [...module.functions]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => this.generateFunctionWrapper(f, module.name, annotatedJSDoc).typescript)
      .join('\n');
    const classCodes = [...module.classes]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => this.generateClassWrapper(c, module.name, annotatedJSDoc).typescript)
      .join('\n');

    const header = `// Generated by tywrap\n// Module: ${module.name}\n// DO NOT EDIT MANUALLY\n\n`;
    const hasRuntimeClasses = module.classes.some(c => {
      const kind = c.kind ?? 'class';
      return kind === 'class' && !c.decorators.includes('__typed_dict__');
    });
    const needsRuntime = module.functions.length > 0 || hasRuntimeClasses;
    const bridgeDecl = needsRuntime ? `import { getRuntimeBridge } from 'tywrap/runtime';\n\n` : '';

    const ts = `${header + bridgeDecl + functionCodes}\n${classCodes}`;
    return this.wrap(ts, [module.name]);
  }

  private generateJsDoc(doc?: string, paramAnnotations?: readonly string[]): string {
    const lines: string[] = [];
    if (doc) {
      lines.push(...doc.split('\n').map(l => ` * ${l}`));
    }
    if (paramAnnotations && paramAnnotations.length > 0) {
      // Lightweight inclusion of annotation strings when enabled
      paramAnnotations.forEach((ann, idx) => {
        lines.push(` * @param arg${idx} ${ann}`);
      });
    }
    if (lines.length === 0) {
      return '';
    }
    return `/**\n${lines.join('\n')}\n */\n`;
  }

  private wrap(typescript: string, _sources: string[]): GeneratedCode {
    return {
      typescript,
      declaration: '',
      sourceMap: undefined,
      metadata: {
        generatedAt: new Date(),
        sourceFiles: [],
        runtime: 'auto',
        optimizations: [],
      },
    };
  }

  private typeToTs(type: TypescriptType): string {
    switch (type.kind) {
      case 'primitive':
        return type.name;
      case 'array':
        return `${this.typeToTs(type.elementType)}[]`;
      case 'tuple': {
        const t = type as { kind: 'tuple'; elementTypes: TypescriptType[] };
        const parts = t.elementTypes.map(e => this.typeToTs(e)).join(', ');
        return `[${parts}]`;
      }
      case 'object': {
        const t = type;
        // If it's a simple Record<string, T> pattern, use that syntax
        if (t.properties.length === 0 && t.indexSignature) {
          const keyType = this.typeToTs(t.indexSignature.keyType);
          const valueType = this.typeToTs(t.indexSignature.valueType);
          if (keyType === 'string') {
            return `Record<string, ${valueType}>`;
          }
        }

        const props = t.properties
          .map(
            p =>
              `${p.readonly ? 'readonly ' : ''}${p.name}${p.optional ? '?' : ''}: ${this.typeToTs(p.type)};`
          )
          .join(' ');
        const indexSig = t.indexSignature
          ? `[key: ${this.typeToTs(t.indexSignature.keyType)}]: ${this.typeToTs(t.indexSignature.valueType)};`
          : '';
        return `{ ${props} ${indexSig} }`;
      }
      case 'union':
        return type.types.map(t => this.typeToTs(t)).join(' | ');
      case 'function': {
        const ft = type;
        const params = ft.parameters
          .map(
            p => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${this.typeToTs(p.type)}`
          )
          .join(', ');
        return `(${params}) => ${this.typeToTs(ft.returnType)}`;
      }
      case 'generic': {
        const g = type as { kind: 'generic'; name: string; typeArgs: TypescriptType[] };
        const args = g.typeArgs.map(a => this.typeToTs(a)).join(', ');
        return `${g.name}<${args}>`;
      }
      case 'custom': {
        const c = type as { kind: 'custom'; name: string };
        return c.name;
      }
      case 'literal': {
        const l = type as { kind: 'literal'; value: unknown };
        return JSON.stringify(l.value);
      }
      default:
        return 'unknown';
    }
  }
}
