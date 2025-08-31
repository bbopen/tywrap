import { describe, it, expect, test } from 'vitest';
import { TypeMapper } from '../src/core/mapper.js';
import type {
  PythonType,
  TypescriptType,
  TSPrimitiveType,
  TSArrayType,
  TSUnionType,
  TSObjectType,
  TSGenericType,
  TSCustomType,
  TSFunctionType,
  TSLiteralType,
  TSTupleType
} from '../src/types/index.js';

describe('TypeMapper - Advanced Type Mapping Validation', () => {
  const mapper = new TypeMapper();

  describe('Primitive Type Mappings', () => {
    const primitiveTestCases: Array<{
      python: string;
      expected: string;
      context?: 'value' | 'return';
    }> = [
      { python: 'int', expected: 'number' },
      { python: 'float', expected: 'number' },
      { python: 'str', expected: 'string' },
      { python: 'bool', expected: 'boolean' },
      { python: 'bytes', expected: 'string' },
      { python: 'None', expected: 'null', context: 'value' },
      { python: 'None', expected: 'void', context: 'return' },
    ];

    primitiveTestCases.forEach(({ python, expected, context }) => {
      test(`maps Python ${python} to TypeScript ${expected}${context ? ` (context: ${context})` : ''}`, () => {
        const pythonType: PythonType = { kind: 'primitive', name: python as any };
        const result = mapper.mapPythonType(pythonType, context);
        
        expect(result).toEqual({
          kind: 'primitive',
          name: expected,
        } satisfies TSPrimitiveType);
      });
    });
  });

  describe('Collection Type Mappings', () => {
    test('maps list[T] to Array<T>', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'list',
        itemTypes: [{ kind: 'primitive', name: 'int' }]
      };

      const result = mapper.mapPythonType(pythonType) as TSArrayType;
      
      expect(result.kind).toBe('array');
      expect(result.elementType).toEqual({ kind: 'primitive', name: 'number' });
    });

    test('maps empty list to Array<never>', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'list',
        itemTypes: []
      };

      const result = mapper.mapPythonType(pythonType) as TSArrayType;
      
      expect(result.kind).toBe('array');
      expect(result.elementType).toEqual({ kind: 'primitive', name: 'null' });
    });

    test('maps tuple[T1, T2, ...] to exact TypeScript tuple', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'tuple',
        itemTypes: [
          { kind: 'primitive', name: 'int' },
          { kind: 'primitive', name: 'str' },
          { kind: 'primitive', name: 'bool' }
        ]
      };

      const result = mapper.mapPythonType(pythonType) as TSTupleType;
      
      expect(result.kind).toBe('tuple');
      expect(result.elementTypes).toEqual([
        { kind: 'primitive', name: 'number' },
        { kind: 'primitive', name: 'string' },
        { kind: 'primitive', name: 'boolean' }
      ]);
    });

    test('maps empty tuple to [undefined]', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'tuple',
        itemTypes: []
      };

      const result = mapper.mapPythonType(pythonType) as TSTupleType;
      
      expect(result.kind).toBe('tuple');
      expect(result.elementTypes).toEqual([{ kind: 'primitive', name: 'undefined' }]);
    });

    test('maps set[T] to Set<T>', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'set',
        itemTypes: [{ kind: 'primitive', name: 'str' }]
      };

      const result = mapper.mapPythonType(pythonType) as TSGenericType;
      
      expect(result.kind).toBe('generic');
      expect(result.name).toBe('Set');
      expect(result.typeArgs).toEqual([{ kind: 'primitive', name: 'string' }]);
    });

    test('maps frozenset[T] to Set<T>', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'frozenset',
        itemTypes: [{ kind: 'primitive', name: 'int' }]
      };

      const result = mapper.mapPythonType(pythonType) as TSGenericType;
      
      expect(result.kind).toBe('generic');
      expect(result.name).toBe('Set');
      expect(result.typeArgs).toEqual([{ kind: 'primitive', name: 'number' }]);
    });

    test('maps dict[K, V] to index signature object', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'dict',
        itemTypes: [
          { kind: 'primitive', name: 'str' },
          { kind: 'primitive', name: 'int' }
        ]
      };

      const result = mapper.mapPythonType(pythonType) as TSObjectType;
      
      expect(result.kind).toBe('object');
      expect(result.properties).toEqual([]);
      expect(result.indexSignature).toEqual({
        keyType: { kind: 'primitive', name: 'string' },
        valueType: { kind: 'primitive', name: 'number' }
      });
    });

    test('maps dict with int keys to number index signature', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'dict',
        itemTypes: [
          { kind: 'primitive', name: 'int' },
          { kind: 'primitive', name: 'str' }
        ]
      };

      const result = mapper.mapPythonType(pythonType) as TSObjectType;
      
      expect(result.kind).toBe('object');
      expect(result.indexSignature?.keyType).toEqual({ kind: 'primitive', name: 'number' });
      expect(result.indexSignature?.valueType).toEqual({ kind: 'primitive', name: 'string' });
    });

    test('maps dict with complex keys to string index signature fallback', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'dict',
        itemTypes: [
          { kind: 'primitive', name: 'bool' }, // bool is not valid TS index key
          { kind: 'primitive', name: 'int' }
        ]
      };

      const result = mapper.mapPythonType(pythonType) as TSObjectType;
      
      expect(result.kind).toBe('object');
      expect(result.indexSignature?.keyType).toEqual({ kind: 'primitive', name: 'string' });
      expect(result.indexSignature?.valueType).toEqual({ kind: 'primitive', name: 'number' });
    });

    test('maps empty dict to string index signature with str keys and null values', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'dict',
        itemTypes: []
      };

      const result = mapper.mapPythonType(pythonType) as TSObjectType;
      
      expect(result.kind).toBe('object');
      expect(result.indexSignature).toEqual({
        keyType: { kind: 'primitive', name: 'string' },
        valueType: { kind: 'primitive', name: 'null' }
      });
    });
  });

  describe('Union and Optional Types', () => {
    test('maps Union[int, str] correctly', () => {
      const pythonType: PythonType = {
        kind: 'union',
        types: [
          { kind: 'primitive', name: 'int' },
          { kind: 'primitive', name: 'str' }
        ]
      };

      const result = mapper.mapPythonType(pythonType) as TSUnionType;
      
      expect(result.kind).toBe('union');
      expect(result.types).toEqual([
        { kind: 'primitive', name: 'number' },
        { kind: 'primitive', name: 'string' }
      ]);
    });

    test('maps Optional[T] to T | null', () => {
      const pythonType: PythonType = {
        kind: 'optional',
        type: { kind: 'primitive', name: 'int' }
      };

      const result = mapper.mapPythonType(pythonType) as TSUnionType;
      
      expect(result.kind).toBe('union');
      expect(result.types).toEqual([
        { kind: 'primitive', name: 'number' },
        { kind: 'primitive', name: 'null' }
      ]);
    });

    test('maps complex nested union types', () => {
      const pythonType: PythonType = {
        kind: 'union',
        types: [
          { kind: 'primitive', name: 'int' },
          {
            kind: 'collection',
            name: 'list',
            itemTypes: [{ kind: 'primitive', name: 'str' }]
          },
          {
            kind: 'optional',
            type: { kind: 'primitive', name: 'bool' }
          }
        ]
      };

      const result = mapper.mapPythonType(pythonType) as TSUnionType;
      
      expect(result.kind).toBe('union');
      expect(result.types).toHaveLength(3);
      expect(result.types[0]).toEqual({ kind: 'primitive', name: 'number' });
      expect(result.types[1]).toEqual({
        kind: 'array',
        elementType: { kind: 'primitive', name: 'string' }
      });
      expect(result.types[2]).toEqual({
        kind: 'union',
        types: [
          { kind: 'primitive', name: 'boolean' },
          { kind: 'primitive', name: 'null' }
        ]
      });
    });
  });

  describe('Generic Type Mappings', () => {
    test('maps basic generic types', () => {
      const pythonType: PythonType = {
        kind: 'generic',
        name: 'List',
        typeArgs: [{ kind: 'primitive', name: 'int' }]
      };

      const result = mapper.mapPythonType(pythonType) as TSGenericType;
      
      expect(result.kind).toBe('generic');
      expect(result.name).toBe('List');
      expect(result.typeArgs).toEqual([{ kind: 'primitive', name: 'number' }]);
    });

    test('maps nested generic types', () => {
      const pythonType: PythonType = {
        kind: 'generic',
        name: 'Dict',
        typeArgs: [
          { kind: 'primitive', name: 'str' },
          {
            kind: 'generic',
            name: 'List',
            typeArgs: [{ kind: 'primitive', name: 'int' }]
          }
        ]
      };

      const result = mapper.mapPythonType(pythonType) as TSGenericType;
      
      expect(result.kind).toBe('generic');
      expect(result.name).toBe('Dict');
      expect(result.typeArgs).toEqual([
        { kind: 'primitive', name: 'string' },
        {
          kind: 'generic',
          name: 'List',
          typeArgs: [{ kind: 'primitive', name: 'number' }]
        }
      ]);
    });
  });

  describe('Custom Type Mappings', () => {
    test('maps typing.Any to unknown', () => {
      const pythonType: PythonType = {
        kind: 'custom',
        name: 'Any',
        module: 'typing'
      };

      const result = mapper.mapPythonType(pythonType) as TSPrimitiveType;
      
      expect(result).toEqual({ kind: 'primitive', name: 'unknown' });
    });

    test('maps typing.Never to never', () => {
      const pythonType: PythonType = {
        kind: 'custom',
        name: 'Never',
        module: 'typing'
      };

      const result = mapper.mapPythonType(pythonType) as TSPrimitiveType;
      
      expect(result).toEqual({ kind: 'primitive', name: 'never' });
    });

    test('maps typing.LiteralString to string', () => {
      const pythonType: PythonType = {
        kind: 'custom',
        name: 'LiteralString',
        module: 'typing'
      };

      const result = mapper.mapPythonType(pythonType) as TSPrimitiveType;
      
      expect(result).toEqual({ kind: 'primitive', name: 'string' });
    });

    test('maps Callable to function type', () => {
      const pythonType: PythonType = {
        kind: 'custom',
        name: 'Callable'
      };

      const result = mapper.mapPythonType(pythonType) as TSFunctionType;
      
      expect(result.kind).toBe('function');
      expect(result.isAsync).toBe(false);
      expect(result.parameters).toHaveLength(1);
      expect(result.parameters[0]?.rest).toBe(true);
      expect(result.returnType).toEqual({ kind: 'primitive', name: 'unknown' });
    });

    test('preserves custom user types', () => {
      const pythonType: PythonType = {
        kind: 'custom',
        name: 'MyClass',
        module: 'my_module'
      };

      const result = mapper.mapPythonType(pythonType) as TSCustomType;
      
      expect(result.kind).toBe('custom');
      expect(result.name).toBe('MyClass');
      expect(result.module).toBe('my_module');
    });
  });

  describe('Callable Type Mappings', () => {
    test('maps Callable[[int, str], bool] to specific function signature', () => {
      const pythonType: PythonType = {
        kind: 'callable',
        parameters: [
          { kind: 'primitive', name: 'int' },
          { kind: 'primitive', name: 'str' }
        ],
        returnType: { kind: 'primitive', name: 'bool' }
      };

      const result = mapper.mapPythonType(pythonType) as TSFunctionType;
      
      expect(result.kind).toBe('function');
      expect(result.isAsync).toBe(false);
      expect(result.parameters).toHaveLength(2);
      expect(result.parameters[0]).toEqual({
        name: 'arg0',
        type: { kind: 'primitive', name: 'number' },
        optional: false,
        rest: false
      });
      expect(result.parameters[1]).toEqual({
        name: 'arg1',
        type: { kind: 'primitive', name: 'string' },
        optional: false,
        rest: false
      });
      expect(result.returnType).toEqual({ kind: 'primitive', name: 'boolean' });
    });

    test('maps Callable[..., T] to rest args function', () => {
      const pythonType: PythonType = {
        kind: 'callable',
        parameters: [{ kind: 'custom', name: '...' }],
        returnType: { kind: 'primitive', name: 'str' }
      };

      const result = mapper.mapPythonType(pythonType) as TSFunctionType;
      
      expect(result.kind).toBe('function');
      expect(result.parameters).toHaveLength(1);
      expect(result.parameters[0]).toEqual({
        name: 'args',
        type: { kind: 'array', elementType: { kind: 'primitive', name: 'unknown' } },
        optional: false,
        rest: true
      });
      expect(result.returnType).toEqual({ kind: 'primitive', name: 'string' });
    });

    test('maps callable with None return to void in return context', () => {
      const pythonType: PythonType = {
        kind: 'callable',
        parameters: [],
        returnType: { kind: 'primitive', name: 'None' }
      };

      const result = mapper.mapPythonType(pythonType) as TSFunctionType;
      
      expect(result.kind).toBe('function');
      expect(result.returnType).toEqual({ kind: 'primitive', name: 'void' });
    });
  });

  describe('Literal Type Mappings', () => {
    const literalTestCases = [
      { value: 'hello', expected: 'hello' },
      { value: 42, expected: 42 },
      { value: true, expected: true },
      { value: false, expected: false },
      { value: null, expected: null }
    ] as const;

    literalTestCases.forEach(({ value, expected }) => {
      test(`maps literal ${JSON.stringify(value)} correctly`, () => {
        const pythonType: PythonType = {
          kind: 'literal',
          value: value
        };

        const result = mapper.mapPythonType(pythonType) as TSLiteralType;
        
        expect(result.kind).toBe('literal');
        expect(result.value).toBe(expected);
      });
    });
  });

  describe('Annotated Type Mappings', () => {
    test('maps Annotated[T, ...] to base type T', () => {
      const pythonType: PythonType = {
        kind: 'annotated',
        base: { kind: 'primitive', name: 'int' },
        metadata: ['some metadata', { constraint: 'gt=0' }]
      };

      const result = mapper.mapPythonType(pythonType);
      
      // Should pass through to base type
      expect(result).toEqual({ kind: 'primitive', name: 'number' });
    });

    test('maps nested Annotated types', () => {
      const pythonType: PythonType = {
        kind: 'annotated',
        base: {
          kind: 'collection',
          name: 'list',
          itemTypes: [{
            kind: 'annotated',
            base: { kind: 'primitive', name: 'str' },
            metadata: ['min_length=1']
          }]
        },
        metadata: ['max_items=100']
      };

      const result = mapper.mapPythonType(pythonType) as TSArrayType;
      
      expect(result.kind).toBe('array');
      expect(result.elementType).toEqual({ kind: 'primitive', name: 'string' });
    });
  });

  describe('Complex Nested Type Mappings', () => {
    test('maps Union[List[Dict[str, Optional[int]]], str]', () => {
      const pythonType: PythonType = {
        kind: 'union',
        types: [
          {
            kind: 'collection',
            name: 'list',
            itemTypes: [{
              kind: 'collection',
              name: 'dict',
              itemTypes: [
                { kind: 'primitive', name: 'str' },
                {
                  kind: 'optional',
                  type: { kind: 'primitive', name: 'int' }
                }
              ]
            }]
          },
          { kind: 'primitive', name: 'str' }
        ]
      };

      const result = mapper.mapPythonType(pythonType) as TSUnionType;
      
      expect(result.kind).toBe('union');
      expect(result.types).toHaveLength(2);
      
      // First type: Array<{ [key: string]: number | null }>
      const firstType = result.types[0] as TSArrayType;
      expect(firstType.kind).toBe('array');
      
      const dictType = firstType.elementType as TSObjectType;
      expect(dictType.kind).toBe('object');
      expect(dictType.indexSignature?.keyType).toEqual({ kind: 'primitive', name: 'string' });
      
      const valueUnion = dictType.indexSignature?.valueType as TSUnionType;
      expect(valueUnion.kind).toBe('union');
      expect(valueUnion.types).toEqual([
        { kind: 'primitive', name: 'number' },
        { kind: 'primitive', name: 'null' }
      ]);
      
      // Second type: string
      expect(result.types[1]).toEqual({ kind: 'primitive', name: 'string' });
    });

    test('maps deeply nested generic Dict[str, List[Tuple[int, Optional[str]]]]', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'dict',
        itemTypes: [
          { kind: 'primitive', name: 'str' },
          {
            kind: 'collection',
            name: 'list',
            itemTypes: [{
              kind: 'collection',
              name: 'tuple',
              itemTypes: [
                { kind: 'primitive', name: 'int' },
                {
                  kind: 'optional',
                  type: { kind: 'primitive', name: 'str' }
                }
              ]
            }]
          }
        ]
      };

      const result = mapper.mapPythonType(pythonType) as TSObjectType;
      
      expect(result.kind).toBe('object');
      expect(result.indexSignature?.keyType).toEqual({ kind: 'primitive', name: 'string' });
      
      const listType = result.indexSignature?.valueType as TSArrayType;
      expect(listType.kind).toBe('array');
      
      const tupleType = listType.elementType as TSTupleType;
      expect(tupleType.kind).toBe('tuple');
      expect(tupleType.elementTypes).toHaveLength(2);
      expect(tupleType.elementTypes[0]).toEqual({ kind: 'primitive', name: 'number' });
      
      const optionalStr = tupleType.elementTypes[1] as TSUnionType;
      expect(optionalStr.kind).toBe('union');
      expect(optionalStr.types).toEqual([
        { kind: 'primitive', name: 'string' },
        { kind: 'primitive', name: 'null' }
      ]);
    });

    test('maps complex callable type Callable[[Dict[str, Any]], Optional[List[int]]]', () => {
      const pythonType: PythonType = {
        kind: 'callable',
        parameters: [{
          kind: 'collection',
          name: 'dict',
          itemTypes: [
            { kind: 'primitive', name: 'str' },
            { kind: 'custom', name: 'Any' }
          ]
        }],
        returnType: {
          kind: 'optional',
          type: {
            kind: 'collection',
            name: 'list',
            itemTypes: [{ kind: 'primitive', name: 'int' }]
          }
        }
      };

      const result = mapper.mapPythonType(pythonType) as TSFunctionType;
      
      expect(result.kind).toBe('function');
      expect(result.parameters).toHaveLength(1);
      
      const paramType = result.parameters[0]?.type as TSObjectType;
      expect(paramType.kind).toBe('object');
      expect(paramType.indexSignature?.valueType).toEqual({ kind: 'primitive', name: 'unknown' });
      
      const returnUnion = result.returnType as TSUnionType;
      expect(returnUnion.kind).toBe('union');
      expect(returnUnion.types).toHaveLength(2);
      
      const arrayType = returnUnion.types[0] as TSArrayType;
      expect(arrayType.kind).toBe('array');
      expect(arrayType.elementType).toEqual({ kind: 'primitive', name: 'number' });
      expect(returnUnion.types[1]).toEqual({ kind: 'primitive', name: 'null' });
    });
  });

  describe('Context-Sensitive Mappings', () => {
    test('maps None differently in value vs return context', () => {
      const pythonType: PythonType = { kind: 'primitive', name: 'None' };
      
      const valueResult = mapper.mapPythonType(pythonType, 'value');
      expect(valueResult).toEqual({ kind: 'primitive', name: 'null' });
      
      const returnResult = mapper.mapPythonType(pythonType, 'return');
      expect(returnResult).toEqual({ kind: 'primitive', name: 'void' });
    });

    test('preserves context through nested type mappings', () => {
      const pythonType: PythonType = {
        kind: 'optional',
        type: { kind: 'primitive', name: 'None' }
      };
      
      const valueResult = mapper.mapPythonType(pythonType, 'value') as TSUnionType;
      expect(valueResult.types[0]).toEqual({ kind: 'primitive', name: 'null' });
      expect(valueResult.types[1]).toEqual({ kind: 'primitive', name: 'null' });
      
      const returnResult = mapper.mapPythonType(pythonType, 'return') as TSUnionType;
      expect(returnResult.types[0]).toEqual({ kind: 'primitive', name: 'void' });
      expect(returnResult.types[1]).toEqual({ kind: 'primitive', name: 'null' });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('handles unknown collection types gracefully', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'unknown_collection' as any,
        itemTypes: []
      };

      const result = mapper.mapPythonType(pythonType) as TSObjectType;
      
      expect(result.kind).toBe('object');
      expect(result.properties).toEqual([]);
      expect(result.indexSignature).toEqual({
        keyType: { kind: 'primitive', name: 'string' },
        valueType: { kind: 'primitive', name: 'unknown' }
      });
    });

    test('handles empty union types', () => {
      const pythonType: PythonType = {
        kind: 'union',
        types: []
      };

      const result = mapper.mapPythonType(pythonType) as TSUnionType;
      
      expect(result.kind).toBe('union');
      expect(result.types).toEqual([]);
    });

    test('handles deeply nested empty structures', () => {
      const pythonType: PythonType = {
        kind: 'collection',
        name: 'list',
        itemTypes: [{
          kind: 'collection',
          name: 'dict',
          itemTypes: []
        }]
      };

      const result = mapper.mapPythonType(pythonType) as TSArrayType;
      
      expect(result.kind).toBe('array');
      
      const dictType = result.elementType as TSObjectType;
      expect(dictType.kind).toBe('object');
      expect(dictType.indexSignature?.valueType).toEqual({ kind: 'primitive', name: 'null' });
    });
  });

  describe('Bidirectional Type Validation', () => {
    const testCases: Array<{
      name: string;
      python: PythonType;
      expectedKind: TypescriptType['kind'];
      canRoundtrip?: boolean;
    }> = [
      {
        name: 'int -> number',
        python: { kind: 'primitive', name: 'int' },
        expectedKind: 'primitive',
        canRoundtrip: false // number could be int or float
      },
      {
        name: 'str -> string',
        python: { kind: 'primitive', name: 'str' },
        expectedKind: 'primitive',
        canRoundtrip: true
      },
      {
        name: 'list[int] -> Array<number>',
        python: {
          kind: 'collection',
          name: 'list',
          itemTypes: [{ kind: 'primitive', name: 'int' }]
        },
        expectedKind: 'array',
        canRoundtrip: false
      },
      {
        name: 'Union[str, int] -> string | number',
        python: {
          kind: 'union',
          types: [
            { kind: 'primitive', name: 'str' },
            { kind: 'primitive', name: 'int' }
          ]
        },
        expectedKind: 'union',
        canRoundtrip: false
      }
    ];

    testCases.forEach(({ name, python, expectedKind, canRoundtrip }) => {
      test(`validates ${name} type mapping integrity`, () => {
        const result = mapper.mapPythonType(python);
        expect(result.kind).toBe(expectedKind);

        // Test that mapping is consistent
        const secondResult = mapper.mapPythonType(python);
        expect(result).toEqual(secondResult);

        // Test information preservation
        if (expectedKind === 'primitive') {
          const primitiveResult = result as TSPrimitiveType;
          expect(['string', 'number', 'boolean', 'null', 'undefined', 'void', 'unknown', 'never'])
            .toContain(primitiveResult.name);
        }
      });
    });
  });
});