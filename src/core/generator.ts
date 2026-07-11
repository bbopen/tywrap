/**
 * CodeGenerator - TypeScript wrapper generation
 */

import type {
  PythonGenericParameter,
  PythonFunction,
  PythonClass,
  PythonModule,
  PythonType,
  PythonTypeAlias,
  GeneratedCode,
  TypescriptType,
} from '../types/index.js';
import { globalCache } from '../utils/cache.js';

import {
  emitArgGuards,
  emitCallPrelude,
  type CallDescriptor,
  type CallEmitHelpers,
} from './emit-call.js';
import { TypeMapper } from './mapper.js';

interface GenericRenderParam {
  name: string;
  declaration: string;
}

interface GenericRenderContext {
  currentModule?: string;
  localDeclaredNames: Set<string>;
  declaration: string;
  typeArguments: string;
  emittedNames: Set<string>;
  emittedParamSpecs: Set<string>;
}

export interface CodeGeneratorOptions {
  /** Reports a generated annotation that cannot be represented by emitted declarations. */
  onTypeDegrade?: (typeName: string) => void;
}

export class CodeGenerator {
  private readonly mapper: TypeMapper;
  private readonly onTypeDegrade?: (typeName: string) => void;
  private readonly builtinGenericNames = new Set([
    'Array',
    'AsyncIterator',
    'Generator',
    'Iterable',
    'Iterator',
    'Promise',
    'Record',
  ]);
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

