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
    expect(code.typescript).toContain("__bridge.call('math.add'");
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
      /export function f\(x: number, \.\.\.args: unknown\[], kwargs\?: Record<string, unknown>\): Promise<number>;/
    );
    expect(code.typescript).toMatch(
      /export async function f\(x: number, y\?: number, \.\.\.args: unknown\[], kwargs\?: Record<string, unknown>\): Promise<number>/
    );
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
    expect(code.typescript).toContain('constructor(x?: number, ...args: unknown[])');
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
    expect(code.typescript).toContain("__bridge.call('math.Calculator.add'");
  });
});
