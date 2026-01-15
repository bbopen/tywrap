/**
 * TypeMapper - Python to TypeScript type conversion
 */

import type {
  PythonType,
  PrimitiveType as PyPrimitiveType,
  CollectionType as PyCollectionType,
  UnionType as PyUnionType,
  OptionalType as PyOptionalType,
  GenericType as PyGenericType,
  TypeVarType as PyTypeVarType,
  FinalType as PyFinalType,
  ClassVarType as PyClassVarType,
  TypescriptType,
  TSPrimitiveType,
  TSArrayType,
  TSTupleType,
  TSObjectType,
  TSUnionType,
  TSFunctionType,
  TSGenericType,
  TSCustomType,
  TSIndexSignature,
  TSLiteralType,
  TypePreset,
} from '../types/index.js';

export type MappingContext = 'value' | 'return';

export interface TypeMapperOptions {
  presets?: readonly TypePreset[];
}

export class TypeMapper {
  private readonly presets: Set<TypePreset>;

  constructor(options: TypeMapperOptions = {}) {
    this.presets = new Set(options.presets ?? []);
  }

  mapPythonType(pythonType: PythonType, context: MappingContext = 'value'): TypescriptType {
    switch (pythonType.kind) {
      case 'primitive':
        return this.mapPrimitiveType(pythonType, context);
      case 'collection':
        return this.mapCollectionType(pythonType);
      case 'union':
        return this.mapUnionType(pythonType, context);
      case 'optional':
        return this.mapOptionalType(pythonType, context);
      case 'generic':
        return this.mapGenericType(pythonType, context);
      case 'custom':
        return this.mapCustomType(pythonType, context);
      case 'callable':
        return this.mapCallableType(pythonType);
      case 'literal':
        return this.mapLiteralType(pythonType);
      case 'annotated':
        // Pass-through base for type shape; metadata used at generation when configured
        return this.mapPythonType(pythonType.base, context);
      case 'typevar':
        return this.mapTypeVarType(pythonType, context);
      case 'final':
        return this.mapFinalType(pythonType, context);
      case 'classvar':
        return this.mapClassVarType(pythonType, context);
    }
  }

  mapPrimitiveType(type: PyPrimitiveType, context: MappingContext = 'value'): TSPrimitiveType {
    const name =
      type.name === 'int' || type.name === 'float'
        ? 'number'
        : type.name === 'str'
          ? 'string'
          : type.name === 'bool'
            ? 'boolean'
            : type.name === 'bytes'
              ? 'string'
              : // None
                context === 'return'
                ? 'void'
                : 'null';

    return { kind: 'primitive', name };
  }

  mapCollectionType(
    type: PyCollectionType
  ): TSArrayType | TSTupleType | TSObjectType | TSGenericType {
    // list[T] -> Array<T>
    if (type.name === 'list') {
      const elementType = this.mapPythonType(
        type.itemTypes[0] ?? { kind: 'custom', name: 'Any', module: 'typing' }
      );
      return {
        kind: 'array',
        elementType,
      } satisfies TSArrayType;
    }

    // tuple[T1, T2, ...] -> [T1, T2, ...] (exact arity)
    if (type.name === 'tuple') {
      const elementTypes: TypescriptType[] =
        type.itemTypes.length > 0
          ? type.itemTypes.map(t => this.mapPythonType(t))
          : ([{ kind: 'primitive', name: 'undefined' }] as const);
      return { kind: 'tuple', elementTypes } satisfies TSTupleType;
    }

    // set[T] -> Set<T>
    if (type.name === 'set' || type.name === 'frozenset') {
      const elementType = this.mapPythonType(
        type.itemTypes[0] ?? { kind: 'custom', name: 'Any', module: 'typing' }
      );
      return {
        kind: 'generic',
        name: 'Set',
        typeArgs: [elementType],
      } satisfies TSGenericType;
    }

    // dict[K, V] -> { [key: K]: V }
    if (type.name === 'dict') {
      const keyPy = type.itemTypes[0] ?? { kind: 'primitive', name: 'str' };
      const valPy = type.itemTypes[1] ?? { kind: 'custom', name: 'Any', module: 'typing' };
      const key = this.mapPythonType(keyPy);
      const value = this.mapPythonType(valPy);

      const indexSignature: TSIndexSignature = {
        keyType: this.asIndexKeyType(key),
        valueType: value,
      };

      return {
        kind: 'object',
        properties: [],
        indexSignature,
      } satisfies TSObjectType;
    }

    // Default to object unknown index
    return {
      kind: 'object',
      properties: [],
      indexSignature: {
        keyType: { kind: 'primitive', name: 'string' },
        valueType: { kind: 'primitive', name: 'unknown' },
      },
    } satisfies TSObjectType;
  }

