/**
 * Comprehensive Code Generation Quality Tests for tywrap
 *
 * This test suite validates that generated TypeScript code meets production-quality standards
 * including proper typing, ESLint compliance, documentation, and performance.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CodeGenerator } from '../src/core/generator.js';
import { TypeMapper } from '../src/core/mapper.js';
import type {
  PythonFunction,
  PythonClass,
  PythonModule,
  PythonType,
  Parameter,
  Property,
} from '../src/types/index.js';

describe('Code Generation Quality', () => {
  let generator: CodeGenerator;
  let mapper: TypeMapper;

  beforeEach(() => {
    generator = new CodeGenerator();
    mapper = new TypeMapper();
  });

  describe('Generated Code Quality Tests', () => {
    it('should generate code that passes strict ESLint rules', () => {
      const testFunction: PythonFunction = {
        name: 'calculate_sum',
        signature: {
          parameters: [
            {
              name: 'numbers',
              type: {
                kind: 'collection',
                name: 'list',
                itemTypes: [{ kind: 'primitive', name: 'int' }],
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
        docstring: 'Calculate the sum of a list of numbers',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'int' },
        parameters: [
          {
            name: 'numbers',
            type: {
              kind: 'collection',
              name: 'list',
              itemTypes: [{ kind: 'primitive', name: 'int' }],
            },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(testFunction, 'math');
      const generatedCode = result.typescript;

      // Check for ESLint-compliant patterns
      expect(generatedCode).toMatch(/export async function calculateSum/);
      expect(generatedCode).toMatch(/Promise<number>/);
      expect(generatedCode).not.toMatch(/\bany\b/); // No 'any' types
      expect(generatedCode).not.toMatch(/console\.log/); // No console statements
      expect(generatedCode).toMatch(/\/\*\*[\s\S]*?\*\//); // Has JSDoc
      expect(generatedCode).toMatch(/return getRuntimeBridge\(\)\.call\(/); // Proper bridge call
    });

    it('should validate proper TypeScript types and interfaces', () => {
      const testClass: PythonClass = {
        name: 'DataProcessor',
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
                  name: 'config',
                  type: {
                    kind: 'collection',
                    name: 'dict',
                    itemTypes: [
                      { kind: 'primitive', name: 'str' },
                      {
                        kind: 'union',
                        types: [
                          { kind: 'primitive', name: 'str' },
                          { kind: 'primitive', name: 'int' },
                          { kind: 'primitive', name: 'bool' },
                        ],
                      },
                    ],
                  },
                  optional: true,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
              returnType: { kind: 'primitive', name: 'None' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: 'Initialize the data processor',
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
                name: 'config',
                type: {
                  kind: 'collection',
                  name: 'dict',
                  itemTypes: [
                    { kind: 'primitive', name: 'str' },
                    {
                      kind: 'union',
                      types: [
                        { kind: 'primitive', name: 'str' },
                        { kind: 'primitive', name: 'int' },
                        { kind: 'primitive', name: 'bool' },
                      ],
                    },
                  ],
                },
                optional: true,
                varArgs: false,
                kwArgs: false,
              },
            ],
          },
        ],
        properties: [],
        docstring: 'A data processing utility class',
        decorators: [],
      };

      const result = generator.generateClassWrapper(testClass, 'processing');
      const generatedCode = result.typescript;

      // Verify proper TypeScript class structure
      expect(generatedCode).toMatch(/export class DataProcessor/);
      expect(generatedCode).toMatch(/private readonly __handle: string;/);
      expect(generatedCode).toMatch(/private constructor\(handle: string\)/);
      expect(generatedCode).toMatch(/static async create/);

      // Check for proper type annotations
      expect(generatedCode).toMatch(/config\?: Record<string, string \| number \| boolean>/);
      expect(generatedCode).toContain('/**');
      expect(generatedCode).toContain('A data processing utility class');
    });

    it('should ensure generated code follows TypeScript best practices', () => {
      const testModule: PythonModule = {
        name: 'utilities',
        functions: [
          {
            name: 'format_string',
            signature: {
              parameters: [
                {
                  name: 'template',
                  type: { kind: 'primitive', name: 'str' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
                {
                  name: 'values',
                  type: {
                    kind: 'collection',
                    name: 'dict',
                    itemTypes: [
                      { kind: 'primitive', name: 'str' },
                      { kind: 'primitive', name: 'str' },
                    ],
                  },
                  optional: true,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
              returnType: { kind: 'primitive', name: 'str' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: 'Format a string template with provided values',
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'str' },
            parameters: [
              {
                name: 'template',
                type: { kind: 'primitive', name: 'str' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
              {
                name: 'values',
                type: {
                  kind: 'collection',
                  name: 'dict',
                  itemTypes: [
                    { kind: 'primitive', name: 'str' },
                    { kind: 'primitive', name: 'str' },
                  ],
                },
                optional: true,
                varArgs: false,
                kwArgs: false,
              },
            ],
          },
        ],
        classes: [],
        imports: [],
        exports: ['format_string'],
      };

      const result = generator.generateModuleDefinition(testModule);
      const generatedCode = result.typescript;

      // Check for TypeScript best practices
      expect(generatedCode).toContain('// Generated by tywrap');
      expect(generatedCode).toContain('// DO NOT EDIT MANUALLY');
      expect(generatedCode).toMatch(/export async function formatString/);
      expect(generatedCode).toMatch(/Promise<string>/);
      expect(generatedCode).toMatch(/template: string/);
      expect(generatedCode).toMatch(/values\?: Record<string, string>/);

      // Ensure proper async/await usage
      expect(generatedCode).toMatch(/return getRuntimeBridge\(\)\.call\(/);
      expect(generatedCode).not.toMatch(/\.then\(/); // Should use async/await, not promises
    });
  });

  describe('Identifier and Reserved Words Handling', () => {
    it('should properly escape Python identifiers that are TypeScript reserved words', () => {
      const reservedWordTests = [
        'default',
        'delete',
        'new',
        'class',
        'function',
        'var',
        'let',
        'const',
        'enum',
        'export',
        'import',
        'return',
        'extends',
        'implements',
        'interface',
        'package',
        'private',
        'protected',
        'public',
        'static',
        'yield',
        'await',
        'async',
        'null',
        'true',
        'false',
      ];

      reservedWordTests.forEach(reservedWord => {
        const testFunction: PythonFunction = {
          name: reservedWord,
          signature: {
            parameters: [],
            returnType: { kind: 'primitive', name: 'str' },
            isAsync: false,
            isGenerator: false,
          },
          docstring: `Test function with reserved word: ${reservedWord}`,
          decorators: [],
          isAsync: false,
          isGenerator: false,
          returnType: { kind: 'primitive', name: 'str' },
          parameters: [],
        };

        const result = generator.generateFunctionWrapper(testFunction, 'test');
        const generatedCode = result.typescript;

        // Should escape the reserved word
        expect(generatedCode).toMatch(new RegExp(`export async function _${reservedWord}_`));
        expect(generatedCode).toMatch(
          new RegExp(`getRuntimeBridge\\(\\)\\.call\\('test', '${reservedWord}'`)
        );
      });
    });

    it('should validate handling of special characters in names', () => {
      const specialCharTests = [
        'function-name',
        'function_with_underscore',
        'function123',
        '123function', // starts with number
        'function@symbol',
        'function.dot',
        'function[bracket]',
        'función', // unicode
        'العربية', // arabic
      ];

      specialCharTests.forEach(name => {
        const testFunction: PythonFunction = {
          name,
          signature: {
            parameters: [],
            returnType: { kind: 'primitive', name: 'str' },
            isAsync: false,
            isGenerator: false,
          },
          docstring: `Test function with special name: ${name}`,
          decorators: [],
          isAsync: false,
          isGenerator: false,
          returnType: { kind: 'primitive', name: 'str' },
          parameters: [],
        };

        const result = generator.generateFunctionWrapper(testFunction, 'test');
        const generatedCode = result.typescript;

        // Should generate valid JavaScript identifier
        expect(generatedCode).toMatch(/export async function [a-zA-Z_$][a-zA-Z0-9_$]*/);

        // Should not contain invalid characters in function names
        const functionNameMatch = generatedCode.match(
          /export async function ([a-zA-Z_$][a-zA-Z0-9_$]*)/
        );
        if (functionNameMatch) {
          const generatedName = functionNameMatch[1];
          expect(/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(generatedName)).toBe(true);
        }
      });
    });

    it('should test unicode identifier support', () => {
      const unicodeFunction: PythonFunction = {
        name: 'calculer_somme', // French
        signature: {
          parameters: [
            {
              name: 'números', // Spanish parameter name
              type: {
                kind: 'collection',
                name: 'list',
                itemTypes: [{ kind: 'primitive', name: 'int' }],
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
        docstring: 'Calculate sum with unicode names',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'int' },
        parameters: [
          {
            name: 'números',
            type: {
              kind: 'collection',
              name: 'list',
              itemTypes: [{ kind: 'primitive', name: 'int' }],
            },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(unicodeFunction, 'math');
      const generatedCode = result.typescript;

      // Should handle unicode characters appropriately
      expect(generatedCode).toMatch(/export async function/);
      expect(generatedCode).toContain('calculer_somme'); // Keep unicode in original call

      // Parameters should be safely converted
      expect(generatedCode).toMatch(/nMeros|numeros/); // Either escaped or normalized
    });

    it('should ensure no naming conflicts in generated code', () => {
      const conflictingFunctions: PythonFunction[] = [
        {
          name: 'process',
          signature: {
            parameters: [],
            returnType: { kind: 'primitive', name: 'str' },
            isAsync: false,
            isGenerator: false,
          },
          docstring: 'Process data',
          decorators: [],
          isAsync: false,
          isGenerator: false,
          returnType: { kind: 'primitive', name: 'str' },
          parameters: [],
        },
        {
          name: 'Process', // Different case
          signature: {
            parameters: [],
            returnType: { kind: 'primitive', name: 'str' },
            isAsync: false,
            isGenerator: false,
          },
          docstring: 'Process data (capitalized)',
          decorators: [],
          isAsync: false,
          isGenerator: false,
          returnType: { kind: 'primitive', name: 'str' },
          parameters: [],
        },
      ];

      const module: PythonModule = {
        name: 'test',
        functions: conflictingFunctions,
        classes: [],
        imports: [],
        exports: ['process', 'Process'],
      };

      const result = generator.generateModuleDefinition(module);
      const generatedCode = result.typescript;

      // Should generate distinct names
      const functionNames = generatedCode.match(/export async function (\w+)/g) || [];
      const uniqueNames = new Set(functionNames);

      expect(functionNames.length).toBe(2);
      expect(uniqueNames.size).toBe(2); // All names should be unique
    });
  });

  describe('JSDoc and Documentation Quality', () => {
    it('should validate JSDoc generation from Python docstrings', () => {
      const testFunction: PythonFunction = {
        name: 'complex_calculation',
        signature: {
          parameters: [
            {
              name: 'x',
              type: { kind: 'primitive', name: 'float' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'y',
              type: { kind: 'primitive', name: 'float' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'primitive', name: 'float' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: `Perform complex mathematical calculation.

This function calculates a complex mathematical operation
based on the provided parameters.

Args:
    x (float): The first parameter
    y (float, optional): The second parameter. Defaults to 1.0.

Returns:
    float: The calculated result

Raises:
    ValueError: If x is negative
    TypeError: If parameters are not numeric

Example:
    >>> complex_calculation(2.5, 3.0)
    7.5
    >>> complex_calculation(2.5)
    2.5
`,
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'float' },
        parameters: [
          {
            name: 'x',
            type: { kind: 'primitive', name: 'float' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'y',
            type: { kind: 'primitive', name: 'float' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(testFunction, 'math', true);
      const generatedCode = result.typescript;

      // Should generate proper JSDoc
      expect(generatedCode).toContain('/**');
      expect(generatedCode).toContain('*/');
      expect(generatedCode).toContain('Perform complex mathematical calculation');
      expect(generatedCode).toContain('@param');

      // Should preserve multi-line descriptions
      const jsdocMatch = generatedCode.match(/\/\*\*([\s\S]*?)\*\//);
      expect(jsdocMatch).toBeTruthy();
      if (jsdocMatch) {
        const jsdocContent = jsdocMatch[1];
        expect(jsdocContent).toContain('complex mathematical operation');
        expect(jsdocContent).toContain('based on the provided parameters');
      }
    });

    it('should test parameter documentation extraction', () => {
      const functionWithComplexParams: PythonFunction = {
        name: 'process_data',
        signature: {
          parameters: [
            {
              name: 'data',
              type: {
                kind: 'union',
                types: [
                  {
                    kind: 'collection',
                    name: 'list',
                    itemTypes: [{ kind: 'primitive', name: 'str' }],
                  },
                  {
                    kind: 'collection',
                    name: 'dict',
                    itemTypes: [
                      { kind: 'primitive', name: 'str' },
                      { kind: 'primitive', name: 'str' },
                    ],
                  },
                ],
              },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'options',
              type: {
                kind: 'collection',
                name: 'dict',
                itemTypes: [
                  { kind: 'primitive', name: 'str' },
                  { kind: 'primitive', name: 'str' },
                ],
              },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'args',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: true,
              kwArgs: false,
            },
            {
              name: 'kwargs',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: false,
              kwArgs: true,
            },
          ],
          returnType: { kind: 'primitive', name: 'bool' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: `Process various types of data.

Args:
    data: Input data as list or dict
    options: Optional processing options
    *args: Variable positional arguments  
    **kwargs: Variable keyword arguments

Returns:
    bool: Success status
`,
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'bool' },
        parameters: [
          {
            name: 'data',
            type: {
              kind: 'union',
              types: [
                {
                  kind: 'collection',
                  name: 'list',
                  itemTypes: [{ kind: 'primitive', name: 'str' }],
                },
                {
                  kind: 'collection',
                  name: 'dict',
                  itemTypes: [
                    { kind: 'primitive', name: 'str' },
                    { kind: 'primitive', name: 'str' },
                  ],
                },
              ],
            },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'options',
            type: {
              kind: 'collection',
              name: 'dict',
              itemTypes: [
                { kind: 'primitive', name: 'str' },
                { kind: 'primitive', name: 'str' },
              ],
            },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'args',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: true,
            kwArgs: false,
          },
          {
            name: 'kwargs',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: true,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(functionWithComplexParams, 'utils', true);
      const generatedCode = result.typescript;

      // Should handle complex parameter types in documentation
      expect(generatedCode).toContain('/**');
      expect(generatedCode).toContain('Process various types of data');
      expect(generatedCode).toContain('@param');

      // Should correctly type the parameters
      expect(generatedCode).toMatch(/data: string\[\] \| Record<string, string>/);
      expect(generatedCode).toMatch(/options\?: Record<string, string>/);
      expect(generatedCode).toMatch(/args\?: unknown\[\]/);
      expect(generatedCode).toMatch(/kwargs\?: Record<string, unknown>/);
    });

    it('should ensure return type documentation is preserved', () => {
      const functionWithComplexReturn: PythonFunction = {
        name: 'get_metadata',
        signature: {
          parameters: [],
          returnType: {
            kind: 'collection',
            name: 'dict',
            itemTypes: [
              { kind: 'primitive', name: 'str' },
              {
                kind: 'union',
                types: [
                  { kind: 'primitive', name: 'str' },
                  { kind: 'primitive', name: 'int' },
                  {
                    kind: 'collection',
                    name: 'list',
                    itemTypes: [{ kind: 'primitive', name: 'str' }],
                  },
                ],
              },
            ],
          },
          isAsync: false,
          isGenerator: false,
        },
        docstring: `Get system metadata.

Returns:
    dict: A dictionary containing:
        - name (str): System name
        - version (int): Version number
        - features (list[str]): Available features
        - status (str): Current status

Example:
    {
        "name": "tywrap",
        "version": 1,
        "features": ["typing", "generation"],
        "status": "active"
    }
`,
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: {
          kind: 'collection',
          name: 'dict',
          itemTypes: [
            { kind: 'primitive', name: 'str' },
            {
              kind: 'union',
              types: [
                { kind: 'primitive', name: 'str' },
                { kind: 'primitive', name: 'int' },
                {
                  kind: 'collection',
                  name: 'list',
                  itemTypes: [{ kind: 'primitive', name: 'str' }],
                },
              ],
            },
          ],
        },
        parameters: [],
      };

      const result = generator.generateFunctionWrapper(functionWithComplexReturn, 'system');
      const generatedCode = result.typescript;

      // Should preserve return type documentation
      expect(generatedCode).toContain('Get system metadata');
      expect(generatedCode).toContain('A dictionary containing');
      expect(generatedCode).toMatch(/Promise<Record<string, string \| number \| string\[\]>>/);

      // Should include example
      expect(generatedCode).toContain('Example:');
      expect(generatedCode).toContain('"tywrap"');
    });

    it('should test that examples and code blocks are properly formatted', () => {
      const functionWithCodeExample: PythonFunction = {
        name: 'format_code',
        signature: {
          parameters: [
            {
              name: 'code',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'primitive', name: 'str' },
          isAsync: false,
          isGenerator: false,
        },
        docstring:
          "Format code string.\n\nThis function formats code with proper indentation.\n\nArgs:\n    code (str): The code to format\n\nReturns:\n    str: Formatted code\n\nExample:\n    code = \"def hello(): print('world')\"\n    formatted = format_code(code)\n    print(formatted)\n    \n    Output:\n    def hello():\n        print('world')\n",
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'str' },
        parameters: [
          {
            name: 'code',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(functionWithCodeExample, 'formatter');
      const generatedCode = result.typescript;

      // Should preserve code blocks in JSDoc
      expect(generatedCode).toContain('Format code string');
      expect(generatedCode).toContain('Example:');

      // Code blocks should be preserved in some form
      const jsdocMatch = generatedCode.match(/\/\*\*([\s\S]*?)\*\//);
      expect(jsdocMatch).toBeTruthy();
      if (jsdocMatch) {
        const jsdocContent = jsdocMatch[1];
        expect(jsdocContent).toContain('def hello()');
        expect(jsdocContent).toContain("print('world')");
      }
    });
  });

  describe('Function Overloads Generation', () => {
    it('should test generation of TypeScript overloads for optional parameters', () => {
      const functionWithOptionals: PythonFunction = {
        name: 'create_request',
        signature: {
          parameters: [
            {
              name: 'url',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'method',
              type: { kind: 'primitive', name: 'str' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'headers',
              type: {
                kind: 'collection',
                name: 'dict',
                itemTypes: [
                  { kind: 'primitive', name: 'str' },
                  { kind: 'primitive', name: 'str' },
                ],
              },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'timeout',
              type: { kind: 'primitive', name: 'int' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'primitive', name: 'str' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'Create an HTTP request',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'str' },
        parameters: [
          {
            name: 'url',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'method',
            type: { kind: 'primitive', name: 'str' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'headers',
            type: {
              kind: 'collection',
              name: 'dict',
              itemTypes: [
                { kind: 'primitive', name: 'str' },
                { kind: 'primitive', name: 'str' },
              ],
            },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'timeout',
            type: { kind: 'primitive', name: 'int' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(functionWithOptionals, 'http');
      const generatedCode = result.typescript;

      // Should generate multiple overloads
      const overloadMatches =
        generatedCode.match(/export function createRequest\([^)]*\): Promise<string>;/g) || [];
      expect(overloadMatches.length).toBeGreaterThan(1);

      // Should have different parameter combinations
      expect(generatedCode).toMatch(
        /export function createRequest\(url: string\): Promise<string>;/
      );
      expect(generatedCode).toMatch(
        /export function createRequest\(url: string, method\?: string\): Promise<string>;/
      );

      // Final implementation should have all parameters
      expect(generatedCode).toMatch(
        /export async function createRequest\(url: string, method\?: string, headers\?: Record<string, string>, timeout\?: number\): Promise<string>/
      );
    });

    it('should validate overload ordering and specificity', () => {
      const overloadFunction: PythonFunction = {
        name: 'flexible_function',
        signature: {
          parameters: [
            {
              name: 'required',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'opt1',
              type: { kind: 'primitive', name: 'str' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'opt2',
              type: { kind: 'primitive', name: 'int' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'opt3',
              type: { kind: 'primitive', name: 'bool' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'primitive', name: 'str' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'A flexible function with multiple optional parameters',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'str' },
        parameters: [
          {
            name: 'required',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'opt1',
            type: { kind: 'primitive', name: 'str' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'opt2',
            type: { kind: 'primitive', name: 'int' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'opt3',
            type: { kind: 'primitive', name: 'bool' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(overloadFunction, 'test');
      const generatedCode = result.typescript;

      // Overloads should be ordered from most specific to least specific
      const lines = generatedCode.split('\n');
      const overloadLines = lines.filter(line => line.includes('export function flexibleFunction'));

      // Should have proper number of overloads
      expect(overloadLines.length).toBeGreaterThan(0);

      // Most specific overload should come first (with fewer parameters)
      const firstOverload = overloadLines[0];
      const lastOverload = overloadLines[overloadLines.length - 1];

      // First should have fewer parameters than last
      const firstParamCount = (firstOverload.match(/,/g) || []).length;
      const implementationLine = lines.find(line =>
        line.includes('export async function flexibleFunction')
      );
      const implParamCount = implementationLine ? (implementationLine.match(/,/g) || []).length : 0;

      expect(firstParamCount).toBeLessThan(implParamCount);
    });

    it('should test *args and **kwargs handling', () => {
      const varargsFunction: PythonFunction = {
        name: 'variadic_function',
        signature: {
          parameters: [
            {
              name: 'base',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'args',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: true,
              kwArgs: false,
            },
            {
              name: 'kwargs',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: false,
              kwArgs: true,
            },
          ],
          returnType: { kind: 'primitive', name: 'str' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'Function with *args and **kwargs',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'str' },
        parameters: [
          {
            name: 'base',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'args',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: true,
            kwArgs: false,
          },
          {
            name: 'kwargs',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: true,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(varargsFunction, 'test');
      const generatedCode = result.typescript;

      // Should handle varargs and kwargs properly
      expect(generatedCode).toMatch(/args\?: unknown\[\]/);
      expect(generatedCode).toMatch(/kwargs\?: Record<string, unknown>/);

      // Should pass them correctly to bridge call
      expect(generatedCode).toContain('...(args ?? [])');
      expect(generatedCode).toContain('kwargs');
      expect(generatedCode).toContain(
        "getRuntimeBridge().call('test', 'variadic_function', [base, ...(args ?? [])], kwargs)"
      );
    });

    it('should ensure default parameter values are handled correctly', () => {
      const functionWithDefaults: PythonFunction = {
        name: 'function_with_defaults',
        signature: {
          parameters: [
            {
              name: 'name',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              defaultValue: undefined,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'count',
              type: { kind: 'primitive', name: 'int' },
              optional: true,
              defaultValue: 10,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'enabled',
              type: { kind: 'primitive', name: 'bool' },
              optional: true,
              defaultValue: true,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: { kind: 'primitive', name: 'str' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'Function with default parameter values',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'str' },
        parameters: [
          {
            name: 'name',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            defaultValue: undefined,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'count',
            type: { kind: 'primitive', name: 'int' },
            optional: true,
            defaultValue: 10,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'enabled',
            type: { kind: 'primitive', name: 'bool' },
            optional: true,
            defaultValue: true,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(functionWithDefaults, 'test');
      const generatedCode = result.typescript;

      // Should mark optional parameters correctly
      expect(generatedCode).toMatch(/name: string/);
      expect(generatedCode).toMatch(/count\?: number/);
      expect(generatedCode).toMatch(/enabled\?: boolean/);

      // Should generate appropriate overloads
      expect(generatedCode).toMatch(
        /export function functionWithDefaults\(name: string\): Promise<string>;/
      );
      expect(generatedCode).toMatch(
        /export function functionWithDefaults\(name: string, count\?: number\): Promise<string>;/
      );
    });
  });

  describe('Special Class Types Generation', () => {
    it('should test TypedDict → TypeScript interface generation', () => {
      const typedDictClass: PythonClass = {
        name: 'UserProfile',
        bases: [],
        methods: [],
        properties: [
          {
            name: 'id',
            type: { kind: 'primitive', name: 'int' },
            readonly: false,
            getter: true,
            setter: false,
          } as Property,
          {
            name: 'username',
            type: { kind: 'primitive', name: 'str' },
            readonly: false,
            getter: true,
            setter: false,
          } as Property,
          {
            name: 'email',
            type: { kind: 'primitive', name: 'str' },
            readonly: false,
            getter: true,
            setter: false,
            optional: true,
          } as Property & { optional?: boolean },
          {
            name: 'is_active',
            type: { kind: 'primitive', name: 'bool' },
            readonly: false,
            getter: true,
            setter: false,
          } as Property,
        ],
        docstring: 'User profile information',
        decorators: ['__typed_dict__'],
        kind: 'typed_dict',
      };

      const result = generator.generateClassWrapper(typedDictClass, 'users');
      const generatedCode = result.typescript;

      // Should generate a type alias instead of class
      expect(generatedCode).toContain('export type UserProfile =');
      expect(generatedCode).not.toContain('export class UserProfile');

      // Should have proper property types
      expect(generatedCode).toContain('id: number;');
      expect(generatedCode).toContain('username: string;');
      expect(generatedCode).toContain('email?: string;'); // Optional
      expect(generatedCode).toContain('isActive: boolean;');

      // Should include documentation
      expect(generatedCode).toContain('User profile information');
    });

    it('should validate Protocol → structural type generation', () => {
      const protocolClass: PythonClass = {
        name: 'Drawable',
        bases: [],
        methods: [
          {
            name: 'draw',
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
                  name: 'canvas',
                  type: { kind: 'primitive', name: 'str' },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
              returnType: { kind: 'primitive', name: 'None' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: 'Draw on canvas',
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
                name: 'canvas',
                type: { kind: 'primitive', name: 'str' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
            ],
          },
        ],
        properties: [
          {
            name: 'color',
            type: { kind: 'primitive', name: 'str' },
            readonly: false,
            getter: true,
            setter: true,
          },
        ],
        docstring: 'Protocol for drawable objects',
        decorators: [],
        kind: 'protocol',
      };

      const result = generator.generateClassWrapper(protocolClass, 'graphics');
      const generatedCode = result.typescript;

      // Should generate structural type
      expect(generatedCode).toContain('export type Drawable =');
      expect(generatedCode).not.toContain('export class Drawable');

      // Should include properties and methods
      expect(generatedCode).toContain('color: string;');
      expect(generatedCode).toContain('draw: (canvas: string) => void;');

      // Should include documentation
      expect(generatedCode).toContain('Protocol for drawable objects');
    });

    it('should test NamedTuple → readonly tuple generation', () => {
      const namedTupleClass: PythonClass = {
        name: 'Point',
        bases: [],
        methods: [],
        properties: [
          {
            name: 'x',
            type: { kind: 'primitive', name: 'float' },
            readonly: true,
            getter: true,
            setter: false,
          },
          {
            name: 'y',
            type: { kind: 'primitive', name: 'float' },
            readonly: true,
            getter: true,
            setter: false,
          },
        ],
        docstring: 'A point in 2D space',
        decorators: [],
        kind: 'namedtuple',
      };

      const result = generator.generateClassWrapper(namedTupleClass, 'geometry');
      const generatedCode = result.typescript;

      // Should generate readonly tuple type
      expect(generatedCode).toContain('export type Point = readonly [number, number]');
      expect(generatedCode).not.toContain('export class Point');

      // Should include documentation
      expect(generatedCode).toContain('A point in 2D space');
    });

    it('should ensure dataclass and Pydantic model handling', () => {
      const dataclassClass: PythonClass = {
        name: 'Configuration',
        bases: [],
        methods: [],
        properties: [
          {
            name: 'host',
            type: { kind: 'primitive', name: 'str' },
            readonly: false,
            getter: true,
            setter: true,
          },
          {
            name: 'port',
            type: { kind: 'primitive', name: 'int' },
            readonly: false,
            getter: true,
            setter: true,
          },
          {
            name: 'ssl_enabled',
            type: { kind: 'primitive', name: 'bool' },
            readonly: false,
            getter: true,
            setter: true,
            optional: true,
          } as Property & { optional?: boolean },
        ],
        docstring: 'Server configuration',
        decorators: [],
        kind: 'dataclass',
      };

      const result = generator.generateClassWrapper(dataclassClass, 'config');
      const generatedCode = result.typescript;

      // Should generate object type
      expect(generatedCode).toContain('export type Configuration =');
      expect(generatedCode).toContain('host: string;');
      expect(generatedCode).toContain('port: number;');
      expect(generatedCode).toContain('sslEnabled?: boolean;');

      // Should include documentation
      expect(generatedCode).toContain('Server configuration');
    });

    it('should test Enum generation', () => {
      // Note: This test assumes enum handling might be added to the generator
      const enumClass: PythonClass = {
        name: 'Status',
        bases: ['Enum'],
        methods: [],
        properties: [
          {
            name: 'ACTIVE',
            type: { kind: 'literal', value: 'active' },
            readonly: true,
            getter: true,
            setter: false,
          },
          {
            name: 'INACTIVE',
            type: { kind: 'literal', value: 'inactive' },
            readonly: true,
            getter: true,
            setter: false,
          },
          {
            name: 'PENDING',
            type: { kind: 'literal', value: 'pending' },
            readonly: true,
            getter: true,
            setter: false,
          },
        ],
        docstring: 'Status enumeration',
        decorators: [],
        kind: 'class', // Note: Would need 'enum' kind for proper enum handling
      };

      const result = generator.generateClassWrapper(enumClass, 'types');
      const generatedCode = result.typescript;

      // For now, should generate as regular class
      // In the future, could be enhanced to generate proper TypeScript enum or union type
      expect(generatedCode).toContain('Status');
      expect(generatedCode).toContain('Status enumeration');
    });
  });

  describe('Code Generation Improvements', () => {
    it('should generate readable and maintainable code', () => {
      const complexModule: PythonModule = {
        name: 'advanced_math',
        functions: [
          {
            name: 'calculate_statistics',
            signature: {
              parameters: [
                {
                  name: 'data',
                  type: {
                    kind: 'collection',
                    name: 'list',
                    itemTypes: [{ kind: 'primitive', name: 'float' }],
                  },
                  optional: false,
                  varArgs: false,
                  kwArgs: false,
                },
              ],
              returnType: {
                kind: 'collection',
                name: 'dict',
                itemTypes: [
                  { kind: 'primitive', name: 'str' },
                  { kind: 'primitive', name: 'float' },
                ],
              },
              isAsync: false,
              isGenerator: false,
            },
            docstring: 'Calculate basic statistics for numerical data',
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: {
              kind: 'collection',
              name: 'dict',
              itemTypes: [
                { kind: 'primitive', name: 'str' },
                { kind: 'primitive', name: 'float' },
              ],
            },
            parameters: [
              {
                name: 'data',
                type: {
                  kind: 'collection',
                  name: 'list',
                  itemTypes: [{ kind: 'primitive', name: 'float' }],
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
            name: 'StatisticsCalculator',
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
                      name: 'precision',
                      type: { kind: 'primitive', name: 'int' },
                      optional: true,
                      varArgs: false,
                      kwArgs: false,
                    },
                  ],
                  returnType: { kind: 'primitive', name: 'None' },
                  isAsync: false,
                  isGenerator: false,
                },
                docstring: 'Initialize calculator with optional precision',
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
                    name: 'precision',
                    type: { kind: 'primitive', name: 'int' },
                    optional: true,
                    varArgs: false,
                    kwArgs: false,
                  },
                ],
              },
            ],
            properties: [],
            docstring: 'Advanced statistics calculator',
            decorators: [],
          },
        ],
        imports: [],
        exports: ['calculate_statistics', 'StatisticsCalculator'],
      };

      const result = generator.generateModuleDefinition(complexModule);
      const generatedCode = result.typescript;

      // Should be well-formatted and readable
      expect(generatedCode).toContain('// Generated by tywrap');
      expect(generatedCode).toContain('// Module: advanced_math');
      expect(generatedCode).toContain('// DO NOT EDIT MANUALLY');

      // Should have consistent formatting
      const lines = generatedCode.split('\n');
      const nonEmptyLines = lines.filter(line => line.trim().length > 0);

      // Should have proper indentation
      const indentedLines = nonEmptyLines.filter(line => line.startsWith('  '));
      expect(indentedLines.length).toBeGreaterThan(0);

      // Should not have excessively long lines (good for readability)
      const longLines = lines.filter(line => line.length > 120);
      expect(longLines.length).toBeLessThan(lines.length * 0.1); // Less than 10% of lines should be very long
    });

    it('should optimize bundle size of generated code', () => {
      const testFunction: PythonFunction = {
        name: 'simple_add',
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
            name: 'a',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'b',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(testFunction, 'math');
      const generatedCode = result.typescript;

      // Should be concise and avoid redundancy
      expect(generatedCode.length).toBeLessThan(500); // Reasonable size for simple function

      // Should not have unnecessary whitespace
      const excessiveWhitespace = generatedCode.match(/\n\s*\n\s*\n/g);
      expect(excessiveWhitespace?.length || 0).toBeLessThan(3);

      // Should use concise type definitions
      expect(generatedCode).toContain('number'); // Not 'number | undefined' when not needed
      expect(generatedCode).toContain('Promise<number>'); // Clear return type
    });

    it('should ensure tree-shaking compatibility', () => {
      const module: PythonModule = {
        name: 'utilities',
        functions: [
          {
            name: 'function_a',
            signature: {
              parameters: [],
              returnType: { kind: 'primitive', name: 'str' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: 'Function A',
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'str' },
            parameters: [],
          },
          {
            name: 'function_b',
            signature: {
              parameters: [],
              returnType: { kind: 'primitive', name: 'str' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: 'Function B',
            decorators: [],
            isAsync: false,
            isGenerator: false,
            returnType: { kind: 'primitive', name: 'str' },
            parameters: [],
          },
        ],
        classes: [],
        imports: [],
        exports: ['function_a', 'function_b'],
      };

      const result = generator.generateModuleDefinition(module);
      const generatedCode = result.typescript;

      // Should use named exports (tree-shakable)
      expect(generatedCode).toMatch(/export async function functionA/);
      expect(generatedCode).toMatch(/export async function functionB/);

      // Should not use default export or namespace
      expect(generatedCode).not.toContain('export default');
      expect(generatedCode).not.toContain('export namespace');

      // Each function should be independently importable
      const functionAMatch = generatedCode.match(/export async function functionA[\s\S]*?^}/m);
      const functionBMatch = generatedCode.match(/export async function functionB[\s\S]*?^}/m);

      expect(functionAMatch).toBeTruthy();
      expect(functionBMatch).toBeTruthy();
    });

    it('should validate that unused code can be eliminated', () => {
      const testFunction: PythonFunction = {
        name: 'minimal_function',
        signature: {
          parameters: [],
          returnType: { kind: 'primitive', name: 'None' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'Minimal function',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'None' },
        parameters: [],
      };

      const result = generator.generateFunctionWrapper(testFunction, 'test');
      const generatedCode = result.typescript;

      // Should not include unnecessary imports or dependencies
      expect(generatedCode).not.toContain('import');

      // Should only include what's necessary
      expect(generatedCode).toContain('export async function minimalFunction');
      expect(generatedCode).toContain('getRuntimeBridge().call');
      expect(generatedCode).toContain('Promise<void>');

      // Should not include unused bridge methods
      expect(generatedCode).not.toContain('instantiate'); // Only needed for classes
    });
  });

  describe('Performance and Size Optimization', () => {
    it('should test generated code performance characteristics', () => {
      const performanceFunction: PythonFunction = {
        name: 'batch_process',
        signature: {
          parameters: [
            {
              name: 'items',
              type: {
                kind: 'collection',
                name: 'list',
                itemTypes: [{ kind: 'primitive', name: 'str' }],
              },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'batch_size',
              type: { kind: 'primitive', name: 'int' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
          ],
          returnType: {
            kind: 'collection',
            name: 'list',
            itemTypes: [{ kind: 'primitive', name: 'str' }],
          },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'Process items in batches for better performance',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: {
          kind: 'collection',
          name: 'list',
          itemTypes: [{ kind: 'primitive', name: 'str' }],
        },
        parameters: [
          {
            name: 'items',
            type: {
              kind: 'collection',
              name: 'list',
              itemTypes: [{ kind: 'primitive', name: 'str' }],
            },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'batch_size',
            type: { kind: 'primitive', name: 'int' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const result = generator.generateFunctionWrapper(performanceFunction, 'processing');
      const generatedCode = result.typescript;

      // Should use efficient patterns
      expect(generatedCode).toContain('async function batchProcess');
      expect(generatedCode).toContain('Promise<string[]>');

      // Should avoid performance anti-patterns
      expect(generatedCode).not.toContain('eval('); // No eval
      expect(generatedCode).not.toContain('new Function('); // No dynamic function creation
      expect(generatedCode).not.toMatch(/for\s*\(\s*var\s+/); // No var in loops
    });

    it('should measure bundle size impact of generated code', () => {
      // Simple function
      const simpleFunc: PythonFunction = {
        name: 'add',
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
            name: 'a',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'b',
            type: { kind: 'primitive', name: 'int' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      // Complex function
      const complexFunc: PythonFunction = {
        name: 'complex_calculation',
        signature: {
          parameters: [
            {
              name: 'data',
              type: {
                kind: 'collection',
                name: 'list',
                itemTypes: [{ kind: 'primitive', name: 'float' }],
              },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'method',
              type: { kind: 'primitive', name: 'str' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'precision',
              type: { kind: 'primitive', name: 'int' },
              optional: true,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'args',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: true,
              kwArgs: false,
            },
            {
              name: 'kwargs',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: false,
              kwArgs: true,
            },
          ],
          returnType: {
            kind: 'collection',
            name: 'dict',
            itemTypes: [
              { kind: 'primitive', name: 'str' },
              { kind: 'primitive', name: 'float' },
            ],
          },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'Perform complex calculations with various options',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: {
          kind: 'collection',
          name: 'dict',
          itemTypes: [
            { kind: 'primitive', name: 'str' },
            { kind: 'primitive', name: 'float' },
          ],
        },
        parameters: [
          {
            name: 'data',
            type: {
              kind: 'collection',
              name: 'list',
              itemTypes: [{ kind: 'primitive', name: 'float' }],
            },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'method',
            type: { kind: 'primitive', name: 'str' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'precision',
            type: { kind: 'primitive', name: 'int' },
            optional: true,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'args',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: true,
            kwArgs: false,
          },
          {
            name: 'kwargs',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: true,
          },
        ],
      };

      const simpleResult = generator.generateFunctionWrapper(simpleFunc, 'math');
      const complexResult = generator.generateFunctionWrapper(complexFunc, 'math');

      const simpleSize = simpleResult.typescript.length;
      const complexSize = complexResult.typescript.length;

      // Complex function should not be disproportionately larger
      const sizeRatio = complexSize / simpleSize;
      expect(sizeRatio).toBeLessThan(10); // Should be reasonable ratio

      // Both should be reasonably sized
      expect(simpleSize).toBeLessThan(1000);
      expect(complexSize).toBeLessThan(2000);
    });
  });
});
