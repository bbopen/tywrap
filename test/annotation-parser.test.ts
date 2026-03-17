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

  it('parses Literal strings containing spaced pipes', () => {
    const t = parseAnnotationToPythonType('Literal["a | b"]');
    expect(t.kind).toBe('literal');
    expect((t as any).value).toBe('a | b');
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

  it('parses Callable[..., R] as an ellipsis callable', () => {
    const t = parseAnnotationToPythonType('Callable[..., int]');
    expect(t.kind).toBe('callable');
    expect((t as any).parameters).toHaveLength(1);
    expect((t as any).parameters[0].kind).toBe('custom');
    expect((t as any).parameters[0].name).toBe('...');
  });

  it('parses Sequence[T] as a list-like collection', () => {
    const t = parseAnnotationToPythonType('Sequence[bool]');
    expect(t.kind).toBe('collection');
    expect((t as any).name).toBe('list');
    expect((t as any).itemTypes[0].name).toBe('bool');
  });

  it('parses collections.abc aliases used by advanced fixtures', () => {
    const sequence = parseAnnotationToPythonType('collections.abc.Sequence[str]');
    expect(sequence.kind).toBe('collection');
    expect((sequence as any).name).toBe('list');
    expect((sequence as any).itemTypes[0].name).toBe('str');

    const mapping = parseAnnotationToPythonType('collections.abc.Mapping[str, int]');
    expect(mapping.kind).toBe('collection');
    expect((mapping as any).name).toBe('dict');
    expect((mapping as any).itemTypes).toHaveLength(2);

    const iterator = parseAnnotationToPythonType('collections.abc.AsyncIterator[bytes]');
    expect(iterator.kind).toBe('generic');
    expect((iterator as any).name).toBe('AsyncIterator');
    expect((iterator as any).typeArgs[0].name).toBe('bytes');
  });

  it('parses TypeVar-like helpers into safe wrapper-friendly shapes', () => {
    const typeVar = parseAnnotationToPythonType("TypeVar('T')");
    expect(typeVar.kind).toBe('typevar');
    expect((typeVar as any).name).toBe('T');

    const paramSpec = parseAnnotationToPythonType("ParamSpec('P')");
    expect(paramSpec.kind).toBe('custom');
    expect((paramSpec as any).name).toBe('P');

    const inferredTypeVar = parseAnnotationToPythonType('~T');
    expect(inferredTypeVar.kind).toBe('typevar');
    expect((inferredTypeVar as any).name).toBe('T');

    const callable = parseAnnotationToPythonType('typing.Callable[~P, ~T]');
    expect(callable.kind).toBe('callable');
    expect((callable as any).parameters).toHaveLength(1);
    expect((callable as any).parameters[0].name).toBe('...');
    expect((callable as any).returnType.kind).toBe('typevar');

    const args = parseAnnotationToPythonType('P.args');
    expect(args.kind).toBe('collection');
    expect((args as any).name).toBe('list');

    const kwargs = parseAnnotationToPythonType('P.kwargs');
    expect(kwargs.kind).toBe('collection');
    expect((kwargs as any).name).toBe('dict');

    const unpack = parseAnnotationToPythonType('Unpack[Ts]');
    expect(unpack.kind).toBe('custom');
    expect((unpack as any).name).toBe('Any');
    expect((unpack as any).module).toBe('typing');
  });

  it('treats bare module-scoped typevar names as safe placeholders when provided', () => {
    const bareTypeVar = parseAnnotationToPythonType('T', {
      knownTypeVarNames: ['T', 'P'],
    });
    expect(bareTypeVar.kind).toBe('typevar');
    expect((bareTypeVar as any).name).toBe('T');

    const bareParamSpec = parseAnnotationToPythonType('P', {
      knownTypeVarNames: ['T', 'P'],
    });
    expect(bareParamSpec.kind).toBe('typevar');
    expect((bareParamSpec as any).name).toBe('P');
  });
});
