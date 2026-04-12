import { describe, it, expect } from 'vitest';
import { CodeGenerator } from '../src/core/generator.js';

describe('CodeGenerator', () => {
  const gen = new CodeGenerator();

  it('generates function wrapper with JSDoc', () => {
    const code = gen.generateFunctionWrapper(
      {
        name: 'add',
        signature: {
          parameters: [
            {
              name: 'x',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'y',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'primitive', name: 'int' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'Add two numbers',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'int' },
        parameters: [
          {
            name: 'x',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'y',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      } as any,
      'math'
    );
    expect(code.typescript).toContain('export async function add');
    expect(code.typescript).toContain('Add two numbers');
    expect(code.typescript).toContain("getRuntimeBridge().call('math', 'add'");
  });

  it('serializes tuple types as TS tuples', () => {
    const code = gen.generateFunctionWrapper(
      {
        name: 'pair',
        signature: {
          parameters: [],
          returnType: {
            kind: 'collection',
            name: 'tuple',
            itemTypes: [
              { kind: 'primitive', name: 'int' },
              { kind: 'primitive', name: 'str' },
            ],
          },
          isAsync: false,
          isGenerator: false,
        },
        docstring: undefined,
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: {
          kind: 'collection',
          name: 'tuple',
          itemTypes: [
            { kind: 'primitive', name: 'int' },
            { kind: 'primitive', name: 'str' },
          ],
        },
        parameters: [],
      } as any,
      'math'
    );
    expect(code.typescript).toMatch(/Promise<\[number, string\]>/);
  });

  it('emits JSDoc with Annotated metadata when enabled', () => {
    const code = gen.generateFunctionWrapper(
      {
        name: 'f',
        signature: {
          parameters: [
            {
              name: 'x',
              type: {
                kind: 'annotated',
                base: { kind: 'primitive', name: 'int' },
                metadata: ['min=0'],
              },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'primitive', name: 'int' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'Doc',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'int' },
        parameters: [
          {
            name: 'x',
            type: {
              kind: 'annotated',
              base: { kind: 'primitive', name: 'int' },
              metadata: ['min=0'],
            },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      } as any,
      'm',
      true
    );
    expect(code.typescript).toContain('@param arg0');
  });

  it('generates overloads for optional parameters and maps varargs/kwargs', () => {
    const code = gen.generateFunctionWrapper(
      {
        name: 'f',
        signature: {
          parameters: [
            {
              name: 'x',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'y',
              type: { kind: 'primitive', name: 'int' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'args',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: true,
              kwArgs: false,
            },
            {
              name: 'kwargs',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: false,
              kwArgs: true,
            },
          ],
          returnType: { kind: 'primitive', name: 'int' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: undefined,
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'int' },
        parameters: [
          {
            name: 'x',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'y',
            type: { kind: 'primitive', name: 'int' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'args',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: true,
            kwArgs: false,
          },
          {
            name: 'kwargs',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: true,
          },
        ],
      } as any,
      'm'
    );
    expect(code.typescript).not.toMatch(
      /export function f\(x: number, args\?: unknown\[], kwargs\?: Record<string, unknown>\): Promise<number>;/
    );
    expect(code.typescript).toMatch(
      /export async function f\(x: number, y\?: number, args\?: unknown\[], kwargs\?: Record<string, unknown>\): Promise<number>/
    );
  });

  it('renders required keyword-only params in final kwargs object and avoids required-after-optional', () => {
    const code = gen.generateFunctionWrapper(
      {
        name: 'f',
        signature: {
          parameters: [
            {
              name: 'a',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'b',
              type: { kind: 'primitive', name: 'int' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'c',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: false,
              kwArgs: false,
              keywordOnly: true,
            },
          ],
          returnType: { kind: 'primitive', name: 'int' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: undefined,
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'int' },
        parameters: [
          {
            name: 'a',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'b',
            type: { kind: 'primitive', name: 'int' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'c',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
            keywordOnly: true,
          },
        ],
      } as any,
      'm'
    );

    // Overload allowing skipping optional positional `b` while requiring kwargs.
    expect(code.typescript).toMatch(
      /export function f\(a: number, kwargs: \{ "c": number; \}\): Promise<number>;/
    );
    // Overload where `b` is present must render it as required (no `?`) to keep the signature valid.
    expect(code.typescript).toMatch(
      /export function f\(a: number, b: number, kwargs: \{ "c": number; \}\): Promise<number>;/
    );
    // Implementation keeps kwargs optional but includes the correct object type.
    expect(code.typescript).toMatch(
      /export async function f\(a: number, b\?: number, kwargs\?: \{ "c": number; \}\): Promise<number>/
    );
  });

  it('models *args as an array parameter when kwargs are present', () => {
    const code = gen.generateFunctionWrapper(
      {
        name: 'g',
        signature: {
          parameters: [
            {
              name: 'args',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: true,
              kwArgs: false,
            },
            {
              name: 'c',
              type: { kind: 'primitive', name: 'int' },
              optional: false,
              varArgs: false,
              kwArgs: false,
              keywordOnly: true,
            },
          ],
          returnType: { kind: 'primitive', name: 'int' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: undefined,
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'int' },
        parameters: [
          {
            name: 'args',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: true,
            kwArgs: false,
          },
          {
            name: 'c',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
            keywordOnly: true,
          },
        ],
      } as any,
      'm'
    );

    // Rest parameters can't precede kwargs; this should be an array param.
    expect(code.typescript).not.toContain('...args: unknown[]');
    // When `kwargs` is required in overloads, allow `undefined` as a placeholder for omitted varargs.
    expect(code.typescript).toMatch(
      /export function g\(args: unknown\[\]\s*\|\s*undefined, kwargs: \{ "c": number; \}\): Promise<number>;/
    );
    // Also allow omitting the varargs placeholder entirely.
    expect(code.typescript).toMatch(
      /export function g\(kwargs: \{ "c": number; \}\): Promise<number>;/
    );
    expect(code.typescript).toMatch(
      /export async function g\(args\?: unknown\[], kwargs\?: \{ "c": number; \}\): Promise<number>/
    );
  });

  it('requires kwargs in class wrappers when keyword-only params are required', () => {
    const code = gen.generateClassWrapper(
      {
        name: 'C',
        bases: [],
        methods: [
          {
            name: '__init__',
            signature: {
              parameters: [],
              returnType: { kind: 'primitive', name: 'None' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: undefined,
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'None' },
            parameters: [
              {
                name: 'self',
                type: { kind: 'primitive', name: 'None' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
              {
                name: 'c',
                type: { kind: 'primitive', name: 'int' },
                optional: false,
                varArgs: false,
                kwArgs: false,
                keywordOnly: true,
              },
            ],
          },
          {
            name: 'm',
            signature: {
              parameters: [],
              returnType: { kind: 'primitive', name: 'int' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: undefined,
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'int' },
            parameters: [
              {
                name: 'self',
                type: { kind: 'primitive', name: 'None' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
              {
                name: 'k',
                type: { kind: 'primitive', name: 'int' },
                optional: false,
                varArgs: false,
                kwArgs: false,
                keywordOnly: true,
              },
            ],
          },
        ],
        properties: [],
        docstring: undefined,
        decorators: [],
      } as any,
      'm'
    );

    expect(code.typescript).toMatch(/static create\(kwargs: \{ "c": number; \}\): Promise<C>;/);

    expect(code.typescript).toMatch(/m\(kwargs: \{ "k": number; \}\): Promise<number>;/);
    expect(code.typescript).toMatch(/async m\(kwargs\?: \{ "k": number; \}\): Promise<number>/);
  });

  it('generates constructor typing from __init__ and sorts members', () => {
    const code = gen.generateClassWrapper(
      {
        name: 'C',
        bases: [],
        methods: [
          {
            name: '__init__',
            signature: {
              parameters: [
                {
                  name: 'self',
                  type: { kind: 'primitive', name: 'None' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
                {
                  name: 'x',
                  type: { kind: 'primitive', name: 'int' },
                  optional: true,
                  varArgs: false,
                  kwArgs: false,
                },
                {
                  name: 'args',
                  type: { kind: 'primitive', name: 'int' },
                  optional: false,
                  varArgs: true,
                  kwArgs: false,
                },
              ],
              returnType: { kind: 'primitive', name: 'None' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: undefined,
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'None' },
            parameters: [
              {
                name: 'self',
                type: { kind: 'primitive', name: 'None' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
              {
                name: 'x',
                type: { kind: 'primitive', name: 'int' },
                optional: true,
                varArgs: false,
                kwArgs: false,
              },
              {
                name: 'args',
                type: { kind: 'primitive', name: 'int' },
                optional: false,
                varArgs: true,
                kwArgs: false,
              },
            ],
          },
          {
            name: 'b',
            signature: {
              parameters: [
                {
                  name: 'self',
                  type: { kind: 'primitive', name: 'None' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
              returnType: { kind: 'primitive', name: 'int' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: undefined,
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'int' },
            parameters: [
              {
                name: 'self',
                type: { kind: 'primitive', name: 'None' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
            ],
          },
          {
            name: 'a',
            signature: {
              parameters: [
                {
                  name: 'self',
                  type: { kind: 'primitive', name: 'None' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
              returnType: { kind: 'primitive', name: 'int' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: undefined,
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'int' },
            parameters: [
              {
                name: 'self',
                type: { kind: 'primitive', name: 'None' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
            ],
          },
        ],
        properties: [],
        docstring: undefined,
        decorators: [],
      } as any,
      'm'
    );
    expect(code.typescript).toContain('static async create(x?: number, ...args: unknown[])');
    const idxA = code.typescript.indexOf('async a(');
    const idxB = code.typescript.indexOf('async b(');
    expect(idxA).toBeGreaterThan(0);
    expect(idxB).toBeGreaterThan(idxA);
  });

  it('emits TypedDict as a TS object type alias with required/optional keys', () => {
    const code = gen.generateClassWrapper(
      {
        name: 'User',
        bases: [],
        methods: [],
        properties: [
          {
            name: 'id',
            type: { kind: 'primitive', name: 'int' },
            readonly: false,
            getter: true,
            setter: false,
          } as any,
          {
            name: 'name',
            type: { kind: 'primitive', name: 'str' },
            readonly: false,
            getter: true,
            setter: false,
            optional: true,
          } as any,
        ],
        docstring: undefined,
        decorators: ['__typed_dict__'],
      } as any,
      'm'
    );
    expect(code.typescript).toContain('export type User =');
    expect(code.typescript).toContain('id: number;');
    expect(code.typescript).toContain('name?: string;');
  });

  it('emits generic function type parameters on overloads and declarations', () => {
    const code = gen.generateFunctionWrapper(
      {
        name: 'coalesce',
        signature: {
          parameters: [
            {
              name: 'x',
              type: { kind: 'typevar', name: 'T' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'y',
              type: { kind: 'typevar', name: 'T' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'typevar', name: 'T' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: undefined,
        decorators: [],
        isAsync: false,
        isGenerator: false,
        typeParameters: [{ name: 'T', kind: 'typevar', variance: 'invariant' }],
        returnType: { kind: 'typevar', name: 'T' },
        parameters: [
          {
            name: 'x',
            type: { kind: 'typevar', name: 'T' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'y',
            type: { kind: 'typevar', name: 'T' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
        ],
      } as any,
      'generic_module'
    );

    expect(code.typescript).toContain('export function coalesce<T>(x: T): Promise<T>;');
    expect(code.typescript).toContain('export async function coalesce<T>(x: T, y?: T): Promise<T>');
    expect(code.declaration).toContain('export function coalesce<T>(x: T): Promise<T>;');
  });

  it('generates protocol aliases without init helpers and preserves method generics', () => {
    const code = gen.generateClassWrapper(
      {
        name: 'Mapper',
        bases: ['Protocol'],
        methods: [
          {
            name: '__init__',
            signature: {
              parameters: [
                {
                  name: 'self',
                  type: { kind: 'primitive', name: 'None' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
              returnType: { kind: 'primitive', name: 'None' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: undefined,
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'None' },
            parameters: [
              {
                name: 'self',
                type: { kind: 'primitive', name: 'None' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
            ],
          },
          {
            name: 'map',
            signature: {
              parameters: [
                {
                  name: 'self',
                  type: { kind: 'primitive', name: 'None' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
                {
                  name: 'x',
                  type: { kind: 'typevar', name: 'U' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
              returnType: { kind: 'typevar', name: 'U' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: undefined,
            decorators: [],
            isAsync: false,
            isGenerator: false,
            typeParameters: [{ name: 'U', kind: 'typevar', variance: 'invariant' }],
            returnType: { kind: 'typevar', name: 'U' },
            parameters: [
              {
                name: 'self',
                type: { kind: 'primitive', name: 'None' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
              {
                name: 'x',
                type: { kind: 'typevar', name: 'U' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
            ],
          },
        ],
        properties: [],
        docstring: undefined,
        decorators: [],
        kind: 'protocol',
      } as any,
      'protocol_module'
    );

    expect(code.typescript).toContain('export type Mapper =');
    expect(code.typescript).toContain('map: <U>(x: U) => U;');
    expect(code.typescript).not.toContain('__init__');
    expect(code.typescript).not.toContain('NoInitOrReplaceInit');
  });

  it('emits generic classes and type aliases with safe fallbacks', () => {
    const typeP = { name: 'P', kind: 'paramspec' } as const;
    const typeT = { name: 'T', kind: 'typevar', variance: 'invariant' } as const;
    const code = gen.generateModuleDefinition({
      name: 'generic_module',
      functions: [
        {
          name: 'forward',
          signature: {
            parameters: [
              {
                name: 'container',
                type: {
                  kind: 'generic',
                  name: 'Container',
                  module: 'generic_module',
                  typeArgs: [{ kind: 'typevar', name: 'T' }],
                },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
            ],
            returnType: {
              kind: 'generic',
              name: 'Container',
              module: 'generic_module',
              typeArgs: [{ kind: 'typevar', name: 'T' }],
            },
            isAsync: false,
            isGenerator: false,
          },
          docstring: undefined,
          decorators: [],
          isAsync: false,
          isGenerator: false,
          typeParameters: [typeT],
          returnType: {
            kind: 'generic',
            name: 'Container',
            module: 'generic_module',
            typeArgs: [{ kind: 'typevar', name: 'T' }],
          },
          parameters: [
            {
              name: 'container',
              type: {
                kind: 'generic',
                name: 'Container',
                module: 'generic_module',
                typeArgs: [{ kind: 'typevar', name: 'T' }],
              },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
          ],
        },
        {
          name: 'accept_transform',
          signature: {
            parameters: [
              {
                name: 'transform',
                type: {
                  kind: 'generic',
                  name: 'Transform',
                  module: 'generic_module',
                  typeArgs: [
                    { kind: 'paramspec', name: 'P' },
                    { kind: 'typevar', name: 'T' },
                  ],
                },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
            ],
            returnType: {
              kind: 'generic',
              name: 'Transform',
              module: 'generic_module',
              typeArgs: [
                { kind: 'paramspec', name: 'P' },
                { kind: 'typevar', name: 'T' },
              ],
            },
            isAsync: false,
            isGenerator: false,
          },
          docstring: undefined,
          decorators: [],
          isAsync: false,
          isGenerator: false,
          typeParameters: [typeP, typeT],
          returnType: {
            kind: 'generic',
            name: 'Transform',
            module: 'generic_module',
            typeArgs: [
              { kind: 'paramspec', name: 'P' },
              { kind: 'typevar', name: 'T' },
            ],
          },
          parameters: [
            {
              name: 'transform',
              type: {
                kind: 'generic',
                name: 'Transform',
                module: 'generic_module',
                typeArgs: [
                  { kind: 'paramspec', name: 'P' },
                  { kind: 'typevar', name: 'T' },
                ],
              },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
          ],
        },
      ],
      classes: [
        {
          name: 'Container',
          bases: ['Generic'],
          methods: [
            {
              name: '__init__',
              signature: {
                parameters: [
                  {
                    name: 'self',
                    type: { kind: 'primitive', name: 'None' },
                    optional: false,
                    varArgs: false,
                    kwArgs: false,
                  },
                  {
                    name: 'value',
                    type: { kind: 'typevar', name: 'T' },
                    optional: false,
                    varArgs: false,
                    kwArgs: false,
                  },
                ],
                returnType: { kind: 'primitive', name: 'None' },
                isAsync: false,
                isGenerator: false,
              },
              docstring: undefined,
              decorators: [],
              isAsync: false,
              isGenerator: false,
              returnType: { kind: 'primitive', name: 'None' },
              parameters: [
                {
                  name: 'self',
                  type: { kind: 'primitive', name: 'None' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
                {
                  name: 'value',
                  type: { kind: 'typevar', name: 'T' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
            },
            {
              name: 'clone',
              signature: {
                parameters: [
                  {
                    name: 'self',
                    type: { kind: 'primitive', name: 'None' },
                    optional: false,
                    varArgs: false,
                    kwArgs: false,
                  },
                ],
                returnType: {
                  kind: 'generic',
                  name: 'Container',
                  module: 'generic_module',
                  typeArgs: [{ kind: 'typevar', name: 'T' }],
                },
                isAsync: false,
                isGenerator: false,
              },
              docstring: undefined,
              decorators: [],
              isAsync: false,
              isGenerator: false,
              returnType: {
                kind: 'generic',
                name: 'Container',
                module: 'generic_module',
                typeArgs: [{ kind: 'typevar', name: 'T' }],
              },
              parameters: [
                {
                  name: 'self',
                  type: { kind: 'primitive', name: 'None' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
            },
            {
              name: 'id',
              signature: {
                parameters: [
                  {
                    name: 'self',
                    type: { kind: 'primitive', name: 'None' },
                    optional: false,
                    varArgs: false,
                    kwArgs: false,
                  },
                  {
                    name: 'x',
                    type: { kind: 'typevar', name: 'U' },
                    optional: false,
                    varArgs: false,
                    kwArgs: false,
                  },
                ],
                returnType: {
                  kind: 'collection',
                  name: 'tuple',
                  itemTypes: [
                    { kind: 'typevar', name: 'T' },
                    { kind: 'typevar', name: 'U' },
                  ],
                },
                isAsync: false,
                isGenerator: false,
              },
              docstring: undefined,
              decorators: [],
              isAsync: false,
              isGenerator: false,
              typeParameters: [{ name: 'U', kind: 'typevar', variance: 'invariant' }],
              returnType: {
                kind: 'collection',
                name: 'tuple',
                itemTypes: [
                  { kind: 'typevar', name: 'T' },
                  { kind: 'typevar', name: 'U' },
                ],
              },
              parameters: [
                {
                  name: 'self',
                  type: { kind: 'primitive', name: 'None' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
                {
                  name: 'x',
                  type: { kind: 'typevar', name: 'U' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
            },
          ],
          properties: [],
          docstring: undefined,
          decorators: [],
          typeParameters: [typeT],
        },
      ],
      typeAliases: [
        {
          name: 'Pair',
          type: {
            kind: 'collection',
            name: 'tuple',
            itemTypes: [
              { kind: 'typevar', name: 'T' },
              { kind: 'typevar', name: 'T' },
            ],
          },
          typeParameters: [typeT],
        },
        {
          name: 'Transform',
          type: {
            kind: 'callable',
            parameters: [],
            parameterSpec: { kind: 'paramspec', name: 'P' },
            returnType: { kind: 'typevar', name: 'T' },
          },
          typeParameters: [
            { name: 'P', kind: 'paramspec' },
            { name: 'T', kind: 'typevar', variance: 'invariant' },
          ],
        },
        {
          name: 'Variadic',
          type: {
            kind: 'collection',
            name: 'tuple',
            itemTypes: [
              {
                kind: 'unpack',
                type: { kind: 'typevartuple', name: 'Ts' },
              },
            ],
          },
          typeParameters: [{ name: 'Ts', kind: 'typevartuple' }],
        },
      ],
      imports: [],
      exports: [],
    } as any);

    expect(code.typescript).toContain('export async function forward<T>(container: Container<T>)');
    expect(code.typescript).toContain(
      'export async function acceptTransform<P extends unknown[], T>(transform: Transform<P, T>): Promise<Transform<P, T>>'
    );
    expect(code.typescript).toContain('Promise<Container<T>>');
    expect(code.typescript).toContain('export class Container<T>');
    expect(code.typescript).toContain('static async create<T>(value: T): Promise<Container<T>>');
    expect(code.typescript).toContain('static fromHandle<T>(handle: string): Container<T>');
    expect(code.typescript).toContain('async clone(): Promise<Container<T>>');
    expect(code.typescript).toContain('async id<U>(x: U): Promise<[T, U]>');
    expect(code.typescript).toContain('export type Pair<T> = [T, T]');
    expect(code.typescript).toContain(
      'export type Transform<P extends unknown[], T> = (...args: P) => T'
    );
    expect(code.typescript).toContain('export type Variadic = [unknown]');
    expect(code.typescript).not.toContain('~T');
    expect(code.typescript).not.toContain('~P');
    expect(code.typescript).not.toContain('Unpack[');
    expect(code.typescript).not.toMatch(/\bTs\b/);
    expect(code.declaration).toContain('export type Pair<T> = [T, T]');
    expect(code.declaration).toContain(
      'export function acceptTransform<P extends unknown[], T>(transform: Transform<P, T>): Promise<Transform<P, T>>;'
    );
    expect(code.declaration).toContain('id<U>(x: U): Promise<[T, U]>;');
    expect(code.declaration).not.toContain('getRuntimeBridge');
  });

  it('generates class wrapper', () => {
    const code = gen.generateClassWrapper(
      {
        name: 'Calculator',
        bases: [],
        methods: [
          {
            name: '__init__',
            signature: {
              parameters: [],
              returnType: { kind: 'primitive', name: 'None' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: undefined,
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'None' },
            parameters: [],
          },
          {
            name: 'add',
            signature: {
              parameters: [
                {
                  name: 'self',
                  type: { kind: 'primitive', name: 'None' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
                {
                  name: 'x',
                  type: { kind: 'primitive', name: 'int' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
              returnType: { kind: 'primitive', name: 'int' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: 'Add',
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'int' },
            parameters: [
              {
                name: 'self',
                type: { kind: 'primitive', name: 'None' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
              {
                name: 'x',
                type: { kind: 'primitive', name: 'int' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
            ],
          },
        ],
        properties: [],
        docstring: 'A calc',
        decorators: [],
      } as any,
      'math'
    );
    expect(code.typescript).toContain('export class Calculator');
    expect(code.typescript).toContain('async add(');
    expect(code.typescript).toContain('getRuntimeBridge().callMethod');
  });
});
