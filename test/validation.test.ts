/**
 * ValidationEngine Test Suite
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationEngine } from '../src/core/validation.js';
import type { PythonFunction, PythonClass, PythonType } from '../src/types/index.js';

describe('ValidationEngine', () => {
  let validator: ValidationEngine;

  beforeEach(() => {
    validator = new ValidationEngine();
  });

  describe('Function Validation', () => {
    it('should validate well-typed function without issues', () => {
      const func: PythonFunction = {
        name: 'add_numbers',
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
        docstring: 'Add two integers together.',
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
      };

      const report = validator.validateFunction(func);

      expect(report.errors).toHaveLength(0);
      expect(report.warnings).toHaveLength(0);
      expect(report.statistics.qualityScore).toBeGreaterThan(80);
    });

    it('should warn about missing type hints', () => {
      const func: PythonFunction = {
        name: 'untyped_function',
        signature: {
          parameters: [
            {
              name: 'x',
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
            name: 'x',
            type: { kind: 'primitive', name: 'None' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const report = validator.validateFunction(func);

      expect(report.warnings.length).toBeGreaterThan(0);
      const typeWarnings = report.warnings.filter(w => w.type === 'missing-type');
      expect(typeWarnings.length).toBeGreaterThan(0);
    });

    it('should warn about missing docstring', () => {
      const func: PythonFunction = {
        name: 'undocumented_function',
        signature: {
          parameters: [],
          returnType: { kind: 'primitive', name: 'str' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: undefined,
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'str' },
        parameters: [],
      };

      // Enable required docstrings
      const strictValidator = new ValidationEngine({ requiredDocstrings: true });
      const report = strictValidator.validateFunction(func);

      const docWarnings = report.warnings.filter(w => w.message.includes('missing docstring'));
      expect(docWarnings.length).toBeGreaterThan(0);
    });

    it('should warn about too many parameters', () => {
      const manyParams = Array.from({ length: 10 }, (_, i) => ({
        name: `param${i}`,
        type: { kind: 'primitive', name: 'str' } as PythonType,
        optional: false,
        varArgs: false,
        kwArgs: false,
      }));

      const func: PythonFunction = {
        name: 'complex_function',
        signature: {
          parameters: manyParams,
          returnType: { kind: 'primitive', name: 'None' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'A complex function with many parameters.',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'None' },
        parameters: manyParams,
      };

      const report = validator.validateFunction(func);

      const performanceWarnings = report.warnings.filter(w => w.type === 'performance');
      expect(performanceWarnings.some(w => w.message.includes('too many parameters'))).toBe(true);
    });

    it('should warn about single-letter parameter names', () => {
      const func: PythonFunction = {
        name: 'bad_naming',
        signature: {
          parameters: [
            {
              name: 'a',
              type: { kind: 'primitive', name: 'str' },
              optional: false,
              varArgs: false,
              kwArgs: false,
            },
            {
              name: 'b',
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
        docstring: 'Function with poor parameter naming.',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'str' },
        parameters: [
          {
            name: 'a',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
          {
            name: 'b',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const report = validator.validateFunction(func);

      const namingWarnings = report.warnings.filter(w =>
        w.message.includes('more descriptive name')
      );
      expect(namingWarnings.length).toBeGreaterThan(0);
    });
  });

  describe('Class Validation', () => {
    it('should validate well-structured class', () => {
      const cls: PythonClass = {
        name: 'Calculator',
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
              ],
              returnType: { kind: 'primitive', name: 'None' },
              isAsync: false,
              isGenerator: false,
            },
            docstring: 'Initialize calculator.',
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
            docstring: 'Add two numbers.',
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
              {
                name: 'y',
                type: { kind: 'primitive', name: 'int' },
                optional: false,
                varArgs: false,
                kwArgs: false,
              },
            ],
          },
        ],
        properties: [],
        docstring: 'A simple calculator class.',
        decorators: [],
      };

      const report = validator.validateClass(cls);

      expect(report.errors).toHaveLength(0);
      expect(report.statistics.qualityScore).toBeGreaterThan(70);
    });

    it('should warn about empty classes', () => {
      const cls: PythonClass = {
        name: 'EmptyClass',
        bases: [],
        methods: [],
        properties: [],
        docstring: undefined,
        decorators: [],
      };

      const report = validator.validateClass(cls);

      const emptyClassWarnings = report.warnings.filter(w =>
        w.message.includes('appears to be empty')
      );
      expect(emptyClassWarnings).toHaveLength(1);
    });

    it('should warn about multiple inheritance', () => {
      const cls: PythonClass = {
        name: 'MultipleInheritance',
        bases: ['Base1', 'Base2', 'Base3'],
        methods: [],
        properties: [],
        docstring: 'Class with multiple inheritance.',
        decorators: [],
      };

      const report = validator.validateClass(cls);

      const inheritanceWarnings = report.warnings.filter(w =>
        w.message.includes('multiple inheritance')
      );
      expect(inheritanceWarnings).toHaveLength(1);
    });

    it('should warn about missing __init__ with properties', () => {
      const cls: PythonClass = {
        name: 'NoInitClass',
        bases: [],
        methods: [],
        properties: [{ name: 'value', type: { kind: 'primitive', name: 'int' }, readonly: false }],
        docstring: 'Class with properties but no __init__.',
        decorators: [],
      };

      const report = validator.validateClass(cls);

      const initWarnings = report.warnings.filter(w => w.message.includes('no __init__ method'));
      expect(initWarnings).toHaveLength(1);
    });
  });

  describe('Type Annotation Validation', () => {
    it('should validate primitive types', () => {
      const intType: PythonType = { kind: 'primitive', name: 'int' };
      const errors = validator.validateTypeAnnotation(intType);

      expect(errors).toHaveLength(0);
    });

    it('should validate collection types', () => {
      const listType: PythonType = {
        kind: 'collection',
        name: 'list',
        itemTypes: [{ kind: 'primitive', name: 'str' }],
      };
      const errors = validator.validateTypeAnnotation(listType);

      expect(errors).toHaveLength(0);
    });

    it('should error on empty collection types', () => {
      const emptyListType: PythonType = {
        kind: 'collection',
        name: 'list',
        itemTypes: [],
      };
      const errors = validator.validateTypeAnnotation(emptyListType);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('should specify item types');
    });

    it('should validate union types', () => {
      const unionType: PythonType = {
        kind: 'union',
        types: [
          { kind: 'primitive', name: 'str' },
          { kind: 'primitive', name: 'int' },
        ],
      };
      const errors = validator.validateTypeAnnotation(unionType);

      expect(errors).toHaveLength(0);
    });

    it('should error on single-type unions', () => {
      const singleUnionType: PythonType = {
        kind: 'union',
        types: [{ kind: 'primitive', name: 'str' }],
      };
      const errors = validator.validateTypeAnnotation(singleUnionType);

      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toContain('should have at least 2 types');
    });

    it('should validate optional types', () => {
      const optionalType: PythonType = {
        kind: 'optional',
        type: { kind: 'primitive', name: 'str' },
      };
      const errors = validator.validateTypeAnnotation(optionalType);

      expect(errors).toHaveLength(0);
    });

    it('should validate nested complex types', () => {
      const complexType: PythonType = {
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
      };
      const errors = validator.validateTypeAnnotation(complexType);

      expect(errors).toHaveLength(0);
    });
  });

  describe('Recommendations Generation', () => {
    it('should recommend async for I/O functions', () => {
      const ioFunc: PythonFunction = {
        name: 'read_file',
        signature: {
          parameters: [
            {
              name: 'path',
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
        docstring: 'Read file contents.',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'str' },
        parameters: [
          {
            name: 'path',
            type: { kind: 'primitive', name: 'str' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const report = validator.validateFunction(ioFunc);

      const asyncRecommendations = report.recommendations.filter(r => r.message.includes('async'));
      expect(asyncRecommendations.length).toBeGreaterThan(0);
    });

    it('should recommend type hints for untyped functions', () => {
      const untypedFunc: PythonFunction = {
        name: 'process_data',
        signature: {
          parameters: [
            {
              name: 'data',
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
        docstring: 'Process some data.',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'None' },
        parameters: [
          {
            name: 'data',
            type: { kind: 'primitive', name: 'None' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const report = validator.validateFunction(untypedFunc);

      const typeRecommendations = report.recommendations.filter(r => r.type === 'type-safety');
      expect(typeRecommendations.length).toBeGreaterThan(0);
    });

    it('should recommend docstrings for undocumented functions', () => {
      const undocumentedFunc: PythonFunction = {
        name: 'calculate',
        signature: {
          parameters: [
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
        ],
      };

      const report = validator.validateFunction(undocumentedFunc);

      const docRecommendations = report.recommendations.filter(r => r.type === 'documentation');
      expect(docRecommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Quality Scoring', () => {
    it('should give high score to well-written functions', () => {
      const goodFunc: PythonFunction = {
        name: 'calculate_mean',
        signature: {
          parameters: [
            {
              name: 'values',
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
          returnType: { kind: 'primitive', name: 'float' },
          isAsync: false,
          isGenerator: false,
        },
        docstring: 'Calculate the arithmetic mean of a list of values.',
        decorators: [],
        isAsync: false,
        isGenerator: false,
        returnType: { kind: 'primitive', name: 'float' },
        parameters: [
          {
            name: 'values',
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
      };

      const report = validator.validateFunction(goodFunc);

      expect(report.statistics.qualityScore).toBeGreaterThan(90);
    });

    it('should give lower score to poorly written functions', () => {
      const badFunc: PythonFunction = {
        name: 'f',
        signature: {
          parameters: [
            {
              name: 'a',
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
            name: 'a',
            type: { kind: 'primitive', name: 'None' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const report = validator.validateFunction(badFunc);

      expect(report.statistics.qualityScore).toBeLessThan(60);
    });
  });

  describe('Configuration Modes', () => {
    it('should enforce strict type checking when enabled', () => {
      const strictValidator = new ValidationEngine({
        strictTypeChecking: true,
        allowMissingTypeHints: false,
      });

      const untypedFunc: PythonFunction = {
        name: 'untyped',
        signature: {
          parameters: [
            {
              name: 'x',
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
            name: 'x',
            type: { kind: 'primitive', name: 'None' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const report = strictValidator.validateFunction(untypedFunc);

      expect(report.errors.length).toBeGreaterThan(0);
      expect(report.errors.some(e => e.type === 'type')).toBe(true);
    });

    it('should allow missing type hints in permissive mode', () => {
      const permissiveValidator = new ValidationEngine({
        strictTypeChecking: false,
        allowMissingTypeHints: true,
      });

      const untypedFunc: PythonFunction = {
        name: 'untyped',
        signature: {
          parameters: [
            {
              name: 'x',
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
            name: 'x',
            type: { kind: 'primitive', name: 'None' },
            optional: false,
            varArgs: false,
            kwArgs: false,
          },
        ],
      };

      const report = permissiveValidator.validateFunction(untypedFunc);

      expect(report.errors).toHaveLength(0);
      // Should still have warnings though
      expect(report.warnings.length).toBeGreaterThan(0);
    });
  });
});