  constructor(mapper: TypeMapper = new TypeMapper(), options: CodeGeneratorOptions = {}) {
    this.mapper = mapper;
    this.onTypeDegrade = options.onTypeDegrade;
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

  private getTypeParameters(
    typeParameters?: readonly PythonGenericParameter[]
  ): readonly PythonGenericParameter[] {
    return typeParameters ?? [];
  }

  private buildGenericRenderContext(
    typeParameters: readonly PythonGenericParameter[],
    types: readonly PythonType[],
    currentModule?: string,
    localDeclaredNames: Set<string> = new Set()
  ): GenericRenderContext {
    const callableParamSpecs = new Set<string>();
    types.forEach(type => this.collectCallableParamSpecs(type, callableParamSpecs));

    const emitted: GenericRenderParam[] = [];
    const emittedNames = new Set<string>();
    const emittedParamSpecs = new Set<string>();

    typeParameters.forEach(param => {
      if (
        param.kind === 'typevar' &&
        !param.bound &&
        !(param.constraints && param.constraints.length > 0) &&
        (!param.variance || param.variance === 'invariant')
      ) {
        emitted.push({ name: param.name, declaration: param.name });
        emittedNames.add(param.name);
        return;
      }

      if (param.kind === 'paramspec' && callableParamSpecs.has(param.name)) {
        emitted.push({ name: param.name, declaration: `${param.name} extends unknown[]` });
        emittedNames.add(param.name);
        emittedParamSpecs.add(param.name);
      }
    });

    return {
      currentModule,
      localDeclaredNames,
      declaration:
        emitted.length > 0 ? `<${emitted.map(param => param.declaration).join(', ')}>` : '',
      typeArguments: emitted.length > 0 ? `<${emitted.map(param => param.name).join(', ')}>` : '',
      emittedNames,
      emittedParamSpecs,
    };
  }

  private mergeGenericRenderContexts(
    outer: GenericRenderContext,
    inner: GenericRenderContext
  ): GenericRenderContext {
    return {
      currentModule: inner.currentModule ?? outer.currentModule,
      localDeclaredNames: inner.localDeclaredNames,
      declaration: inner.declaration,
      typeArguments: inner.typeArguments,
      emittedNames: new Set([...outer.emittedNames, ...inner.emittedNames]),
      emittedParamSpecs: new Set([...outer.emittedParamSpecs, ...inner.emittedParamSpecs]),
    };
  }

  private collectCallableParamSpecs(type: PythonType, out: Set<string>): void {
    switch (type.kind) {
      case 'collection':
        type.itemTypes.forEach(item => this.collectCallableParamSpecs(item, out));
        break;
      case 'paramspec':
        out.add(type.name);
        break;
      case 'union':
        type.types.forEach(item => this.collectCallableParamSpecs(item, out));
        break;
      case 'optional':
        this.collectCallableParamSpecs(type.type, out);
        break;
      case 'generic':
        type.typeArgs.forEach(item => this.collectCallableParamSpecs(item, out));
        break;
      case 'callable':
        if (type.parameterSpec?.kind === 'paramspec') {
          out.add(type.parameterSpec.name);
        }
        type.parameters.forEach(item => this.collectCallableParamSpecs(item, out));
        this.collectCallableParamSpecs(type.returnType, out);
        break;
      case 'annotated':
        this.collectCallableParamSpecs(type.base, out);
        break;
      case 'final':
      case 'classvar':
        this.collectCallableParamSpecs(type.type, out);
        break;
      case 'unpack':
        this.collectCallableParamSpecs(type.type, out);
        break;
      default:
        break;
    }
  }

  private sanitizeType(type: PythonType, ctx: GenericRenderContext): PythonType {
    const unknownType = (): PythonType => ({ kind: 'custom', name: 'Any', module: 'typing' });

    switch (type.kind) {
      case 'primitive':
      case 'literal':
        return type;
      case 'custom':
        return type;
      case 'collection':
        return {
          ...type,
          itemTypes: type.itemTypes.map(item => this.sanitizeType(item, ctx)),
        };
      case 'union':
        return {
          ...type,
          types: type.types.map(item => this.sanitizeType(item, ctx)),
        };
      case 'optional':
        return { ...type, type: this.sanitizeType(type.type, ctx) };
      case 'generic':
        return {
          ...type,
          module: type.module === ctx.currentModule ? undefined : type.module,
          typeArgs: type.typeArgs.map(item => this.sanitizeType(item, ctx)),
        };
      case 'callable':
        if (type.parameterSpec && !ctx.emittedParamSpecs.has(type.parameterSpec.name)) {
          return {
            ...type,
            parameters: [{ kind: 'custom', name: '...' }],
            parameterSpec: undefined,
            returnType: this.sanitizeType(type.returnType, ctx),
          };
        }
        return {
          ...type,
          parameters: type.parameters.map(item => this.sanitizeType(item, ctx)),
          parameterSpec:
            type.parameterSpec && ctx.emittedParamSpecs.has(type.parameterSpec.name)
              ? type.parameterSpec
              : undefined,
          returnType: this.sanitizeType(type.returnType, ctx),
        };
      case 'annotated':
        return { ...type, base: this.sanitizeType(type.base, ctx) };
      case 'typevar':
      case 'paramspec':
        return ctx.emittedNames.has(type.name) ? type : unknownType();
      case 'paramspec_args':
        return {
          kind: 'collection',
          name: 'list',
          itemTypes: [unknownType()],
        };
      case 'paramspec_kwargs':
        return {
          kind: 'collection',
          name: 'dict',
          itemTypes: [{ kind: 'primitive', name: 'str' }, unknownType()],
        };
      case 'typevartuple':
        return unknownType();
      case 'unpack':
        return unknownType();
      case 'final':
        return { ...type, type: this.sanitizeType(type.type, ctx) };
      case 'classvar':
        return { ...type, type: this.sanitizeType(type.type, ctx) };
    }
  }

  private typeToTsFromPython(
    type: PythonType,
    ctx: GenericRenderContext,
    mappingContext: 'value' | 'return'
  ): string {
    return this.typeToTs(
      this.mapper.mapPythonType(this.sanitizeType(type, ctx), mappingContext),
      ctx,
      mappingContext
    );
  }

  private isLocalTypeIdentity(
    type: { name: string; module?: string },
    ctx: GenericRenderContext
  ): boolean {
    if (!ctx.localDeclaredNames.has(type.name)) {
      return false;
    }
    return type.module === undefined || type.module === ctx.currentModule;
  }

  private degradeType(type: { name: string; module?: string }): string {
    const identity = type.module ? `${type.module}.${type.name}` : type.name;
    this.onTypeDegrade?.(identity);
    return 'unknown';
  }

  private renderLooksLikeKwargsExpr(
    valueExpr: string,
    options: {
      keywordOnlyNames: string[];
      requiredKwOnlyNames: string[];
      hasVarKwArgs: boolean;
    }
  ): string {
    const base = `typeof ${valueExpr} === 'object' && ${valueExpr} !== null && !globalThis.Array.isArray(${valueExpr}) && (Object.getPrototypeOf(${valueExpr}) === Object.prototype || Object.getPrototypeOf(${valueExpr}) === null)`;

    const keyCheck = (() => {
      if (options.requiredKwOnlyNames.length > 0) {
        return options.requiredKwOnlyNames
          .map(k => `Object.prototype.hasOwnProperty.call(${valueExpr}, ${JSON.stringify(k)})`)
          .join(' && ');
      }
      if (options.hasVarKwArgs) {
        // With **kwargs, any plain object could be kwargs.
        return 'true';
      }
      if (options.keywordOnlyNames.length > 0) {
        return options.keywordOnlyNames
          .map(k => `Object.prototype.hasOwnProperty.call(${valueExpr}, ${JSON.stringify(k)})`)
          .join(' || ');
      }
      return 'false';
    })();

    return `(${base} && (${keyCheck}))`;
  }

  /** Helpers passed to the shared call-emission module (they depend on `this`). */
  private callEmitHelpers(): CallEmitHelpers {
    return {
      escapeIdentifier: (name: string): string => this.escapeIdentifier(name),
      renderLooksLikeKwargsExpr: (
        valueExpr: string,
        options: {
          keywordOnlyNames: string[];
          requiredKwOnlyNames: string[];
          hasVarKwArgs: boolean;
        }
      ): string => this.renderLooksLikeKwargsExpr(valueExpr, options),
    };
  }

  generateFunctionWrapper(
    func: PythonFunction,
    moduleName?: string,
    annotatedJSDoc = false,
    localDeclaredNames: Set<string> = new Set()
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
    const genericContext = this.buildGenericRenderContext(
      this.getTypeParameters(func.typeParameters),
      [func.returnType, ...filteredParams.map(param => param.type)],
      moduleName,
      localDeclaredNames
    );
    const typeParamDecl = genericContext.declaration;

    const tsTypeForValue = (p: (typeof filteredParams)[number]): string =>
      this.typeToTsFromPython(p.type, genericContext, 'value');

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

    const hasKwArgs = needsKwargsParam;
    const returnType = this.typeToTsFromPython(func.returnType, genericContext, 'return');
    const fname = this.escapeIdentifier(func.name);
    const moduleId = moduleName ?? '__main__';

    // Overloads: generate trailing optional parameter drop variants (exclude *args/**kwargs).
    // Why: Python APIs frequently have many optional tail params. TypeScript callers expect
    // `fn(a)`, `fn(a, b)`, ... all to typecheck. We emit a family of overloads that progressively
    // "drop" optional tail args, but also include the full positional signature (<= length) so a
    // call that supplies all args still matches an overload.
    const firstOptionalIndex = positionalParams.findIndex(p => p.optional);
    const requiredKwOnlyNames = keywordOnlyParams.filter(p => !p.optional).map(p => p.name);
    const keywordOnlyNames = keywordOnlyParams.map(p => p.name);
    const overloads: string[] = [];
    if (requiredKwOnlyNames.length > 0) {
      // Required keyword-only params must be represented with a required `kwargs` parameter.
      // Avoid "required after optional" by emitting overloads where all preceding parameters are required.
      const requiredPosCount =
        firstOptionalIndex >= 0 ? firstOptionalIndex : positionalParams.length;
      for (let i = requiredPosCount; i <= positionalParams.length; i++) {
        const head = positionalParams.slice(0, i).map(p => renderPositionalParam(p, true));
        const rest: string[] = [];
        const v = (() => {
          if (!varArgsParam) {
            return null;
          }
          const pname = this.escapeIdentifier(varArgsParam.name);
          if (!needsVarArgsArray) {
            return `...${pname}: unknown[]`;
          }
          // In overloads where `kwargs` is required, keep the `args` surrogate parameter required,
          // but allow `undefined` as a placeholder so callers can omit varargs while still passing kwargs.
          return `${pname}: unknown[] | undefined`;
        })();
        if (v) {
          rest.push(v);
        }
        const k = renderKwargsParam(true);
        if (k) {
          rest.push(k);
        }
        overloads.push(
          `export function ${fname}${typeParamDecl}(${[...head, ...rest].join(', ')}): Promise<${returnType}>;`
        );
        if (varArgsParam && needsVarArgsArray) {
          // Also allow callers to omit the varargs surrogate parameter entirely (i.e. `fn(kwargs)`).
          overloads.push(
            `export function ${fname}${typeParamDecl}(${[...head, renderKwargsParam(true)].join(', ')}): Promise<${returnType}>;`
          );
        }
      }
    } else if (firstOptionalIndex >= 0 && !varArgsParam && !needsKwargsParam) {
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
          `export function ${fname}${typeParamDecl}(${[...head, ...rest].join(', ')}): Promise<${returnType}>;`
        );
      }
    }

