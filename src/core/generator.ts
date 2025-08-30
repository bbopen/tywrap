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

import { TypeMapper } from './mapper.js';
import { globalCache } from '../utils/cache.js';

export class CodeGenerator {
  private readonly mapper = new TypeMapper();
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
      .replace(/[^\x00-\x7F]/g, (char) => {
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
    const renderParam = (p: (typeof filteredParams)[number]): string => {
      const pname = this.escapeIdentifier(p.name);
      if (p.varArgs) {
        return `...${pname}: unknown[]`;
      }
      if (p.kwArgs) {
        return `kwargs?: Record<string, unknown>`;
      }
      return `${pname}${p.optional ? '?' : ''}: ${this.typeToTs(
        this.mapper.mapPythonType(p.type, 'value')
      )}`;
    };
    const paramDecl = filteredParams.map(renderParam).join(', ');
    const callArgs = filteredParams
      .map(p =>
        p.kwArgs
          ? 'kwargs'
          : p.varArgs
            ? `...${this.escapeIdentifier(p.name)}`
            : this.escapeIdentifier(p.name)
      )
      .join(', ');
    const returnType = this.typeToTs(this.mapper.mapPythonType(func.returnType, 'return'));
    const fname = this.escapeIdentifier(func.name);
    const qualified = moduleName ? `${moduleName}.${func.name}` : func.name;

    // Overloads: generate trailing optional parameter drop variants (exclude *args/**kwargs)
    const positional = filteredParams.filter(p => !p.varArgs && !p.kwArgs);
    const firstOptionalIndex = positional.findIndex(p => p.optional);
    const overloads: string[] = [];
    if (firstOptionalIndex >= 0) {
      for (let i = firstOptionalIndex; i < positional.length; i++) {
        const head = positional.slice(0, i);
        const rest = filteredParams.filter(p => p.varArgs || p.kwArgs);
        const sigParams = [...head, ...rest].map(renderParam).join(', ');
        overloads.push(`export function ${fname}(${sigParams}): Promise<${returnType}>;`);
      }
    }

    const overloadDecl = overloads.length > 0 ? `${overloads.join('\n')}\n` : '';
    const ts = `${jsdoc}${overloadDecl}export async function ${fname}(${paramDecl}): Promise<${returnType}> {
  return __bridge.call('${qualified}', [${callArgs}]);
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
    const methodBodies = sortedMethods
      .filter(m => m.name !== '__init__')
      .map(m => {
        const fparams = m.parameters.filter(p => p.name !== 'self' && p.name !== 'cls');
        const paramsDecl = fparams
          .map(p =>
            p.varArgs
              ? `...${this.escapeIdentifier(p.name)}: unknown[]`
              : p.kwArgs
                ? `kwargs?: Record<string, unknown>`
                : `${this.escapeIdentifier(p.name)}${p.optional ? '?' : ''}: ${this.typeToTs(this.mapper.mapPythonType(p.type, 'value'))}`
          )
          .join(', ');
        const callPassthrough = fparams
          .map(p =>
            p.kwArgs
              ? 'kwargs'
              : p.varArgs
                ? `...${this.escapeIdentifier(p.name)}`
                : this.escapeIdentifier(p.name)
          )
          .join(', ');
        const returnType = this.typeToTs(this.mapper.mapPythonType(m.returnType, 'return'));
        const qualified = moduleName
          ? `${moduleName}.${cls.name}.${m.name}`
          : `${cls.name}.${m.name}`;
        return `  async ${this.escapeIdentifier(m.name)}(${paramsDecl}): Promise<${returnType}> { return __bridge.call('${qualified}', [this.__handle${callPassthrough ? `, ${callPassthrough}` : ''}]); }`;
      })
      .join('\n');

    // Constructor typing from __init__
    const init = cls.methods.find(m => m.name === '__init__');
    const ctorParams = init
      ? init.parameters
          .filter(p => p.name !== 'self' && p.name !== 'cls')
          .map(p =>
            p.varArgs
              ? `...${this.escapeIdentifier(p.name)}: unknown[]`
              : p.kwArgs
                ? `kwargs?: Record<string, unknown>`
                : `${this.escapeIdentifier(p.name)}${p.optional ? '?' : ''}: ${this.typeToTs(this.mapper.mapPythonType(p.type, 'value'))}`
          )
          .join(', ')
      : `...args: unknown[]`;

    const ctorArgsPassthrough = init
      ? init.parameters
          .filter(p => p.name !== 'self' && p.name !== 'cls')
          .map(p =>
            p.kwArgs
              ? 'kwargs'
              : p.varArgs
                ? `...${this.escapeIdentifier(p.name)}`
                : this.escapeIdentifier(p.name)
          )
          .join(', ')
      : '...args';

    const cname = this.escapeIdentifier(cls.name);
    const ts = `${jsdoc}export class ${cname} {
  private __handle: unknown;
  constructor(${ctorParams}) { this.__handle = __bridge.instantiate('${moduleName ? `${moduleName}.` : ''}${cls.name}', [${ctorArgsPassthrough}]); }
${methodBodies}
}
`;

    return this.wrap(ts, [cls.name]);
  }

  /**
   * Generate TypeScript wrapper for Python module with caching
   */
  async generateModule(
    module: PythonModule, 
    options: { moduleName: string; exportAll?: boolean; annotatedJSDoc?: boolean } = { moduleName: 'unknown' }
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
    const bridgeDecl = `declare const __bridge: { call<T = unknown>(qualified: string, args: unknown[]): Promise<T>; instantiate<T = unknown>(qualified: string, args: unknown[]): Promise<T>; };\n\n`;

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
