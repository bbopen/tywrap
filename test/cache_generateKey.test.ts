import { describe, expect, it } from 'vitest';

import { IntelligentCache } from '../src/utils/cache.js';

describe('IntelligentCache.generateKey', () => {
  it('disambiguates primitive types to avoid collisions', () => {
    const cache = new IntelligentCache({ persistToDisk: false, cleanupInterval: 0 });

    expect(cache.generateKey('x', '1')).not.toBe(cache.generateKey('x', 1));
    expect(cache.generateKey('x', 'null')).not.toBe(cache.generateKey('x', null));
    expect(cache.generateKey('x', 'true')).not.toBe(cache.generateKey('x', true));
    expect(cache.generateKey('x', 'false')).not.toBe(cache.generateKey('x', false));
    expect(cache.generateKey('x', undefined)).not.toBe(cache.generateKey('x', null));
  });

  it('handles Symbol inputs deterministically', () => {
    const cache = new IntelligentCache({ persistToDisk: false, cleanupInterval: 0 });

    const sym = Symbol('a');
    expect(cache.generateKey('x', sym)).toBe(cache.generateKey('x', sym));
  });
});
