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
} from '../types/index.js';

export type MappingContext = 'value' | 'return';

export class TypeMapper {
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
        type.itemTypes[0] ?? { kind: 'primitive', name: 'None' }
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
        type.itemTypes[0] ?? { kind: 'primitive', name: 'None' }
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
      const valPy = type.itemTypes[1] ?? { kind: 'primitive', name: 'None' };
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
    context: MappingContext = 'value'
  ): TSCustomType {
    // Normalize some known typing names into TS primitives/generics
    const name = type.name;
    if (name === 'Any' || name === 'typing.Any') {
      return { kind: 'primitive', name: 'unknown' } as unknown as TSCustomType;
    }
    if (name === 'Never' || name === 'typing.Never') {
      return {
        kind: 'primitive',
        name: context === 'return' ? 'never' : 'never',
      } as unknown as TSCustomType;
    }
    if (name === 'LiteralString' || name === 'typing.LiteralString') {
      return { kind: 'primitive', name: 'string' } as unknown as TSCustomType;
    }
    if (name === 'Callable') {
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
      } as unknown as TSCustomType;
    }
    return { kind: 'custom', name: type.name, module: type.module };
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

  private asIndexKeyType(key: TypescriptType): TSPrimitiveType {
    if (key.kind === 'primitive' && (key.name === 'string' || key.name === 'number')) {
      return key;
    }
    return { kind: 'primitive', name: 'string' };
  }
}
