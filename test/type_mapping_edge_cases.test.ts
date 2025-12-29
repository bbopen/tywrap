import { describe, it, expect, test } from 'vitest';
import { TypeMapper } from '../src/core/mapper.js';
import type {
  PythonType,
  TypescriptType,
  TSCustomType,
  TSUnionType,
  TSObjectType,
  TSArrayType,
  TSGenericType,
} from '../src/types/index.js';

describe('TypeMapper - Edge Cases and Advanced Scenarios', () => {
  const mapper = new TypeMapper();

  describe('Forward References', () => {
    test('handles forward reference strings', () => {
      // Python: List['Node'] where Node is defined later
      const forwardRefType: PythonType = {
        kind: 'collection',
        name: 'list',
        itemTypes: [
          {
            kind: 'custom',
            name: 'Node', // Forward reference as string
          },
        ],
      };

      const result = mapper.mapPythonType(forwardRefType) as TSArrayType;

      expect(result.kind).toBe('array');
      expect(result.elementType).toEqual({
        kind: 'custom',
        name: 'Node',
      });
    });

    test('handles quoted forward references', () => {
      // Python: Optional['MyClass']
      const quotedRefType: PythonType = {
        kind: 'optional',
        type: {
          kind: 'custom',
          name: 'MyClass',
        },
      };

      const result = mapper.mapPythonType(quotedRefType) as TSUnionType;

      expect(result.kind).toBe('union');
      expect(result.types[0]).toEqual({
        kind: 'custom',
        name: 'MyClass',
      });
    });

    test('handles deeply nested forward references', () => {
      // Python: Dict[str, List['TreeNode']]
      const nestedForwardRef: PythonType = {
        kind: 'collection',
        name: 'dict',
        itemTypes: [
          { kind: 'primitive', name: 'str' },
          {
            kind: 'collection',
            name: 'list',
            itemTypes: [
              {
                kind: 'custom',
                name: 'TreeNode',
              },
            ],
          },
        ],
      };

      const result = mapper.mapPythonType(nestedForwardRef) as TSObjectType;

      expect(result.kind).toBe('object');

      const valueType = result.indexSignature?.valueType as TSArrayType;
      expect(valueType.kind).toBe('array');
      expect(valueType.elementType).toEqual({
        kind: 'custom',
        name: 'TreeNode',
      });
    });
  });

  describe('Self Types', () => {
    test('maps Self type to custom type', () => {
      // Python: def clone(self) -> Self: ...
      const selfType: PythonType = {
        kind: 'custom',
        name: 'Self',
      };

      const result = mapper.mapPythonType(selfType) as TSCustomType;

      expect(result.kind).toBe('custom');
      expect(result.name).toBe('Self');
    });

    test('handles Self in generic contexts', () => {
      // Python: List[Self]
      const selfInGeneric: PythonType = {
        kind: 'collection',
        name: 'list',
        itemTypes: [
          {
            kind: 'custom',
            name: 'Self',
          },
        ],
      };

      const result = mapper.mapPythonType(selfInGeneric) as TSArrayType;

      expect(result.kind).toBe('array');
      expect(result.elementType).toEqual({
        kind: 'custom',
        name: 'Self',
      });
    });

    test('handles Self in method return types', () => {
      // Python: Callable[[Self, int], Self]
      const selfCallable: PythonType = {
        kind: 'callable',
        parameters: [
          { kind: 'custom', name: 'Self' },
          { kind: 'primitive', name: 'int' },
        ],
        returnType: { kind: 'custom', name: 'Self' },
      };

      const result = mapper.mapPythonType(selfCallable);

      expect(result.kind).toBe('function');
      const funcType = result as any;
      expect(funcType.parameters[0].type).toEqual({
        kind: 'custom',
        name: 'Self',
      });
      expect(funcType.returnType).toEqual({
        kind: 'custom',
        name: 'Self',
      });
    });
  });

  describe('Recursive Types', () => {
    test('handles simple recursive type definition', () => {
      // Python: JSON = Union[str, int, List['JSON'], Dict[str, 'JSON']]
      const recursiveJson: PythonType = {
        kind: 'union',
        types: [
          { kind: 'primitive', name: 'str' },
          { kind: 'primitive', name: 'int' },
          {
            kind: 'collection',
            name: 'list',
            itemTypes: [{ kind: 'custom', name: 'JSON' }],
          },
          {
            kind: 'collection',
            name: 'dict',
            itemTypes: [
              { kind: 'primitive', name: 'str' },
              { kind: 'custom', name: 'JSON' },
            ],
          },
        ],
      };

      const result = mapper.mapPythonType(recursiveJson) as TSUnionType;

      expect(result.kind).toBe('union');
      expect(result.types).toHaveLength(4);

      // Check string type
      expect(result.types[0]).toEqual({ kind: 'primitive', name: 'string' });

      // Check number type
      expect(result.types[1]).toEqual({ kind: 'primitive', name: 'number' });

      // Check List[JSON] -> Array<JSON>
      const arrayType = result.types[2] as TSArrayType;
      expect(arrayType.kind).toBe('array');
      expect(arrayType.elementType).toEqual({ kind: 'custom', name: 'JSON' });

      // Check Dict[str, JSON] -> { [key: string]: JSON }
      const objectType = result.types[3] as TSObjectType;
      expect(objectType.kind).toBe('object');
      expect(objectType.indexSignature?.valueType).toEqual({
        kind: 'custom',
        name: 'JSON',
      });
    });

    test('handles binary tree recursive type', () => {
      // Python:
      // class TreeNode:
      //     value: int
      //     left: Optional['TreeNode']
      //     right: Optional['TreeNode']

      const optionalTreeNode: PythonType = {
        kind: 'optional',
        type: { kind: 'custom', name: 'TreeNode' },
      };

      const result = mapper.mapPythonType(optionalTreeNode) as TSUnionType;

      expect(result.kind).toBe('union');
      expect(result.types).toEqual([
        { kind: 'custom', name: 'TreeNode' },
        { kind: 'primitive', name: 'null' },
      ]);
    });

    test('handles mutually recursive types', () => {
      // Python:
      // Node = Union['Branch', 'Leaf']
      // Branch = Dict[str, 'Node']

      const nodeType: PythonType = {
        kind: 'union',
        types: [
          { kind: 'custom', name: 'Branch' },
          { kind: 'custom', name: 'Leaf' },
        ],
      };

      const branchType: PythonType = {
        kind: 'collection',
        name: 'dict',
        itemTypes: [
          { kind: 'primitive', name: 'str' },
          { kind: 'custom', name: 'Node' },
        ],
      };

      const nodeResult = mapper.mapPythonType(nodeType) as TSUnionType;
      const branchResult = mapper.mapPythonType(branchType) as TSObjectType;

      expect(nodeResult.kind).toBe('union');
      expect(nodeResult.types).toEqual([
        { kind: 'custom', name: 'Branch' },
        { kind: 'custom', name: 'Leaf' },
      ]);

      expect(branchResult.kind).toBe('object');
      expect(branchResult.indexSignature?.valueType).toEqual({
        kind: 'custom',
        name: 'Node',
      });
    });
  });

  describe('Complex Generic Types', () => {
    test('handles TypeVar with bounds', () => {
      // Python: T = TypeVar('T', bound=BaseClass)
      const boundedTypeVar: PythonType = {
        kind: 'custom',
        name: 'T',
        module: 'typing',
      };

      const result = mapper.mapPythonType(boundedTypeVar) as TSCustomType;

      expect(result.kind).toBe('custom');
      expect(result.name).toBe('T');
      expect(result.module).toBe('typing');
    });

    test('handles TypeVar with constraints', () => {
      // Python: T = TypeVar('T', str, int, float)
      const constrainedTypeVar: PythonType = {
        kind: 'custom',
        name: 'T',
        module: 'typing',
      };

      const result = mapper.mapPythonType(constrainedTypeVar) as TSCustomType;

      expect(result.kind).toBe('custom');
      expect(result.name).toBe('T');
    });

    test('handles ParamSpec types', () => {
      // Python: P = ParamSpec('P')
      const paramSpecType: PythonType = {
        kind: 'custom',
        name: 'P',
        module: 'typing',
      };

      const result = mapper.mapPythonType(paramSpecType) as TSCustomType;

      expect(result.kind).toBe('custom');
      expect(result.name).toBe('P');
    });

    test('handles TypeVarTuple', () => {
      // Python: Ts = TypeVarTuple('Ts')
      const typeVarTuple: PythonType = {
        kind: 'custom',
        name: 'Ts',
        module: 'typing',
      };

      const result = mapper.mapPythonType(typeVarTuple) as TSCustomType;

      expect(result.kind).toBe('custom');
      expect(result.name).toBe('Ts');
    });

    test('handles Unpack in generic context', () => {
      // Python: Tuple[Unpack[Ts]]
      const unpackInTuple: PythonType = {
        kind: 'collection',
        name: 'tuple',
        itemTypes: [
          {
            kind: 'custom',
            name: 'Unpack[Ts]',
          },
        ],
      };

      const result = mapper.mapPythonType(unpackInTuple);

      expect(result.kind).toBe('tuple');
      const tupleResult = result as any;
      expect(tupleResult.elementTypes[0]).toEqual({
        kind: 'custom',
        name: 'Unpack[Ts]',
      });
    });
  });

  describe('Advanced Union Types', () => {
    test('handles literal string unions', () => {
      // Python: Literal['red', 'green', 'blue']
      const literalUnion: PythonType = {
        kind: 'union',
        types: [
          { kind: 'literal', value: 'red' },
          { kind: 'literal', value: 'green' },
          { kind: 'literal', value: 'blue' },
        ],
      };

      const result = mapper.mapPythonType(literalUnion) as TSUnionType;

      expect(result.kind).toBe('union');
      expect(result.types).toEqual([
        { kind: 'literal', value: 'red' },
        { kind: 'literal', value: 'green' },
        { kind: 'literal', value: 'blue' },
      ]);
    });

    test('handles mixed literal and type unions', () => {
      // Python: Union[Literal[1, 2, 3], str, None]
      const mixedUnion: PythonType = {
        kind: 'union',
        types: [
          { kind: 'literal', value: 1 },
          { kind: 'literal', value: 2 },
          { kind: 'literal', value: 3 },
          { kind: 'primitive', name: 'str' },
          { kind: 'primitive', name: 'None' },
        ],
      };

      const result = mapper.mapPythonType(mixedUnion) as TSUnionType;

      expect(result.kind).toBe('union');
      expect(result.types).toEqual([
        { kind: 'literal', value: 1 },
        { kind: 'literal', value: 2 },
        { kind: 'literal', value: 3 },
        { kind: 'primitive', name: 'string' },
        { kind: 'primitive', name: 'null' },
      ]);
    });

    test('handles nested union types', () => {
      // Python: Union[Union[int, str], Union[bool, None]]
      const nestedUnion: PythonType = {
        kind: 'union',
        types: [
          {
            kind: 'union',
            types: [
              { kind: 'primitive', name: 'int' },
              { kind: 'primitive', name: 'str' },
            ],
          },
          {
            kind: 'union',
            types: [
              { kind: 'primitive', name: 'bool' },
              { kind: 'primitive', name: 'None' },
            ],
          },
        ],
      };

      const result = mapper.mapPythonType(nestedUnion) as TSUnionType;

      expect(result.kind).toBe('union');
      expect(result.types).toHaveLength(2);

      const firstUnion = result.types[0] as TSUnionType;
      expect(firstUnion.kind).toBe('union');
      expect(firstUnion.types).toEqual([
        { kind: 'primitive', name: 'number' },
        { kind: 'primitive', name: 'string' },
      ]);

      const secondUnion = result.types[1] as TSUnionType;
      expect(secondUnion.kind).toBe('union');
      expect(secondUnion.types).toEqual([
        { kind: 'primitive', name: 'boolean' },
        { kind: 'primitive', name: 'null' },
      ]);
    });
  });

  describe('Protocol and Structural Typing', () => {
    test('handles Protocol types as custom types', () => {
      // Python: class MyProtocol(Protocol): ...
      const protocolType: PythonType = {
        kind: 'custom',
        name: 'MyProtocol',
        module: 'my_module',
      };

      const result = mapper.mapPythonType(protocolType) as TSCustomType;

      expect(result.kind).toBe('custom');
      expect(result.name).toBe('MyProtocol');
      expect(result.module).toBe('my_module');
    });

    test('handles generic protocol types', () => {
      // Python: class Comparable(Protocol[T]): ...
      const genericProtocol: PythonType = {
        kind: 'generic',
        name: 'Comparable',
        typeArgs: [{ kind: 'custom', name: 'T' }],
      };

      const result = mapper.mapPythonType(genericProtocol) as TSGenericType;

      expect(result.kind).toBe('generic');
      expect(result.name).toBe('Comparable');
      expect(result.typeArgs).toEqual([{ kind: 'custom', name: 'T' }]);
    });
  });

  describe('Advanced Callable Types', () => {
    test('handles Callable with ParamSpec', () => {
      // Python: Callable[P, T] where P = ParamSpec('P')
      const paramSpecCallable: PythonType = {
        kind: 'callable',
        parameters: [{ kind: 'custom', name: 'P' }],
        returnType: { kind: 'custom', name: 'T' },
      };

      const result = mapper.mapPythonType(paramSpecCallable);

      expect(result.kind).toBe('function');
      const funcResult = result as any;
      expect(funcResult.parameters[0].type).toEqual({
        kind: 'custom',
        name: 'P',
      });
      expect(funcResult.returnType).toEqual({
        kind: 'custom',
        name: 'T',
      });
    });

    test('handles Concatenate in Callable', () => {
      // Python: Callable[Concatenate[int, P], str]
      const concatenateCallable: PythonType = {
        kind: 'callable',
        parameters: [
          { kind: 'primitive', name: 'int' },
          { kind: 'custom', name: 'P' },
        ],
        returnType: { kind: 'primitive', name: 'str' },
      };

      const result = mapper.mapPythonType(concatenateCallable);

      expect(result.kind).toBe('function');
      const funcResult = result as any;
      expect(funcResult.parameters).toHaveLength(2);
      expect(funcResult.parameters[0].type).toEqual({
        kind: 'primitive',
        name: 'number',
      });
      expect(funcResult.returnType).toEqual({
        kind: 'primitive',
        name: 'string',
      });
    });
  });

  describe('Type Alias Edge Cases', () => {
    test('handles complex type alias definitions', () => {
      // Python: JSONValue = Union[None, bool, int, float, str, List['JSONValue'], Dict[str, 'JSONValue']]
      const complexAlias: PythonType = {
        kind: 'union',
        types: [
          { kind: 'primitive', name: 'None' },
          { kind: 'primitive', name: 'bool' },
          { kind: 'primitive', name: 'int' },
          { kind: 'primitive', name: 'float' },
          { kind: 'primitive', name: 'str' },
          {
            kind: 'collection',
            name: 'list',
            itemTypes: [{ kind: 'custom', name: 'JSONValue' }],
          },
          {
            kind: 'collection',
            name: 'dict',
            itemTypes: [
              { kind: 'primitive', name: 'str' },
              { kind: 'custom', name: 'JSONValue' },
            ],
          },
        ],
      };

      const result = mapper.mapPythonType(complexAlias) as TSUnionType;

      expect(result.kind).toBe('union');
      expect(result.types).toHaveLength(7);

      // Verify each type is correctly mapped
      expect(result.types[0]).toEqual({ kind: 'primitive', name: 'null' });
      expect(result.types[1]).toEqual({ kind: 'primitive', name: 'boolean' });
      expect(result.types[2]).toEqual({ kind: 'primitive', name: 'number' });
      expect(result.types[3]).toEqual({ kind: 'primitive', name: 'number' });
      expect(result.types[4]).toEqual({ kind: 'primitive', name: 'string' });

      const arrayType = result.types[5] as TSArrayType;
      expect(arrayType.kind).toBe('array');
      expect(arrayType.elementType).toEqual({ kind: 'custom', name: 'JSONValue' });

      const objectType = result.types[6] as TSObjectType;
      expect(objectType.kind).toBe('object');
      expect(objectType.indexSignature?.valueType).toEqual({ kind: 'custom', name: 'JSONValue' });
    });
  });

  describe('Error Handling and Resilience', () => {
    test('handles malformed type gracefully', () => {
      const malformedType: PythonType = {
        kind: 'collection',
        name: 'unknown' as any,
        itemTypes: [{ kind: 'primitive', name: 'invalid' as any }],
      };

      // Should not throw, but return a sensible fallback
      expect(() => {
        const result = mapper.mapPythonType(malformedType);
        expect(result.kind).toBe('object');
      }).not.toThrow();
    });

    test('handles deeply nested structures without stack overflow', () => {
      // Create a 20-level deep nested list
      let deepType: PythonType = { kind: 'primitive', name: 'int' };
      for (let i = 0; i < 20; i++) {
        deepType = {
          kind: 'collection',
          name: 'list',
          itemTypes: [deepType],
        };
      }

      expect(() => {
        const result = mapper.mapPythonType(deepType);
        expect(result.kind).toBe('array');
      }).not.toThrow();
    });

    test('handles circular references in type definitions', () => {
      // This simulates what would happen if we had actual circular references
      const circularType: PythonType = {
        kind: 'custom',
        name: 'CircularRef',
        module: 'test',
      };

      // Should handle this gracefully
      const result = mapper.mapPythonType(circularType) as TSCustomType;

      expect(result.kind).toBe('custom');
      expect(result.name).toBe('CircularRef');
    });
  });
});
