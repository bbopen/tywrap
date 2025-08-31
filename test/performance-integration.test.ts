import { describe, it, expect } from 'vitest';
import { BundleOptimizer } from '../src/utils/bundle-optimizer.js';

describe('BundleOptimizer AST extraction', () => {
  const optimizer = new BundleOptimizer();

  const code = `
import defaultExport, {foo as bar, type Baz, qux} from './mod1';
import * as All from "./mod2";
const dynamic = await import('./mod3');
import type { TypesOnly } from './types';
import { something } from './other'; // types

export { bar as renamed } from './mod1';
export * from './mod2';
export default function defaultFunction() {}
export class MyClass {}
const local1 = 1;
export { local1 as alias1 };
__bridge.call('something');
decodeValue();
`;

  it('extracts complex imports', () => {
    const imports = (optimizer as any).extractImports(code);
    expect(imports).toEqual(expect.arrayContaining([
      'defaultExport',
      'foo',
      'Baz',
      'qux',
      'All',
      'TypesOnly',
      'something',
      './mod1',
      './mod2',
      './mod3',
      './types',
      './other'
    ]));
  });

  it('extracts complex exports', () => {
    const exports = (optimizer as any).extractExports(code);
    expect(exports).toEqual(expect.arrayContaining([
      'defaultFunction',
      'MyClass',
      'bar',
      'local1',
      '*'
    ]));
  });

  it('extracts dependencies', () => {
    const deps = (optimizer as any).extractDependencies(code);
    expect(deps).toEqual(expect.arrayContaining([
      'runtime-bridge',
      'codec',
      './types',
      './other'
    ]));
  });
});