  mapUnionType(type: PyUnionType, context: MappingContext = 'value'): TSUnionType {
    return {
      kind: 'union',
      types: type.types.map(t => this.mapPythonType(t, context)),
    };
  }

  mapOptionalType(type: PyOptionalType, context: MappingContext = 'value'): TSUnionType {
    const inner = this.mapPythonType(type.type, context);
    return {
      kind: 'union',
      types: [inner, { kind: 'primitive', name: 'null' }],
    };
  }

  mapGenericType(type: PyGenericType, context: MappingContext = 'value'): TSGenericType {
    return {
      kind: 'generic',
      name: type.name,
      typeArgs: type.typeArgs.map(t => this.mapPythonType(t, context)),
    };
  }

  mapCustomType(
    type: { kind: 'custom'; name: string; module?: string },
    _context: MappingContext = 'value'
  ): TypescriptType {
    // Normalize some known typing names into TS primitives/generics
    const name = type.name;
    const fullName = type.module ? `${type.module}.${name}` : name;

    // Top and bottom types
    if (name === 'Any' || fullName === 'typing.Any') {
      return { kind: 'primitive', name: 'unknown' };
    }
    if (
      name === 'Never' ||
      fullName === 'typing.Never' ||
      name === 'NoReturn' ||
      fullName === 'typing.NoReturn'
    ) {
      return { kind: 'primitive', name: 'never' };
    }

    // String types
    if (name === 'LiteralString' || fullName === 'typing.LiteralString') {
      return { kind: 'primitive', name: 'string' };
    }
    if (name === 'AnyStr' || fullName === 'typing.AnyStr') {
      return { kind: 'primitive', name: 'string' };
    }

    // Object types
    if (name === 'object' || fullName === 'builtins.object') {
      return { kind: 'primitive', name: 'object' };
    }

    // Callable types
    if (name === 'Callable' || fullName === 'typing.Callable') {
      return {
        kind: 'function',
        isAsync: false,
        parameters: [
          {
            name: 'args',
            type: { kind: 'array', elementType: { kind: 'primitive', name: 'unknown' } },
            optional: false,
            rest: true,
          },
        ],
        returnType: { kind: 'primitive', name: 'unknown' },
      };
    }

    // Async types
    if (name === 'Awaitable' || fullName === 'typing.Awaitable') {
      return {
        kind: 'generic',
        name: 'Promise',
        typeArgs: [{ kind: 'primitive', name: 'unknown' }],
      };
    }
    if (name === 'Coroutine' || fullName === 'typing.Coroutine') {
      return {
        kind: 'generic',
        name: 'Promise',
        typeArgs: [{ kind: 'primitive', name: 'unknown' }],
      };
    }

    // Collection types that should be generics
    if (name === 'Sequence' || fullName === 'typing.Sequence') {
      return {
        kind: 'generic',
        name: 'Array',
        typeArgs: [{ kind: 'primitive', name: 'unknown' }],
      };
    }
    if (name === 'Mapping' || fullName === 'typing.Mapping') {
      return {
        kind: 'object',
        properties: [],
        indexSignature: {
          keyType: { kind: 'primitive', name: 'string' },
          valueType: { kind: 'primitive', name: 'unknown' },
        },
      };
    }

    const presetType = this.mapPresetType(type);
    if (presetType) {
      return presetType;
    }

    // Forward references and user types
    const normalized = this.normalizeCustomType(type);
    return { kind: 'custom', name: normalized.name, module: normalized.module };
  }

