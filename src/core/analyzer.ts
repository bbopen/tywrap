/**
 * PyAnalyzer - Python AST analysis and type extraction
 */

import type { SyntaxNode } from 'tree-sitter';
import Parser from 'tree-sitter';
import Python from 'tree-sitter-python';

import type {
  AnalysisResult,
  AnalysisError,
  AnalysisWarning,
  AnalysisStatistics,
  PythonModule,
  PythonFunction,
  PythonClass,
  PythonImport,
  PythonType,
  Parameter,
  Property,
  FunctionSignature,
} from '../types/index.js';
import { globalCache } from '../utils/cache.js';
import { getComponentLogger } from '../utils/logger.js';

const log = getComponentLogger('Analyzer');

const UNKNOWN_TYPE: PythonType = { kind: 'custom', name: 'Any', module: 'typing' };

export class PyAnalyzer {
  private parser: Parser;
  private initialized = false;

  constructor() {
    this.parser = new Parser();
  }

  /**
   * Initialize the tree-sitter parser with Python grammar
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      await this.parser.setLanguage(Python);
      this.initialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Python parser: ${error}`);
    }
  }

  /**
   * Analyze Python module source code and extract structure with caching
   */
  async analyzePythonModule(source: string, modulePath?: string): Promise<AnalysisResult> {
    await this.initialize();

    // Check cache first
    const cached = await globalCache.getCachedAnalysis(source, modulePath ?? 'unknown');
    if (cached) {
      return cached;
    }

    const startTime = performance.now();
    const errors: AnalysisError[] = [];
    const warnings: AnalysisWarning[] = [];
    const dependencies: string[] = [];

    try {
      const tree = this.parser.parse(source);
      const rootNode = tree.rootNode;

      // Check for syntax errors
      if (rootNode.hasError) {
        this.collectSyntaxErrors(rootNode, errors);
      }

      // Extract module components
      const functions = await this.extractFunctions(rootNode);
      const classes = await this.extractClasses(rootNode);
      const imports = this.extractImports(rootNode);

      // Collect dependencies from imports (deduplicated)
      const uniqueDependencies = [...new Set(imports.map(imp => imp.module))];
      dependencies.push(...uniqueDependencies);

      // Generate statistics
      const statistics = this.generateStatistics(functions, classes, source);

      const module: PythonModule = {
        name: this.extractModuleName(modulePath),
        path: modulePath,
        functions,
        classes,
        imports,
        exports: this.extractExports(rootNode),
      };

      const result = {
        module,
        errors,
        warnings,
        dependencies,
        statistics,
      };

      // Cache the successful result
      const computeTime = performance.now() - startTime;
      await globalCache.setCachedAnalysis(source, modulePath ?? 'unknown', result, computeTime);

      return result;
    } catch (error) {
      errors.push({
        type: 'syntax',
        message: `Failed to parse Python module: ${error}`,
        file: modulePath,
      });

      return {
        module: {
          name: this.extractModuleName(modulePath),
          path: modulePath,
          functions: [],
          classes: [],
          imports: [],
          exports: [],
        },
        errors,
        warnings,
        dependencies,
        statistics: this.generateStatistics([], [], source),
      };
    }
  }

  /**
   * Extract function definitions from AST
   */
  async extractFunctions(node: SyntaxNode): Promise<PythonFunction[]> {
    const functions: PythonFunction[] = [];

    const functionNodes = this.findDirectDefinitions(node, 'function_definition');

    for (const funcNode of functionNodes) {
      try {
        const func = await this.extractFunction(funcNode);
        functions.push(func);
      } catch (error) {
        log.warn('Failed to extract function', { error: String(error) });
      }
    }

    return functions;
  }

  /**
   * Extract class definitions from AST
   */
  async extractClasses(node: SyntaxNode): Promise<PythonClass[]> {
    const classes: PythonClass[] = [];

    const classNodes = this.findDirectDefinitions(node, 'class_definition');

    for (const classNode of classNodes) {
      try {
        const cls = await this.extractClass(classNode);
        classes.push(cls);
      } catch (error) {
        log.warn('Failed to extract class', { error: String(error) });
      }
    }

    return classes;
  }