    const overloadDecl = overloads.length > 0 ? `${overloads.join('\n')}\n` : '';

    const firstOptionalPosIndex = positionalParams.findIndex(p => p.optional);
    const requiredPosCount =
      firstOptionalPosIndex >= 0 ? firstOptionalPosIndex : positionalParams.length;
    const callDescriptor: CallDescriptor = {
      positionalParams,
      varArgsParam,
      needsVarArgsArray,
      hasKwArgs,
      hasVarKwArgs,
      keywordOnlyNames,
      requiredKwOnlyNames,
      positionalOnlyNames,
      requiredPosCount,
      indent: '  ',
      errorLabel: func.name,
    };
    const guardLines = emitArgGuards(callDescriptor);
    const guards = guardLines.length > 0 ? `${guardLines.join('\n')}\n` : '';
    const callPreludeLines = emitCallPrelude(callDescriptor, this.callEmitHelpers());
    const callPrelude = callPreludeLines.length > 0 ? `${callPreludeLines.join('\n')}\n` : '';

    const ts = `${jsdoc}${overloadDecl}export async function ${fname}${typeParamDecl}(${paramDecl}): Promise<${returnType}> {
${callPrelude}${guards}  return getRuntimeBridge().call('${moduleId}', '${func.name}', __args${
      hasKwArgs ? ', __kwargs' : ''
    });
}
`;