  mapCallableType(type: {
    kind: 'callable';
    parameters: PythonType[];
    returnType: PythonType;
  }): TSFunctionType {
    // Support Callable[[...], R] → (...args: unknown[]) => R
    const onlyEllipsis =
      type.parameters.length === 1 &&
      type.parameters[0]?.kind === 'custom' &&
      (type.parameters[0] as { kind: 'custom'; name: string }).name === '...';

    return {
      kind: 'function',
      isAsync: false,
      parameters: onlyEllipsis
        ? ([
            {
              name: 'args',
              type: { kind: 'array', elementType: { kind: 'primitive', name: 'unknown' } },
              optional: false,
              rest: true,
            },
          ] as const satisfies TSFunctionType['parameters'])
        : type.parameters.map((p, i) => ({
            name: `arg${i}`,
            type: this.mapPythonType(p, 'value'),
            optional: false,
            rest: false,
          })),
      returnType: this.mapPythonType(type.returnType, 'return'),
    } satisfies TSFunctionType;
  }

  mapLiteralType(type: {
    kind: 'literal';
    value: string | number | boolean | null;
  }): TSLiteralType {
    return { kind: 'literal', value: type.value };
  }

  mapTypeVarType(type: PyTypeVarType, _context: MappingContext = 'value'): TSCustomType {
    // TypeVar maps to a generic type parameter in TypeScript
    // Bounds and constraints are not directly expressible in TypeScript type system
    return {
      kind: 'custom',
      name: type.name,
      module: 'typing',
    };
  }

  mapFinalType(type: PyFinalType, context: MappingContext = 'value'): TypescriptType {
    // Final[T] maps to T in TypeScript (no direct Final equivalent)
    // The Final qualifier is more of a static analysis hint
    return this.mapPythonType(type.type, context);
  }

  mapClassVarType(type: PyClassVarType, context: MappingContext = 'value'): TypescriptType {
    // ClassVar[T] maps to T in TypeScript (class variables are just properties)
    // The ClassVar qualifier is more of a static analysis hint
    return this.mapPythonType(type.type, context);
  }

  private asIndexKeyType(key: TypescriptType): TSPrimitiveType {
    if (key.kind === 'primitive' && (key.name === 'string' || key.name === 'number')) {
      return key;
    }
    return { kind: 'primitive', name: 'string' };
  }

  private hasPreset(name: TypePreset): boolean {
    return this.presets.has(name);
  }

  private normalizeCustomType(type: { name: string; module?: string }): {
    name: string;
    module?: string;
    rawName: string;
  } {
    // Why: the Python IR sometimes represents qualified names like "pandas.DataFrame" as a single
    // `name` string (with dots) instead of splitting into { module, name }. Dots are not valid in
    // TypeScript identifiers, and we want stable test expectations, so normalize to a leaf `name`
    // plus a `module` path when possible.
    const rawName = type.name;
    if (type.module) {
      return { name: type.name, module: type.module, rawName };
    }
    if (rawName.includes('.')) {
      const parts = rawName.split('.').filter(part => part.length > 0);
      if (parts.length === 0) {
        return { name: rawName, module: undefined, rawName };
      }
      return {
        name: parts[parts.length - 1] ?? rawName,
        module: parts.length > 1 ? parts.slice(0, -1).join('.') : undefined,
        rawName,
      };
    }
    return { name: rawName, module: undefined, rawName };
  }

