import { describe, it, expect } from 'vitest';
import { TypeMapper } from '../src/core/mapper.js';

describe('TypeMapper', () => {
  const mapper = new TypeMapper();

  it('maps primitives', () => {
    expect(mapper.mapPythonType({ kind: 'primitive', name: 'int' })).toEqual({
      kind: 'primitive',
      name: 'number',
    });
    expect(mapper.mapPythonType({ kind: 'primitive', name: 'str' })).toEqual({
      kind: 'primitive',
      name: 'string',
    });
    expect(mapper.mapPythonType({ kind: 'primitive', name: 'bool' })).toEqual({
      kind: 'primitive',
      name: 'boolean',
    });
  });

  it('maps lists and dicts', () => {
    const listT = mapper.mapPythonType({
      kind: 'collection',
      name: 'list',
      itemTypes: [{ kind: 'primitive', name: 'int' }],
    });
    expect(listT.kind).toBe('array');

    const dictT = mapper.mapPythonType({
      kind: 'collection',
      name: 'dict',
      itemTypes: [
        { kind: 'primitive', name: 'str' },
        { kind: 'primitive', name: 'int' },
      ],
    });
    expect(dictT.kind).toBe('object');
  });

  it('maps union and optional', () => {
    const unionT = mapper.mapPythonType({
      kind: 'union',
      types: [
        { kind: 'primitive', name: 'int' },
        { kind: 'primitive', name: 'str' },
      ],
    });
    expect(unionT.kind).toBe('union');

    const optT = mapper.mapPythonType({
      kind: 'optional',
      type: { kind: 'primitive', name: 'int' },
    });
    expect(optT.kind).toBe('union');
  });

  it('maps callable and literal', () => {
    const callable = mapper.mapPythonType({
      kind: 'callable',
      parameters: [{ kind: 'primitive', name: 'int' }],
      returnType: { kind: 'primitive', name: 'str' },
    } as any);
    expect(callable.kind).toBe('function');
    const lit = mapper.mapPythonType({ kind: 'literal', value: 42 } as any);
    expect(lit.kind).toBe('literal');
  });

  it('maps tuple to exact TS tuple', () => {
    const t = mapper.mapPythonType({
      kind: 'collection',
      name: 'tuple',
      itemTypes: [
        { kind: 'primitive', name: 'int' },
        { kind: 'primitive', name: 'str' },
      ],
    } as any);
    expect(t.kind).toBe('tuple');
  });

  it('maps Callable[[...], R] to rest args', () => {
    const callable = mapper.mapPythonType({
      kind: 'callable',
      parameters: [{ kind: 'custom', name: '...' }],
      returnType: { kind: 'primitive', name: 'int' },
    } as any);
    expect(callable.kind).toBe('function');
    if (callable.kind === 'function') {
      expect(callable.parameters[0]?.rest).toBe(true);
    }
  });

  it('splits nested generics via analyzer helper (sanity via mapping of parsed inputs)', () => {
    // Just ensure mapping accepts nested-like structures
    const t = mapper.mapPythonType({
      kind: 'collection',
      name: 'dict',
      itemTypes: [
        { kind: 'primitive', name: 'str' },
        {
          kind: 'union',
          types: [
            { kind: 'primitive', name: 'int' },
            { kind: 'collection', name: 'list', itemTypes: [{ kind: 'primitive', name: 'str' }] },
          ],
        },
      ],
    });
    expect(t.kind).toBe('object');
  });
});
