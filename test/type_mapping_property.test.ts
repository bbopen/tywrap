import { describe, test } from 'vitest';
import * as fc from 'fast-check';
import { TypeMapper } from '../src/core/mapper.js';
import type { PythonType, TypescriptType } from '../src/types/index.js';

describe('TypeMapper - Property-Based Tests', () => {
  const mapper = new TypeMapper();

  // Arbitraries for generating Python types
  const primitiveTypeArb = fc.constantFrom('int', 'float', 'str', 'bool', 'bytes', 'None');

  const pythonPrimitiveArb: fc.Arbitrary<PythonType> = primitiveTypeArb.map(name => ({
    kind: 'primitive' as const,
    name: name as any,
  }));

  const pythonLiteralArb: fc.Arbitrary<PythonType> = fc.oneof(
    fc.string().map(value => ({ kind: 'literal' as const, value })),
    fc.integer().map(value => ({ kind: 'literal' as const, value })),
    fc.boolean().map(value => ({ kind: 'literal' as const, value })),
    fc.constant({ kind: 'literal' as const, value: null })
  );

  const pythonCustomArb: fc.Arbitrary<PythonType> = fc.record({
    kind: fc.constant('custom' as const),
    name: fc.oneof(
      fc.string({ minLength: 1 }),
      fc.constantFrom('Any', 'Never', 'LiteralString', 'Callable')
    ),
    module: fc.option(fc.string(), { nil: undefined }),
  });

  // Generate small Python types to avoid infinite recursion
  const pythonTypeArb: fc.Arbitrary<PythonType> = fc.letrec(tie => ({
    base: fc.oneof(pythonPrimitiveArb, pythonLiteralArb, pythonCustomArb),
    collection: fc.record({
      kind: fc.constant('collection' as const),
      name: fc.constantFrom('list', 'dict', 'tuple', 'set', 'frozenset'),
      itemTypes: fc.array(tie('base'), { maxLength: 3 }),
    }),
    union: fc.record({
      kind: fc.constant('union' as const),
      types: fc.array(tie('base'), { minLength: 1, maxLength: 3 }),
    }),
    optional: fc.record({
      kind: fc.constant('optional' as const),
      type: tie('base'),
    }),
    generic: fc.record({
      kind: fc.constant('generic' as const),
      name: fc.string({ minLength: 1 }),
      typeArgs: fc.array(tie('base'), { maxLength: 2 }),
    }),
    callable: fc.record({
      kind: fc.constant('callable' as const),
      parameters: fc.array(tie('base'), { maxLength: 3 }),
      returnType: tie('base'),
    }),
    annotated: fc.record({
      kind: fc.constant('annotated' as const),
      base: tie('base'),
      metadata: fc.array(fc.anything(), { maxLength: 2 }),
    }),
  })).base;

  test('all Python types map to valid TypeScript types', () => {
    fc.assert(
      fc.property(pythonTypeArb, pythonType => {
        const result = mapper.mapPythonType(pythonType);

        // Every result should have a valid kind
        const validKinds = [
          'primitive',
          'array',
          'tuple',
          'object',
          'union',
          'function',
          'generic',
          'literal',
          'custom',
        ];
        return validKinds.includes(result.kind);
      }),
      { numRuns: 1000, seed: 42 }
    );
  });

  test('primitive types always map to primitive TypeScript types', () => {
    fc.assert(
      fc.property(pythonPrimitiveArb, pythonType => {
        const result = mapper.mapPythonType(pythonType);
        return result.kind === 'primitive';
      }),
      { numRuns: 100, seed: 42 }
    );
  });

  test('literal types always map to literal TypeScript types', () => {
    fc.assert(
      fc.property(pythonLiteralArb, pythonType => {
        const result = mapper.mapPythonType(pythonType);
        return result.kind === 'literal';
      }),
      { numRuns: 100, seed: 42 }
    );
  });

  test('mapping is deterministic (same input produces same output)', () => {
    fc.assert(
      fc.property(pythonTypeArb, pythonType => {
        const result1 = mapper.mapPythonType(pythonType);
        const result2 = mapper.mapPythonType(pythonType);

        // Deep equality check
        return JSON.stringify(result1) === JSON.stringify(result2);
      }),
      { numRuns: 500, seed: 42 }
    );
  });

  test('context affects None mapping consistently', () => {
    const noneType: PythonType = { kind: 'primitive', name: 'None' };

    fc.assert(
      fc.property(fc.constantFrom('value' as const, 'return' as const), context => {
        const result = mapper.mapPythonType(noneType, context);

        if (context === 'return') {
          return result.kind === 'primitive' && (result as any).name === 'void';
        } else {
          return result.kind === 'primitive' && (result as any).name === 'null';
        }
      }),
      { numRuns: 50, seed: 42 }
    );
  });

  test('union types preserve all member types', () => {
    fc.assert(
      fc.property(fc.array(pythonPrimitiveArb, { minLength: 2, maxLength: 5 }), types => {
        const unionType: PythonType = {
          kind: 'union',
          types: types,
        };

        const result = mapper.mapPythonType(unionType);

        return result.kind === 'union' && (result as any).types.length === types.length;
      }),
      { numRuns: 100, seed: 42 }
    );
  });

  test('collection types maintain structural integrity', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('list' as const, 'tuple' as const, 'set' as const, 'frozenset' as const),
        fc.array(pythonPrimitiveArb, { maxLength: 3 }),
        (collectionName, itemTypes) => {
          const collectionType: PythonType = {
            kind: 'collection',
            name: collectionName,
            itemTypes: itemTypes,
          };

          const result = mapper.mapPythonType(collectionType);

          // Verify expected mappings
          switch (collectionName) {
            case 'list':
              return result.kind === 'array';
            case 'tuple':
              return (
                result.kind === 'tuple' &&
                (result as any).elementTypes.length ===
                  (itemTypes.length > 0 ? itemTypes.length : 1)
              );
            case 'set':
            case 'frozenset':
              return result.kind === 'generic' && (result as any).name === 'Set';
            default:
              return false;
          }
        }
      ),
      { numRuns: 200, seed: 42 }
    );
  });

  test('dict types always produce object types with index signatures', () => {
    fc.assert(
      fc.property(pythonPrimitiveArb, pythonPrimitiveArb, (keyType, valueType) => {
        const dictType: PythonType = {
          kind: 'collection',
          name: 'dict',
          itemTypes: [keyType, valueType],
        };

        const result = mapper.mapPythonType(dictType);

        return result.kind === 'object' && (result as any).indexSignature !== undefined;
      }),
      { numRuns: 100, seed: 42 }
    );
  });

  test('callable types always produce function types', () => {
    fc.assert(
      fc.property(
        fc.array(pythonPrimitiveArb, { maxLength: 3 }),
        pythonPrimitiveArb,
        (parameters, returnType) => {
          const callableType: PythonType = {
            kind: 'callable',
            parameters: parameters,
            returnType: returnType,
          };

          const result = mapper.mapPythonType(callableType);

          return (
            result.kind === 'function' &&
            (result as any).parameters.length === parameters.length &&
            (result as any).returnType !== undefined
          );
        }
      ),
      { numRuns: 100, seed: 42 }
    );
  });

  test('nested types maintain depth correctly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 3 }), depth => {
        // Create a nested list type list[list[...list[int]...]]
        let nestedType: PythonType = { kind: 'primitive', name: 'int' };

        for (let i = 0; i < depth; i++) {
          nestedType = {
            kind: 'collection',
            name: 'list',
            itemTypes: [nestedType],
          };
        }

        const result = mapper.mapPythonType(nestedType);

        // Verify we have the expected nesting depth
        let currentType: TypescriptType = result;
        let actualDepth = 0;

        while (currentType.kind === 'array') {
          actualDepth++;
          currentType = (currentType as any).elementType;
        }

        return (
          actualDepth === depth &&
          currentType.kind === 'primitive' &&
          (currentType as any).name === 'number'
        );
      }),
      { numRuns: 50, seed: 42 }
    );
  });

  test('annotated types always unwrap to base type', () => {
    fc.assert(
      fc.property(
        pythonPrimitiveArb,
        fc.array(fc.anything(), { maxLength: 3 }),
        (baseType, metadata) => {
          const annotatedType: PythonType = {
            kind: 'annotated',
            base: baseType,
            metadata: metadata,
          };

          const result = mapper.mapPythonType(annotatedType);
          const expectedResult = mapper.mapPythonType(baseType);

          return JSON.stringify(result) === JSON.stringify(expectedResult);
        }
      ),
      { numRuns: 100, seed: 42 }
    );
  });

  test('type safety invariants are maintained', () => {
    fc.assert(
      fc.property(pythonTypeArb, pythonType => {
        const result = mapper.mapPythonType(pythonType);

        // Type-specific invariants
        switch (result.kind) {
          case 'primitive':
            const primitiveNames = [
              'string',
              'number',
              'boolean',
              'null',
              'undefined',
              'void',
              'unknown',
              'never',
            ];
            return primitiveNames.includes((result as any).name);

          case 'array':
            return (result as any).elementType !== undefined;

          case 'tuple':
            return (
              Array.isArray((result as any).elementTypes) && (result as any).elementTypes.length > 0
            );

          case 'object':
            return Array.isArray((result as any).properties);

          case 'union':
            return Array.isArray((result as any).types);

          case 'function':
            return (
              Array.isArray((result as any).parameters) &&
              (result as any).returnType !== undefined &&
              typeof (result as any).isAsync === 'boolean'
            );

          case 'generic':
            return (
              typeof (result as any).name === 'string' && Array.isArray((result as any).typeArgs)
            );

          case 'literal':
            const value = (result as any).value;
            return (
              typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean' ||
              value === null
            );

          case 'custom':
            return typeof (result as any).name === 'string';

          default:
            return false;
        }
      }),
      { numRuns: 1000, seed: 42 }
    );
  });

  test('no information is lost in simple type mappings', () => {
    const simpleTypes: PythonType[] = [
      { kind: 'primitive', name: 'str' },
      { kind: 'primitive', name: 'int' },
      { kind: 'primitive', name: 'bool' },
      { kind: 'literal', value: 'hello' },
      { kind: 'literal', value: 42 },
      { kind: 'literal', value: true },
    ];

    fc.assert(
      fc.property(fc.constantFrom(...simpleTypes), pythonType => {
        const result = mapper.mapPythonType(pythonType);

        // Verify that essential information is preserved
        if (pythonType.kind === 'literal') {
          return result.kind === 'literal' && (result as any).value === (pythonType as any).value;
        }

        if (pythonType.kind === 'primitive') {
          return result.kind === 'primitive';
        }

        return true;
      }),
      { numRuns: 50, seed: 42 }
    );
  });
});
