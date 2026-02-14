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
    expect(code.typescript).toMatch(
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
