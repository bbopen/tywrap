import { describe, expect, it } from 'vitest';
import { DecodedProvenance } from '../src/runtime/decoded-provenance.js';

describe('decoded provenance', () => {
  it('keeps equal scalar values separate by call and nested location', () => {
    const firstParent = { one: 1.5, two: 1.5 };
    const secondParent = { one: 1.5 };
    const first = new DecodedProvenance();
    const second = new DecodedProvenance();

    first.recordChild(firstParent, 'one', { marker: 'ndarray', dims: 0, dtype: 'float16' });
    first.recordChild(firstParent, 'two', { marker: 'ndarray', dims: 0, dtype: 'float32' });
    second.recordChild(secondParent, 'one', { marker: 'ndarray', dims: 0, dtype: 'float64' });

    expect(first.atChild(firstParent, 'one')?.dtype).toBe('float16');
    expect(first.atChild(firstParent, 'two')?.dtype).toBe('float32');
    expect(first.atChild(secondParent, 'one')).toBeUndefined();
    expect(second.atChild(firstParent, 'one')).toBeUndefined();
    expect(second.atChild(secondParent, 'one')?.dtype).toBe('float64');
  });

  it('uses the same array slot for a numeric or string index', () => {
    const parent = [1.5];
    const provenance = new DecodedProvenance();
    const metadata = { marker: 'ndarray' as const, dims: 0, dtype: 'float16' };
    provenance.recordChild(parent, 0, metadata);
    expect(provenance.atChild(parent, '0')).toEqual(metadata);
    expect(() => provenance.recordChild(parent, '0', metadata)).toThrow(/Duplicate child/);
  });

  it('has one root slot and a bounded number of entries', () => {
    const evidence = { marker: 'ndarray' as const, dims: 0, dtype: 'float16' };
    const provenance = new DecodedProvenance(2);
    const parent = [1.5];
    provenance.recordRoot(evidence);
    provenance.recordChild(parent, 0, evidence);

    expect(provenance.atRoot()).toEqual(evidence);
    expect(provenance.atChild(parent, 0)).toEqual(evidence);
    expect(() => provenance.recordRoot(evidence)).toThrow(/Duplicate root/);
    expect(() => provenance.recordChild(parent, 0, evidence)).toThrow(/Duplicate child/);
    expect(() => provenance.recordChild(parent, 1, evidence)).toThrow(/exceeds 2 entries/);
  });
});