  /**
   * Extract single function from function_definition node
   */
  private async extractFunction(node: SyntaxNode): Promise<PythonFunction> {
    const nameNode = node.childForFieldName('name');
    const parametersNode = node.childForFieldName('parameters');
    const returnTypeNode = node.childForFieldName('return_type');
    const bodyNode = node.childForFieldName('body');

    const name = nameNode?.text ?? 'unknown';
    const parameters = parametersNode ? this.extractParameters(parametersNode) : [];
    const returnType = returnTypeNode ? this.parseTypeAnnotation(returnTypeNode) : UNKNOWN_TYPE;

    // Extract decorators
    const decorators = this.extractDecorators(node);

    // Determine if async
    const isAsync = node.text.trimStart().startsWith('async def');

    // Check if generator (contains yield)
    const isGenerator = bodyNode ? this.containsYield(bodyNode) : false;

    // Extract docstring
    const docstring = bodyNode ? this.extractDocstring(bodyNode) : undefined;

    const signature: FunctionSignature = {
      parameters,
      returnType,
      isAsync,
      isGenerator,
    };

    return {
      name,
      signature,
      docstring,
      decorators,
      isAsync,
      isGenerator,
      returnType,
      parameters,
    };
  }

  /**
   * Extract single class from class_definition node
   */
  private async extractClass(node: SyntaxNode): Promise<PythonClass> {
    const nameNode = node.childForFieldName('name');
    const superclassesNode = node.childForFieldName('superclasses');
    const bodyNode = node.childForFieldName('body');

    const name = nameNode?.text ?? 'unknown';
    const bases = superclassesNode ? this.extractBases(superclassesNode) : [];

    const decorators = this.extractDecorators(node);
    const docstring = bodyNode ? this.extractDocstring(bodyNode) : undefined;

    // Extract methods and properties from body
    const methods: PythonFunction[] = [];
    const properties: Property[] = [];

    if (bodyNode) {
      const methodNodes = this.findDirectDefinitions(bodyNode, 'function_definition');
      for (const methodNode of methodNodes) {
        try {
          const method = await this.extractFunction(methodNode);
          methods.push(method);
        } catch (error) {
          log.warn('Failed to extract method', { error: String(error) });
        }
      }

      // Extract properties (assignments with type annotations or @property decorators)
      for (const stmt of bodyNode.namedChildren) {
        // Only consider class-body statements, never descend into method bodies.
        const assignmentNode =
          stmt.type === 'assignment'
            ? stmt
            : stmt.type === 'expression_statement'
              ? (stmt.namedChildren.find(c => c.type === 'assignment') ?? null)
              : null;
        if (!assignmentNode) {
          continue;
        }
        const prop = this.extractProperty(assignmentNode);
        if (prop) {
          properties.push(prop);
        }
      }
    }

    return {
      name,
      bases,
      methods,
      properties,
      docstring,
      decorators,
    };
  }