    const declarationBody =
      overloads.length > 0
        ? overloadDecl
        : `export function ${fname}${typeParamDecl}(${paramDecl}): Promise<${returnType}>;\n`;

    return this.wrap(ts, `${jsdoc}${declarationBody}`, [func.name]);
  }

  generateClassWrapper(
    cls: PythonClass,
    moduleName?: string,
    _annotatedJSDoc = false,
    localDeclaredNames: Set<string> = new Set()
  ): GeneratedCode {
    const moduleDeclaredNames = new Set(localDeclaredNames);
    moduleDeclaredNames.add(cls.name);
    const jsdoc = this.generateJsDoc(cls.docstring);
    const classGenericContext = this.buildGenericRenderContext(
      this.getTypeParameters(cls.typeParameters),
      [
        ...cls.properties.map(property => property.type),
        ...(cls.accessors ?? []).map(accessor => accessor.type),
        ...cls.methods.flatMap(method => [
          method.returnType,
          ...method.parameters.map(p => p.type),
        ]),
      ],
      moduleName,
      moduleDeclaredNames
    );
    const classTypeParamDecl = classGenericContext.declaration;
    const cname = this.escapeIdentifier(cls.name);
    const wrapAlias = (body: string): GeneratedCode => {
      const ts = `${jsdoc}export type ${cname}${classTypeParamDecl} = ${body}\n`;
      return this.wrap(ts, ts, [cls.name]);
    };

    if (cls.decorators.includes('__typed_dict__') || cls.kind === 'typed_dict') {
      const props = cls.properties
        .map(p => {
          const pname = this.escapeIdentifier(p.name);
          const opt = (p as unknown as { optional?: boolean }).optional === true ? '?' : '';
          const t = this.typeToTsFromPython(p.type, classGenericContext, 'value');
          return `${pname}${opt}: ${t};`;
        })
        .join(' ');
      return wrapAlias(`{ ${props} }`);
    }

    if (cls.kind === 'namedtuple') {
      const elements = cls.properties.map(p =>
        this.typeToTsFromPython(p.type, classGenericContext, 'value')
      );
      return wrapAlias(`readonly [${elements.join(', ')}]`);
    }

    if (cls.kind === 'protocol') {
      const props = cls.properties
        .map(
          p =>
            `${this.escapeIdentifier(p.name)}: ${this.typeToTsFromPython(p.type, classGenericContext, 'value')};`
        )
        .join(' ');
      // @property / cached_property members are bridge-accessed getters; mirror
      // the concrete class's `get name(): Promise<T>` as readonly Promise props
      // so protocol typings include them too (IR 0.3.0).
      const accessors = (cls.accessors ?? [])
        .map(
          a =>
            `readonly ${this.escapeIdentifier(a.name)}: Promise<${this.typeToTsFromPython(a.type, classGenericContext, 'return')}>;`
        )
        .join(' ');
      const methods = cls.methods
        .filter(m => m.name !== '__init__')
        .map(m => {
          const fparams = m.parameters.filter(p => p.name !== 'self' && p.name !== 'cls');
          const methodOwnGenericContext = this.buildGenericRenderContext(
            this.getTypeParameters(m.typeParameters),
            [m.returnType, ...fparams.map(param => param.type)],
            moduleName,
            moduleDeclaredNames
          );
          const methodGenericContext = this.mergeGenericRenderContexts(
            classGenericContext,
            methodOwnGenericContext
          );
          const methodTypeParamDecl = methodOwnGenericContext.declaration;
          const paramsDecl = fparams
            .map(
              p =>
                `${this.escapeIdentifier(p.name)}${p.optional ? '?' : ''}: ${this.typeToTsFromPython(p.type, methodGenericContext, 'value')}`
            )
            .join(', ');
          const returnType = this.typeToTsFromPython(m.returnType, methodGenericContext, 'return');
          return `${this.escapeIdentifier(m.name)}: ${methodTypeParamDecl}(${paramsDecl}) => ${returnType};`;
        })
        .join(' ');
      return wrapAlias(`{ ${props} ${accessors} ${methods} }`);
    }

    if (cls.kind === 'dataclass' || cls.kind === 'pydantic') {
      const props = cls.properties
        .map(p => {
          const pname = this.escapeIdentifier(p.name);
          const opt = (p as unknown as { optional?: boolean }).optional === true ? '?' : '';
          const t = this.typeToTsFromPython(p.type, classGenericContext, 'value');
          return `${pname}${opt}: ${t};`;
        })
        .join(' ');
      return wrapAlias(`{ ${props} }`);
    }

    const moduleId = moduleName ?? '__main__';
    const sortedMethods = [...cls.methods].sort((a, b) => a.name.localeCompare(b.name));
    const methodBodies: string[] = [];
    const methodDeclarations: string[] = [];

    sortedMethods
      .filter(
        method =>
          method.name !== '__init__' &&
          (method.methodKind === 'class' || method.methodKind === 'static')
      )
      .forEach(method => {
        // v0.9 wrappers expose only class/static methods. They route through
        // the ordinary module call path and never retain process-local state.
        const staticPrefix = 'static ';
        const fparams = method.parameters.filter(p => p.name !== 'self' && p.name !== 'cls');
        const methodOwnGenericContext = this.buildGenericRenderContext(
          this.getTypeParameters(method.typeParameters),
          [method.returnType, ...fparams.map(param => param.type)],
          moduleName,
          moduleDeclaredNames
        );
        const methodGenericContext = this.mergeGenericRenderContexts(
          classGenericContext,
          methodOwnGenericContext
        );
        const methodTypeParamDecl = methodOwnGenericContext.declaration;
        const methodTsValueType = (p: (typeof fparams)[number]): string =>
          this.typeToTsFromPython(p.type, methodGenericContext, 'value');
        const keywordOnlyParams = fparams.filter(p => p.keywordOnly);
        const positionalOnlyNames = fparams.filter(p => p.positionalOnly).map(p => p.name);
        const hasVarKwArgs = fparams.some(p => p.kwArgs);
        const needsKwargsParam = keywordOnlyParams.length > 0 || hasVarKwArgs;
        const varArgsParam = fparams.find(p => p.varArgs);
        const needsVarArgsArray = Boolean(varArgsParam) && needsKwargsParam;
        const positionalParams = fparams.filter(p => !p.keywordOnly && !p.varArgs && !p.kwArgs);
        const firstOptionalPosIndex = positionalParams.findIndex(p => p.optional);
        const requiredPosCount =
          firstOptionalPosIndex >= 0 ? firstOptionalPosIndex : positionalParams.length;
        const keywordOnlyNames = keywordOnlyParams.map(p => p.name);

        const renderPositionalParam = (
          p: (typeof positionalParams)[number],
          forceRequired = false
        ): string => {
          const pname = this.escapeIdentifier(p.name);
          const opt = !forceRequired && p.optional ? '?' : '';
          return `${pname}${opt}: ${methodTsValueType(p)}`;
        };

        const kwargsType = (() => {
          if (!needsKwargsParam) {
            return '';
          }
          if (keywordOnlyParams.length === 0 && hasVarKwArgs) {
            return 'Record<string, unknown>';
          }
          const props = keywordOnlyParams
            .map(p => `${JSON.stringify(p.name)}${p.optional ? '?' : ''}: ${methodTsValueType(p)};`)
            .join(' ');
          const obj = `{ ${props} }`;
          return hasVarKwArgs ? `(${obj} & Record<string, unknown>)` : obj;
        })();

        const paramsDeclParts: string[] = [];
        positionalParams.forEach(p => {
          paramsDeclParts.push(renderPositionalParam(p));
        });
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

        const requiredKwOnlyNames = keywordOnlyParams.filter(p => !p.optional).map(p => p.name);
        const returnType = this.typeToTsFromPython(
          method.returnType,
          methodGenericContext,
          'return'
        );
        const mname = this.escapeIdentifier(method.name);

        const overloads: string[] = [];
        if (needsKwargsParam && requiredKwOnlyNames.length > 0) {
          const firstOptionalIndex = positionalParams.findIndex(p => p.optional);
          const requiredPosCount =
            firstOptionalIndex >= 0 ? firstOptionalIndex : positionalParams.length;
          for (let i = requiredPosCount; i <= positionalParams.length; i++) {
            const head = positionalParams.slice(0, i).map(p => renderPositionalParam(p, true));
            const rest: string[] = [];
            if (varArgsParam) {
              const vname = this.escapeIdentifier(varArgsParam.name);
              rest.push(
                needsVarArgsArray ? `${vname}: unknown[] | undefined` : `...${vname}: unknown[]`
              );
            }
            rest.push(`kwargs: ${kwargsType}`);
            overloads.push(
              `  ${staticPrefix}${mname}${methodTypeParamDecl}(${[...head, ...rest].join(', ')}): Promise<${returnType}>;`
            );
            if (varArgsParam && needsVarArgsArray) {
              overloads.push(
                `  ${staticPrefix}${mname}${methodTypeParamDecl}(${[...head, `kwargs: ${kwargsType}`].join(', ')}): Promise<${returnType}>;`
              );
            }
          }
        }
        const overloadDecl = overloads.length > 0 ? `${overloads.join('\n')}\n` : '';

        const callDescriptor: CallDescriptor = {
          positionalParams,
          varArgsParam,
          needsVarArgsArray,
          hasKwArgs: needsKwargsParam,
          hasVarKwArgs,
          keywordOnlyNames,
          requiredKwOnlyNames,
          positionalOnlyNames,
          requiredPosCount,
          indent: '    ',
          errorLabel: method.name,
        };
        const callPreludeLines = emitCallPrelude(callDescriptor, this.callEmitHelpers());
        const callPrelude = callPreludeLines.length > 0 ? `${callPreludeLines.join('\n')}\n` : '';

        const guardLines = emitArgGuards(callDescriptor);
        const guards = guardLines.length > 0 ? `${guardLines.join('\n')}\n` : '';

        const callExpr = `getRuntimeBridge().call('${moduleId}', '${cls.name}.${method.name}', __args${
          needsKwargsParam ? ', __kwargs' : ''
        })`;
        methodBodies.push(`${overloadDecl}  ${staticPrefix}async ${mname}${methodTypeParamDecl}(${paramsDecl}): Promise<${returnType}> {
${callPrelude}${guards}    return ${callExpr};
  }`);
        methodDeclarations.push(
          `${overloadDecl}${overloads.length > 0 ? '' : `  ${staticPrefix}${mname}${methodTypeParamDecl}(${paramsDecl}): Promise<${returnType}>;\n`}`
        );
      });

    const methodsSection = methodBodies.length > 0 ? `\n${methodBodies.join('\n')}\n` : '\n';
    const declarationMethodsSection =
      methodDeclarations.length > 0 ? `\n${methodDeclarations.join('')}\n` : '\n';
    // The constructor counts: a class whose only member was __init__ loses
    // create(), so it needs the migration note as much as one with methods.
    const omittedInstanceMembers =
      cls.methods.some(method => method.methodKind !== 'class' && method.methodKind !== 'static') ||
      (cls.accessors?.length ?? 0) > 0;
    const migrationNote = omittedInstanceMembers
      ? '  // NOTE: Instance members are not generated in v0.9; migrate this API to value-returning module functions.\n'
      : '';
    const ts = `${jsdoc}export class ${cname}${classTypeParamDecl} {
${migrationNote}${methodsSection}
}
`;

    const declaration = `${jsdoc}export class ${cname}${classTypeParamDecl} {
${migrationNote}${declarationMethodsSection}
}
`;

    return this.wrap(ts, declaration, [cls.name]);
  }

  generateTypeAlias(
    alias: PythonTypeAlias,
    moduleName?: string,
    localDeclaredNames: Set<string> = new Set()
  ): GeneratedCode {
    const genericContext = this.buildGenericRenderContext(
      this.getTypeParameters(alias.typeParameters),
      [alias.type],
      moduleName,
      localDeclaredNames
    );
    const aliasName = this.escapeIdentifier(alias.name, { preserveCase: true });
    const body = this.typeToTsFromPython(alias.type, genericContext, 'value');
    const ts = `export type ${aliasName}${genericContext.declaration} = ${body}\n`;
    return this.wrap(ts, ts, [alias.name]);
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
    const localDeclaredNames = new Set([
      ...module.classes.map(cls => cls.name),
      ...(module.typeAliases ?? []).map(alias => alias.name),
    ]);
    const functionResults = [...module.functions]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => this.generateFunctionWrapper(f, module.name, annotatedJSDoc, localDeclaredNames));
    const classResults = [...module.classes]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => this.generateClassWrapper(c, module.name, annotatedJSDoc, localDeclaredNames));
    const typeAliasResults = [...(module.typeAliases ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(alias => this.generateTypeAlias(alias, module.name, localDeclaredNames));

    const functionCodes = functionResults.map(result => result.typescript).join('\n');
    const classCodes = classResults.map(result => result.typescript).join('\n');
    const typeAliasCodes = typeAliasResults.map(result => result.typescript).join('\n');

    const header = `// Generated by tywrap\n// Module: ${module.name}\n// DO NOT EDIT MANUALLY\n\n`;
    const declarationHeader = `// Generated by tywrap\n// Type Declarations\n// DO NOT EDIT MANUALLY\n\n`;
    const hasRuntimeClasses = module.classes.some(c => {
      const kind = c.kind ?? 'class';
      return kind === 'class' && !c.decorators.includes('__typed_dict__');
    });
    const needsRuntime = module.functions.length > 0 || hasRuntimeClasses;
    const bridgeDecl = needsRuntime ? `import { getRuntimeBridge } from 'tywrap/runtime';\n\n` : '';

    const ts = `${`${header}${bridgeDecl}${functionCodes}\n${classCodes}\n${typeAliasCodes}`.trimEnd()}\n`;
    const declaration = `${`${declarationHeader}${functionResults
      .map(result => result.declaration)
      .join('\n')}\n${classResults
      .map(result => result.declaration)
      .join('\n')}\n${typeAliasResults.map(result => result.declaration).join('\n')}`.trimEnd()}\n`;
    return this.wrap(ts, declaration, [module.name]);
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

  private wrap(typescript: string, declaration: string, _sources: string[]): GeneratedCode {
    return {
      typescript,
      declaration,
      sourceMap: undefined,
      metadata: {
        generatedAt: new Date(),
        sourceFiles: [],
        runtime: 'auto',
        optimizations: [],
      },
    };
  }

  private typeToTs(
    type: TypescriptType,
    ctx?: GenericRenderContext,
    mappingContext: 'value' | 'return' = 'value'
  ): string {
    switch (type.kind) {
      case 'primitive':
        return type.name;
      case 'array':
        return `${this.typeToTs(type.elementType, ctx, mappingContext)}[]`;
      case 'tuple': {
        const t = type as { kind: 'tuple'; elementTypes: TypescriptType[] };
        const parts = t.elementTypes.map(e => this.typeToTs(e, ctx, mappingContext)).join(', ');
        return `[${parts}]`;
      }
      case 'object': {
        const t = type;
        // If it's a simple Record<string, T> pattern, use that syntax
        if (t.properties.length === 0 && t.indexSignature) {
          const keyType = this.typeToTs(t.indexSignature.keyType, ctx, mappingContext);
          const valueType = this.typeToTs(t.indexSignature.valueType, ctx, mappingContext);
          if (keyType === 'string') {
            return `Record<string, ${valueType}>`;
          }
        }

        const props = t.properties
          .map(
            p =>
              `${p.readonly ? 'readonly ' : ''}${p.name}${p.optional ? '?' : ''}: ${this.typeToTs(p.type, ctx, mappingContext)};`
          )
          .join(' ');
        const indexSig = t.indexSignature
          ? `[key: ${this.typeToTs(t.indexSignature.keyType, ctx, mappingContext)}]: ${this.typeToTs(t.indexSignature.valueType, ctx, mappingContext)};`
          : '';
        return `{ ${props} ${indexSig} }`;
      }
      case 'union':
        return type.types.map(t => this.typeToTs(t, ctx, mappingContext)).join(' | ');
      case 'function': {
        const ft = type;
        const params = ft.parameters
          .map(
            p =>
              `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${this.typeToTs(p.type, ctx, mappingContext)}`
          )
          .join(', ');
        return `(${params}) => ${this.typeToTs(ft.returnType, ctx, mappingContext)}`;
      }
      case 'generic': {
        const g = type as {
          kind: 'generic';
          name: string;
          module?: string;
          typeArgs: TypescriptType[];
        };
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(g.name)) {
          return this.degradeType(g);
        }
        if (ctx && !this.builtinGenericNames.has(g.name) && !this.isLocalTypeIdentity(g, ctx)) {
          return this.degradeType(g);
        }
        const args = g.typeArgs.map(a => this.typeToTs(a, ctx, mappingContext)).join(', ');
        return `${g.name}<${args}>`;
      }
      case 'custom': {
        const c = type as { kind: 'custom'; name: string; module?: string };
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(c.name)) {
          return this.degradeType(c);
        }
        if (
          ctx &&
          !this.isLocalTypeIdentity(c, ctx) &&
          !(c.module === 'typing' && ctx.emittedNames.has(c.name))
        ) {
          return this.degradeType(c);
        }
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
