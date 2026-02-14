import { describe, it, expect } from 'vitest';

import { parseAnnotationToPythonType } from '../src/core/annotation-parser.js';

describe('annotation parser', () => {
  it('parses Literal strings containing commas', () => {
    const t = parseAnnotationToPythonType('Literal["a,b"]');
    expect(t.kind).toBe('literal');
    expect((t as any).value).toBe('a,b');
  });

  it('parses Literal strings containing pipes', () => {
    const t = parseAnnotationToPythonType('Literal["x|y"]');
    expect(t.kind).toBe('literal');
    expect((t as any).value).toBe('x|y');
  });

  it('parses Union containing nested Literal with commas', () => {
    const t = parseAnnotationToPythonType('Union[Literal["a,b"], str]');
    expect(t.kind).toBe('union');
    expect((t as any).types).toHaveLength(2);
    expect((t as any).types[0].kind).toBe('literal');
    expect((t as any).types[0].value).toBe('a,b');
    expect((t as any).types[1].kind).toBe('primitive');
    expect((t as any).types[1].name).toBe('str');
  });

  it('parses FrozenSet', () => {
    const t = parseAnnotationToPythonType('FrozenSet[int]');
    expect(t.kind).toBe('collection');
    expect((t as any).name).toBe('frozenset');
    expect((t as any).itemTypes).toHaveLength(1);
    expect((t as any).itemTypes[0].kind).toBe('primitive');
    expect((t as any).itemTypes[0].name).toBe('int');
  });
});