  /**
   * Extract function parameters from parameters node
   */
  private extractParameters(node: SyntaxNode): Parameter[] {
    const parameters: Parameter[] = [];

    // Handle different parameter types
    for (const child of node.namedChildren) {
      if (child.type === 'identifier') {
        // Simple parameter
        parameters.push({
          name: child.text,
          type: UNKNOWN_TYPE,
          optional: false,
          varArgs: false,
          kwArgs: false,
        });
      } else if (child.type === 'typed_parameter') {
        // Parameter with type annotation - check multiple possible field names
        const patternNode = child.childForFieldName('pattern');
        let nameNode = patternNode ?? child.child(0) ?? null;
        const typeFieldNode = child.childForFieldName('type');
        const typeNode = typeFieldNode ?? child.child(2) ?? null;

        // If pattern field doesn't exist, try to find identifier directly
        if (!nameNode || nameNode.type !== 'identifier') {
          nameNode = this.findNodesByType(child, 'identifier')[0] ?? null;
        }

        parameters.push({
          name: nameNode?.text ?? 'unknown',
          type: typeNode ? this.parseTypeAnnotation(typeNode) : UNKNOWN_TYPE,
          optional: false,
          varArgs: false,
          kwArgs: false,
        });
      } else if (child.type === 'default_parameter') {
        // Parameter with default value
        const nameFieldNode = child.childForFieldName('name');
        const nameNode = nameFieldNode ?? child.child(0) ?? null;
        let valueNode = child.childForFieldName('value') ?? null;

        // Find value node if field name doesn't work
        if (!valueNode) {
          const equalIndex = child.children.findIndex(c => c.text === '=');
          if (equalIndex >= 0 && equalIndex + 1 < child.children.length) {
            valueNode = child.children[equalIndex + 1] ?? null;
          }
        }

        parameters.push({
          name: nameNode?.text ?? 'unknown',
          type: UNKNOWN_TYPE,
          optional: true,
          defaultValue: valueNode?.text,
          varArgs: false,
          kwArgs: false,
        });
      } else if (child.type === 'typed_default_parameter') {
        // Parameter with type and default
        const patternNode = child.childForFieldName('pattern');
        let nameNode = patternNode ?? child.child(0) ?? null;
        let typeNode = child.childForFieldName('type') ?? null;
        let valueNode = child.childForFieldName('value') ?? null;

        // If pattern field doesn't exist, try to find identifier directly
        if (!nameNode || nameNode.type !== 'identifier') {
          nameNode = this.findNodesByType(child, 'identifier')[0] ?? null;
        }

        // Find type and value nodes if field names don't work
        if (!typeNode || !valueNode) {
          const colonIndex = child.children.findIndex(c => c.text === ':');
          const equalIndex = child.children.findIndex(c => c.text === '=');

          if (colonIndex >= 0 && colonIndex + 1 < child.children.length) {
            typeNode = child.children[colonIndex + 1] ?? null;
          }
          if (equalIndex >= 0 && equalIndex + 1 < child.children.length) {
            valueNode = child.children[equalIndex + 1] ?? null;
          }
        }

        parameters.push({
          name: nameNode?.text ?? 'unknown',
          type: typeNode ? this.parseTypeAnnotation(typeNode) : UNKNOWN_TYPE,
          optional: true,
          defaultValue: valueNode?.text,
          varArgs: false,
          kwArgs: false,
        });
      } else if (child.type === 'list_splat_pattern') {
        // *args parameter
        const nameNode = child.child(1); // Skip the *
        parameters.push({
          name: nameNode?.text ?? 'args',
          type: { kind: 'collection', name: 'tuple', itemTypes: [] },
          optional: false,
          varArgs: true,
          kwArgs: false,
        });
      } else if (child.type === 'dictionary_splat_pattern') {
        // **kwargs parameter
        const nameNode = child.child(1); // Skip the **
        parameters.push({
          name: nameNode?.text ?? 'kwargs',
          type: { kind: 'collection', name: 'dict', itemTypes: [] },
          optional: false,
          varArgs: false,
          kwArgs: true,
        });
      }
    }

    return parameters;
  }

