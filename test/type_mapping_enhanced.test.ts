import { describe, it, expect, test } from 'vitest';
import { TypeMapper } from '../src/core/mapper.js';
import type {
  PythonType,
  TypescriptType,
  TSPrimitiveType,
  TSCustomType,
  TSGenericType,
  TSObjectType
} from '../src/types/index.js';

describe('TypeMapper - Enhanced Type Support', () => {
  const mapper = new TypeMapper();

  describe('TypeVar Support', () => {
    test('maps basic TypeVar to custom type', () => {
      const typeVar: PythonType = {
        kind: 'typevar',
        name: 'T'
      };

      const result = mapper.mapPythonType(typeVar) as TSCustomType;
      
      expect(result.kind).toBe('custom');
      expect(result.name).toBe('T');
      expect(result.module).toBe('typing');
    });

    test('maps bounded TypeVar preserving name', () => {
      const boundedTypeVar: PythonType = {
        kind: 'typevar',
        name: 'T',
        bound: { kind: 'custom', name: 'BaseClass' }
      };

      const result = mapper.mapPythonType(boundedTypeVar) as TSCustomType;
      
      expect(result.kind).toBe('custom');
      expect(result.name).toBe('T');
      expect(result.module).toBe('typing');
    });

    test('maps constrained TypeVar preserving name', () => {
      const constrainedTypeVar: PythonType = {
        kind: 'typevar',
        name: 'T',
        constraints: [
          { kind: 'primitive', name: 'str' },
          { kind: 'primitive', name: 'int' }
        ]
      };

      const result = mapper.mapPythonType(constrainedTypeVar) as TSCustomType;
      
      expect(result.kind).toBe('custom');
      expect(result.name).toBe('T');
    });

    test('maps covariant TypeVar', () => {
      const covariantTypeVar: PythonType = {
        kind: 'typevar',
        name: 'T_co',
        variance: 'covariant'
      };

      const result = mapper.mapPythonType(covariantTypeVar) as TSCustomType;
      
      expect(result.kind).toBe('custom');
      expect(result.name).toBe('T_co');
    });
  });

  describe('Final Type Support', () => {
    test('maps Final[T] to T', () => {
      const finalType: PythonType = {
        kind: 'final',
        type: { kind: 'primitive', name: 'str' }
      };

      const result = mapper.mapPythonType(finalType);
      
      expect(result).toEqual({ kind: 'primitive', name: 'string' });
    });

    test('maps Final[List[int]] correctly', () => {
      const finalList: PythonType = {
        kind: 'final',
        type: {
          kind: 'collection',
          name: 'list',
          itemTypes: [{ kind: 'primitive', name: 'int' }]
        }
      };

      const result = mapper.mapPythonType(finalList);
      
      expect(result.kind).toBe('array');
      expect((result as any).elementType).toEqual({ kind: 'primitive', name: 'number' });
    });
  });

  describe('ClassVar Type Support', () => {
    test('maps ClassVar[T] to T', () => {
      const classVarType: PythonType = {
        kind: 'classvar',
        type: { kind: 'primitive', name: 'int' }
      };

      const result = mapper.mapPythonType(classVarType);
      
      expect(result).toEqual({ kind: 'primitive', name: 'number' });
    });

    test('maps ClassVar[Optional[str]] correctly', () => {
      const classVarOptional: PythonType = {
        kind: 'classvar',
        type: {
          kind: 'optional',
          type: { kind: 'primitive', name: 'str' }
        }
      };

      const result = mapper.mapPythonType(classVarOptional);
      
      expect(result.kind).toBe('union');
      expect((result as any).types).toEqual([
        { kind: 'primitive', name: 'string' },
        { kind: 'primitive', name: 'null' }
      ]);
    });
  });

  describe('Enhanced Custom Type Mappings', () => {
    test('maps typing.NoReturn to never', () => {
      const noReturnType: PythonType = {
        kind: 'custom',
        name: 'NoReturn',
        module: 'typing'
      };

      const result = mapper.mapPythonType(noReturnType) as TSPrimitiveType;
      
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('never');
    });

    test('maps typing.AnyStr to string', () => {
      const anyStrType: PythonType = {
        kind: 'custom',
        name: 'AnyStr',
        module: 'typing'
      };

      const result = mapper.mapPythonType(anyStrType) as TSPrimitiveType;
      
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('string');
    });

    test('maps builtins.object to object', () => {
      const objectType: PythonType = {
        kind: 'custom',
        name: 'object',
        module: 'builtins'
      };

      const result = mapper.mapPythonType(objectType) as TSPrimitiveType;
      
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('object');
    });

    test('maps typing.Awaitable to Promise generic', () => {
      const awaitableType: PythonType = {
        kind: 'custom',
        name: 'Awaitable',
        module: 'typing'
      };

      const result = mapper.mapPythonType(awaitableType) as TSGenericType;
      
      expect(result.kind).toBe('generic');
      expect(result.name).toBe('Promise');
      expect(result.typeArgs).toEqual([{ kind: 'primitive', name: 'unknown' }]);
    });

    test('maps typing.Coroutine to Promise generic', () => {
      const coroutineType: PythonType = {
        kind: 'custom',
        name: 'Coroutine',
        module: 'typing'
      };

      const result = mapper.mapPythonType(coroutineType) as TSGenericType;
      
      expect(result.kind).toBe('generic');
      expect(result.name).toBe('Promise');
      expect(result.typeArgs).toEqual([{ kind: 'primitive', name: 'unknown' }]);
    });

    test('maps typing.Sequence to Array generic', () => {
      const sequenceType: PythonType = {
        kind: 'custom',
        name: 'Sequence',
        module: 'typing'
      };

      const result = mapper.mapPythonType(sequenceType) as TSGenericType;
      
      expect(result.kind).toBe('generic');
      expect(result.name).toBe('Array');
      expect(result.typeArgs).toEqual([{ kind: 'primitive', name: 'unknown' }]);
    });

    test('maps typing.Mapping to object with index signature', () => {
      const mappingType: PythonType = {
        kind: 'custom',
        name: 'Mapping',
        module: 'typing'
      };

      const result = mapper.mapPythonType(mappingType) as TSObjectType;
      
      expect(result.kind).toBe('object');
      expect(result.properties).toEqual([]);
      expect(result.indexSignature).toEqual({
        keyType: { kind: 'primitive', name: 'string' },
        valueType: { kind: 'primitive', name: 'unknown' }
      });
    });
  });

  describe('Module-qualified Type Names', () => {
    test('handles unqualified type names correctly', () => {
      const unqualifiedType: PythonType = {
        kind: 'custom',
        name: 'Any'
      };

      const result = mapper.mapPythonType(unqualifiedType) as TSPrimitiveType;
      
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('unknown');
    });

    test('handles fully qualified type names correctly', () => {
      const qualifiedType: PythonType = {
        kind: 'custom',
        name: 'Any',
        module: 'typing'
      };

      const result = mapper.mapPythonType(qualifiedType) as TSPrimitiveType;
      
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('unknown');
    });

    test('preserves unknown custom types', () => {
      const unknownType: PythonType = {
        kind: 'custom',
        name: 'MyCustomClass',
        module: 'my.module'
      };

      const result = mapper.mapPythonType(unknownType) as TSCustomType;
      
      expect(result.kind).toBe('custom');
      expect(result.name).toBe('MyCustomClass');
      expect(result.module).toBe('my.module');
    });
  });

  describe('Complex Type Combinations', () => {
    test('maps Final[TypeVar] combination', () => {
      const finalTypeVar: PythonType = {
        kind: 'final',
        type: {
          kind: 'typevar',
          name: 'T'
        }
      };

      const result = mapper.mapPythonType(finalTypeVar) as TSCustomType;
      
      expect(result.kind).toBe('custom');
      expect(result.name).toBe('T');
      expect(result.module).toBe('typing');
    });

    test('maps ClassVar[Final[int]] correctly', () => {
      const classVarFinal: PythonType = {
        kind: 'classvar',
        type: {
          kind: 'final',
          type: { kind: 'primitive', name: 'int' }
        }
      };

      const result = mapper.mapPythonType(classVarFinal) as TSPrimitiveType;
      
      expect(result.kind).toBe('primitive');
      expect(result.name).toBe('number');
    });

    test('maps Union with TypeVar and Final types', () => {
      const complexUnion: PythonType = {
        kind: 'union',
        types: [
          { kind: 'typevar', name: 'T' },
          { kind: 'final', type: { kind: 'primitive', name: 'None' } },
          { kind: 'classvar', type: { kind: 'primitive', name: 'str' } }
        ]
      };

      const result = mapper.mapPythonType(complexUnion);
      
      expect(result.kind).toBe('union');
      const unionResult = result as any;
      expect(unionResult.types).toHaveLength(3);
      
      // TypeVar becomes custom type
      expect(unionResult.types[0]).toEqual({
        kind: 'custom',
        name: 'T',
        module: 'typing'
      });
      
      // Final[None] becomes null
      expect(unionResult.types[1]).toEqual({
        kind: 'primitive',
        name: 'null'
      });
      
      // ClassVar[str] becomes string
      expect(unionResult.types[2]).toEqual({
        kind: 'primitive',
        name: 'string'
      });
    });
  });

  describe('Context-sensitive Type Mapping', () => {
    test('TypeVar mapping is context-independent', () => {
      const typeVar: PythonType = {
        kind: 'typevar',
        name: 'T'
      };

      const valueResult = mapper.mapPythonType(typeVar, 'value');
      const returnResult = mapper.mapPythonType(typeVar, 'return');
      
      expect(valueResult).toEqual(returnResult);
      expect(valueResult).toEqual({
        kind: 'custom',
        name: 'T',
        module: 'typing'
      });
    });

    test('Final types preserve context for inner types', () => {
      const finalNone: PythonType = {
        kind: 'final',
        type: { kind: 'primitive', name: 'None' }
      };

      const valueResult = mapper.mapPythonType(finalNone, 'value');
      const returnResult = mapper.mapPythonType(finalNone, 'return');
      
      expect(valueResult).toEqual({ kind: 'primitive', name: 'null' });
      expect(returnResult).toEqual({ kind: 'primitive', name: 'void' });
    });
  });

  describe('Type Safety Validation', () => {
    test('all enhanced types produce valid TypeScript types', () => {
      const testTypes: PythonType[] = [
        { kind: 'typevar', name: 'T' },
        { kind: 'final', type: { kind: 'primitive', name: 'str' } },
        { kind: 'classvar', type: { kind: 'primitive', name: 'int' } },
        { kind: 'custom', name: 'NoReturn', module: 'typing' },
        { kind: 'custom', name: 'Awaitable', module: 'typing' },
        { kind: 'custom', name: 'Sequence', module: 'typing' }
      ];

      testTypes.forEach(pythonType => {
        const result = mapper.mapPythonType(pythonType);
        
        // Verify result has valid TypeScript type structure
        expect(result).toHaveProperty('kind');
        expect(['primitive', 'array', 'tuple', 'object', 'union', 'function', 'generic', 'literal', 'custom'])
          .toContain(result.kind);
          
        // Verify type-specific properties
        if (result.kind === 'primitive') {
          expect(['string', 'number', 'boolean', 'null', 'undefined', 'void', 'unknown', 'never', 'object'])
            .toContain((result as TSPrimitiveType).name);
        }
      });
    });
  });
});