  private mapPresetType(type: { name: string; module?: string }): TypescriptType | undefined {
    const normalized = this.normalizeCustomType(type);
    const name = normalized.name;
    const moduleName = normalized.module;
    const stringType: TSPrimitiveType = { kind: 'primitive', name: 'string' };
    const numberType: TSPrimitiveType = { kind: 'primitive', name: 'number' };
    const unknownType: TSPrimitiveType = { kind: 'primitive', name: 'unknown' };
    const numberArray: TSArrayType = { kind: 'array', elementType: numberType };
    const unknownArray: TSArrayType = { kind: 'array', elementType: unknownType };
    const recordObject: TSObjectType = {
      kind: 'object',
      properties: [],
      indexSignature: {
        keyType: stringType,
        valueType: unknownType,
      },
    };
    const prop = (
      propName: string,
      typeValue: TypescriptType,
      optional = false
    ): TSObjectType['properties'][number] => ({
      name: propName,
      type: typeValue,
      optional,
      readonly: false,
    });

    if (this.hasPreset('stdlib')) {
      const stdlibModule = moduleName ?? '';
      const allowModule =
        !moduleName ||
        stdlibModule === 'datetime' ||
        stdlibModule === 'decimal' ||
        stdlibModule === 'uuid' ||
        stdlibModule === 'pathlib';
      if (allowModule) {
        if (name === 'datetime' || name === 'date' || name === 'time') {
          return { kind: 'primitive', name: 'string' };
        }
        if (name === 'timedelta') {
          return { kind: 'primitive', name: 'number' };
        }
        if (name === 'Decimal' || name === 'UUID') {
          return { kind: 'primitive', name: 'string' };
        }
        if (
          name === 'Path' ||
          name === 'PurePath' ||
          name === 'PosixPath' ||
          name === 'WindowsPath'
        ) {
          return { kind: 'primitive', name: 'string' };
        }
      }
    }

    if (this.hasPreset('pandas')) {
      const allowModule = !moduleName || moduleName.startsWith('pandas');
      if (allowModule) {
        if (name === 'DataFrame') {
          const recordsArray: TSArrayType = { kind: 'array', elementType: recordObject };
          return { kind: 'union', types: [recordObject, recordsArray] };
        }
        if (name === 'Series') {
          const valuesArray: TSArrayType = {
            kind: 'array',
            elementType: { kind: 'primitive', name: 'unknown' },
          };
          return { kind: 'union', types: [valuesArray, recordObject] };
        }
      }
    }

    if (this.hasPreset('scipy')) {
      const allowModule = !moduleName || moduleName.startsWith('scipy');
      if (allowModule) {
        const baseProps = [prop('shape', numberArray), prop('dtype', stringType, true)];
        const buildSparse = (format: 'csr' | 'csc' | 'coo'): TSObjectType => ({
          kind: 'object',
          properties: [
            prop('format', { kind: 'literal', value: format }),
            ...baseProps,
            prop('data', unknownArray),
            ...(format === 'coo'
              ? [prop('row', numberArray), prop('col', numberArray)]
              : [prop('indices', numberArray), prop('indptr', numberArray)]),
          ],
        });
        if (name === 'csr_matrix') {
          return buildSparse('csr');
        }
        if (name === 'csc_matrix') {
          return buildSparse('csc');
        }
        if (name === 'coo_matrix') {
          return buildSparse('coo');
        }
        if (name === 'spmatrix') {
          return {
            kind: 'union',
            types: [buildSparse('csr'), buildSparse('csc'), buildSparse('coo')],
          };
        }
      }
    }

    if (this.hasPreset('torch')) {
      const allowModule = !moduleName || moduleName.startsWith('torch');
      if (allowModule && name === 'Tensor') {
        return {
          kind: 'object',
          properties: [
            prop('data', unknownType),
            prop('shape', numberArray),
            prop('dtype', stringType, true),
            prop('device', stringType, true),
          ],
        };
      }
    }

    if (this.hasPreset('sklearn')) {
      const allowModule = !moduleName || moduleName.startsWith('sklearn');
      if (allowModule && name === 'BaseEstimator') {
        return {
          kind: 'object',
          properties: [
            prop('className', stringType),
            prop('module', stringType),
            prop('version', stringType, true),
            prop('params', recordObject),
          ],
        };
      }
    }

    return undefined;
  }
}