  /**
   * Parse type annotation node into PythonType
   */
  parseTypeAnnotation(node: SyntaxNode): PythonType {
    const typeText = node.text.trim();

    // Handle primitive types
    const primitiveTypes = ['int', 'float', 'str', 'bool', 'bytes', 'None'] as const;
    if (primitiveTypes.includes(typeText as (typeof primitiveTypes)[number])) {
      return {
        kind: 'primitive',
        name: typeText as 'int' | 'float' | 'str' | 'bool' | 'bytes' | 'None',
      };
    }

    // Handle collection types
    const collectionTypes = [
      'dict',
      'Dict',
      'list',
      'List',
      'tuple',
      'Tuple',
      'set',
      'Set',
    ] as const;
    if (collectionTypes.includes(typeText as (typeof collectionTypes)[number])) {
      const normalizedName =
        typeText.toLowerCase() === 'dict' || typeText === 'Dict'
          ? 'dict'
          : typeText.toLowerCase() === 'list' || typeText === 'List'
            ? 'list'
            : typeText.toLowerCase() === 'tuple' || typeText === 'Tuple'
              ? 'tuple'
              : typeText.toLowerCase() === 'set' || typeText === 'Set'
                ? 'set'
                : 'dict';
      return { kind: 'collection', name: normalizedName, itemTypes: [] };
    }

    // Handle List, Dict, etc.
    if (typeText.startsWith('List[') || typeText.startsWith('list[')) {
      return this.parseGenericType(typeText, 'list');
    }
    if (typeText.startsWith('Dict[') || typeText.startsWith('dict[')) {
      return this.parseGenericType(typeText, 'dict');
    }
    if (typeText.startsWith('Tuple[') || typeText.startsWith('tuple[')) {
      return this.parseGenericType(typeText, 'tuple');
    }
    if (typeText.startsWith('Set[') || typeText.startsWith('set[')) {
      return this.parseGenericType(typeText, 'set');
    }

    // Handle Union types
    if (typeText.includes(' | ') || typeText.startsWith('Union[')) {
      return this.parseUnionType(typeText);
    }

    // Handle Optional
    if (typeText.startsWith('Optional[')) {
      const innerType = typeText.slice(9, -1);
      const parsedInnerType = this.parseTypeAnnotation({ text: innerType } as SyntaxNode);

      // For Optional[Dict] -> ensure Dict is treated as collection, not custom
      if (innerType === 'Dict' || innerType === 'dict') {
        return {
          kind: 'optional',
          type: { kind: 'collection', name: 'dict', itemTypes: [] },
        };
      }

      return {
        kind: 'optional',
        type: parsedInnerType,
      };
    }

    // Custom/module type - clean up quotes
    let cleanedName = typeText;
    if (
      (cleanedName.startsWith("'") && cleanedName.endsWith("'")) ||
      (cleanedName.startsWith('"') && cleanedName.endsWith('"'))
    ) {
      cleanedName = cleanedName.slice(1, -1);
    }

    return {
      kind: 'custom',
      name: cleanedName,
    };
  }

  private parseGenericType(
    typeText: string,
    collectionName: 'list' | 'dict' | 'tuple' | 'set'
  ): PythonType {
    const bracketStart = typeText.indexOf('[');
    const bracketEnd = typeText.lastIndexOf(']');

    if (bracketStart === -1 || bracketEnd === -1) {
      return { kind: 'collection', name: collectionName, itemTypes: [] };
    }

    const genericPart = typeText.slice(bracketStart + 1, bracketEnd);
    const itemTypes = this.parseGenericArguments(genericPart);

    return {
      kind: 'collection',
      name: collectionName,
      itemTypes,
    };
  }

  private parseUnionType(typeText: string): PythonType {
    let unionPart: string;

    if (typeText.startsWith('Union[')) {
      unionPart = typeText.slice(6, -1);
    } else {
      unionPart = typeText;
    }

    const types = this.parseGenericArguments(unionPart);
    return { kind: 'union', types };
  }

  private parseGenericArguments(argsText: string): PythonType[] {
    // Nested-aware argument splitter for generics (handles [] and ())
    const results: string[] = [];
    let depthSquare = 0;
    let depthParen = 0;
    let current = '';
    for (let i = 0; i < argsText.length; i++) {
      const ch = String(argsText.charAt(i));
      if (ch === '[') {
        depthSquare++;
      }
      if (ch === ']') {
        depthSquare = Math.max(0, depthSquare - 1);
      }
      if (ch === '(') {
        depthParen++;
      }
      if (ch === ')') {
        depthParen = Math.max(0, depthParen - 1);
      }
      if (ch === ',' && depthSquare === 0 && depthParen === 0) {
        results.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim().length > 0) {
      results.push(current.trim());
    }
    return results.map(arg => this.parseTypeAnnotation({ text: arg } as SyntaxNode));
  }

  /**
   * Extract import statements
   */
  private extractImports(node: SyntaxNode): PythonImport[] {
    const imports: PythonImport[] = [];
    const seen = new Set<string>();

    // Only look for import statements at the module level (not nested)
    const moduleChildren = node.namedChildren;
    const importNodes: SyntaxNode[] = [];

    for (const child of moduleChildren) {
      if (child.type === 'import_statement' || child.type === 'import_from_statement') {
        importNodes.push(child);
      }
    }

    for (const importNode of importNodes) {
      if (importNode.type === 'import_statement') {
        // import module [as alias]
        const nameNode = importNode.child(1);
        if (nameNode && (nameNode.type === 'dotted_name' || nameNode.type === 'aliased_import')) {
          let moduleName: string | undefined;
          if (nameNode.type === 'aliased_import') {
            // Handle 'import module as alias' - extract module name before 'as'
            const parts = nameNode.text.split(' as ');
            const firstPart = parts[0];
            if (firstPart) {
              moduleName = firstPart.split('.')[0]; // Get base module name
            }
          } else {
            // Handle 'import module' - extract module name
            moduleName = nameNode.text.split('.')[0]; // Get base module name
          }

          if (moduleName) {
            const key = `${moduleName}:import`;
            if (!seen.has(key)) {
              seen.add(key);
              imports.push({
                module: moduleName,
                fromImport: false,
              });
            }
          }
        }
      } else if (importNode.type === 'import_from_statement') {
        // from module import name [as alias]
        const moduleNameIndex = importNode.children.findIndex(c => c.text === 'from');
        const importIndex = importNode.children.findIndex(c => c.text === 'import');
        if (moduleNameIndex >= 0 && importIndex > moduleNameIndex) {
          const moduleNode = importNode.children[moduleNameIndex + 1];

          if (moduleNode && moduleNode.type === 'dotted_name') {
            const moduleName = moduleNode.text.split('.')[0];

            if (moduleName) {
              // Collect all import names after the 'import' keyword
              const importNames: string[] = [];

              for (let i = importIndex + 1; i < importNode.children.length; i++) {
                const child = importNode.children.at(i);
                if (child && (child.type === 'dotted_name' || child.type === 'identifier')) {
                  importNames.push(child.text);
                } else if (child && child.type === 'wildcard_import') {
                  importNames.push('*');
                }
                // Skip comma separators
              }

              // Create separate import entries for each imported name
              for (const importName of importNames) {
                const key = `${moduleName}:${importName}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  imports.push({
                    module: moduleName,
                    name: importName,
                    fromImport: true,
                  });
                }
              }
            }
          }
        }
      }
    }

    return imports;
  }

  /**
   * Utility methods
   */
  private findNodesByType(node: SyntaxNode, type: string): SyntaxNode[] {
    const results: SyntaxNode[] = [];
    const stack: SyntaxNode[] = [node];
    while (stack.length > 0) {
      const n = stack.pop();
      if (!n) {
        break;
      }
      if (n.type === type) {
        results.push(n);
      }
      for (let i = n.children.length - 1; i >= 0; i--) {
        const child = n.children[i];
        if (child) {
          stack.push(child);
        }
      }
    }
    return results;
  }

  private findDirectDefinitions(
    node: SyntaxNode,
    type: 'function_definition' | 'class_definition'
  ): SyntaxNode[] {
    const out: SyntaxNode[] = [];
    for (const child of node.namedChildren) {
      if (child.type === type) {
        out.push(child);
        continue;
      }
      if (child.type === 'decorated_definition') {
        const def = child.namedChildren.find(c => c.type === type) ?? null;
        if (def) {
          out.push(def);
        }
      }
    }
    return out;
  }

  private extractModuleName(path?: string): string {
    if (!path) {
      return 'unknown';
    }
    const parts = path.split('/').pop()?.replace('.py', '') ?? 'unknown';
    return parts;
  }

  private extractDecorators(node: SyntaxNode): string[] {
    const decorators: string[] = [];

    // Look for decorated_definition parent
    if (node.parent?.type === 'decorated_definition') {
      const decoratorNodes = this.findNodesByType(node.parent, 'decorator');
      decorators.push(...decoratorNodes.map(d => d.text));
    }

    return decorators;
  }

  private extractDocstring(bodyNode: SyntaxNode): string | undefined {
    // First statement in body might be a string (docstring)
    const firstChild = bodyNode.namedChildren[0];
    if (firstChild?.type === 'expression_statement') {
      const expr = firstChild.child(0);
      if (expr?.type === 'string') {
        let docstring = expr.text;
        // Strip docstring prefixes like r/u/f/b and combos (rf/fr/br/...).
        docstring = docstring.replace(/^(?:[rRuUbBfF]{1,3})(?=(\"\"\"|'''|\"|'))/, '');
        // Remove outer quotes and any remaining inner quotes
        if (docstring.startsWith('"""') && docstring.endsWith('"""')) {
          docstring = docstring.slice(3, -3);
        } else if (docstring.startsWith("'''") && docstring.endsWith("'''")) {
          docstring = docstring.slice(3, -3);
        } else if (docstring.startsWith('"') && docstring.endsWith('"')) {
          docstring = docstring.slice(1, -1);
        } else if (docstring.startsWith("'") && docstring.endsWith("'")) {
          docstring = docstring.slice(1, -1);
        }
        return docstring.trim();
      }
    }
    return undefined;
  }

  private containsYield(node: SyntaxNode): boolean {
    const yieldNodes = this.findNodesByType(node, 'yield');
    return yieldNodes.length > 0;
  }

  private extractBases(node: SyntaxNode): string[] {
    const bases: string[] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'identifier') {
        bases.push(child.text);
      }
    }
    return bases;
  }

  private extractProperty(node: SyntaxNode): Property | null {
    // Simple property extraction from assignments
    const leftNode = node.child(0);
    if (leftNode?.type === 'identifier') {
      return {
        name: leftNode.text,
        type: UNKNOWN_TYPE,
        readonly: false,
      };
    }
    return null;
  }

  private extractExports(node: SyntaxNode): string[] {
    // Look for __all__ definition
    const assignments = this.findNodesByType(node, 'assignment');
    for (const assignment of assignments) {
      const leftNode = assignment.child(0);
      if (leftNode?.text === '__all__') {
        const rightNode = assignment.child(2);
        if (rightNode?.type === 'list') {
          return rightNode.namedChildren
            .filter(child => child.type === 'string')
            .map(child => child.text.slice(1, -1)); // Remove quotes
        }
      }
    }
    return [];
  }

  private collectSyntaxErrors(node: SyntaxNode, errors: AnalysisError[]): void {
    if (node.hasError) {
      errors.push({
        type: 'syntax',
        message: 'Syntax error in Python code',
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1,
      });
    }

    for (const child of node.children) {
      this.collectSyntaxErrors(child, errors);
    }
  }

  private generateStatistics(
    functions: PythonFunction[],
    classes: PythonClass[],
    source: string
  ): AnalysisStatistics {
    // Count only module-level functions, not class methods in the main count
    const totalFunctions = functions.length;
    const totalClasses = classes.length;

    // Simple type hint coverage calculation
    const functionsWithTypes = functions.filter(
      f =>
        f.parameters.some(p => p.type.kind !== 'primitive' || p.type.name !== 'None') ||
        f.returnType.kind !== 'primitive' ||
        f.returnType.name !== 'None'
    ).length;

    const typeHintsCoverage = totalFunctions > 0 ? (functionsWithTypes / totalFunctions) * 100 : 0;

    return {
      functionsAnalyzed: totalFunctions,
      classesAnalyzed: totalClasses,
      typeHintsCoverage,
      estimatedComplexity: Math.min(source.length / 1000, 10), // Simple complexity estimate
    };
  }
}
