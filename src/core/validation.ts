/**
 * Error Handling & Validation Framework
 *
 * Comprehensive error handling, syntax validation, and analysis reporting system
 */

import type {
  AnalysisError,
  AnalysisWarning,
  // AnalysisStatistics,
  PythonFunction,
  PythonClass,
  PythonType,
} from '../types/index.js';

export interface ValidationConfig {
  strictTypeChecking: boolean;
  allowMissingTypeHints: boolean;
  maxComplexityScore: number;
  deprecatedPatterns: string[];
  requiredDocstrings: boolean;
}

export interface ValidationReport {
  errors: AnalysisError[];
  warnings: AnalysisWarning[];
  statistics: ValidationStatistics;
  recommendations: ValidationRecommendation[];
}

export interface ValidationStatistics {
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  typeHintCoverage: number;
  docstringCoverage: number;
  complexityScore: number;
  qualityScore: number; // 0-100
}

export interface ValidationRecommendation {
  type: 'performance' | 'maintainability' | 'type-safety' | 'documentation';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  suggestion: string;
  file?: string;
  line?: number;
  impact: string;
}

export class ValidationEngine {
  private config: ValidationConfig;

  constructor(config: Partial<ValidationConfig> = {}) {
    this.config = {
      strictTypeChecking: config.strictTypeChecking ?? true,
      allowMissingTypeHints: config.allowMissingTypeHints ?? false,
      maxComplexityScore: 10,
      deprecatedPatterns: [],
      requiredDocstrings: false,
      ...config,
    };
  }

  /**
   * Validate Python functions for type safety and best practices
   */
  validateFunction(func: PythonFunction, filePath?: string): ValidationReport {
    const errors: AnalysisError[] = [];
    const warnings: AnalysisWarning[] = [];
    const recommendations: ValidationRecommendation[] = [];

    // Check type hints
    this.validateTypeHints(func, errors, warnings);

    // Check docstring
    this.validateDocstring(func, warnings, filePath);

    // Check parameter patterns
    this.validateParameters(func, warnings, filePath);

    // Check for deprecated patterns
    this.validateDeprecatedPatterns(func, warnings, filePath);

    // Check complexity
    this.validateComplexity(func, warnings, filePath);

    // Generate recommendations
    this.generateFunctionRecommendations(func, recommendations, filePath);

    const statistics = this.calculateFunctionStatistics(func, errors, warnings);

    return {
      errors,
      warnings,
      statistics,
      recommendations,
    };
  }

  /**
   * Validate Python classes for structure and best practices
   */
  validateClass(cls: PythonClass, filePath?: string): ValidationReport {
    const errors: AnalysisError[] = [];
    const warnings: AnalysisWarning[] = [];
    const recommendations: ValidationRecommendation[] = [];

    // Validate each method
    for (const method of cls.methods) {
      const methodReport = this.validateFunction(method, filePath);
      errors.push(...methodReport.errors);
      warnings.push(...methodReport.warnings);
      recommendations.push(...methodReport.recommendations);
    }

    // Validate class-specific patterns
    this.validateClassStructure(cls, warnings, filePath);
    this.validateInheritance(cls, warnings, filePath);

    const statistics = this.calculateClassStatistics(cls, errors, warnings);

    return {
      errors,
      warnings,
      statistics,
      recommendations,
    };
  }

  /**
   * Validate type annotations for correctness
   */
  validateTypeAnnotation(type: PythonType, context: string = ''): AnalysisError[] {
    const errors: AnalysisError[] = [];

    try {
      this.validateTypeStructure(type, errors, context);
    } catch (error) {
      errors.push({
        type: 'type',
        message: `Type validation failed: ${error}`,
      });
    }

    return errors;
  }

  /**
   * Generate comprehensive analysis report
   */
  generateReport(
    functions: PythonFunction[],
    classes: PythonClass[],
    filePath?: string
  ): ValidationReport {
    const errors: AnalysisError[] = [];
    const warnings: AnalysisWarning[] = [];
    const recommendations: ValidationRecommendation[] = [];

    // Validate all functions
    for (const func of functions) {
      const funcReport = this.validateFunction(func, filePath);
      errors.push(...funcReport.errors);
      warnings.push(...funcReport.warnings);
      recommendations.push(...funcReport.recommendations);
    }

    // Validate all classes
    for (const cls of classes) {
      const classReport = this.validateClass(cls, filePath);
      errors.push(...classReport.errors);
      warnings.push(...classReport.warnings);
      recommendations.push(...classReport.recommendations);
    }

    // Generate module-level recommendations
    this.generateModuleRecommendations(functions, classes, recommendations, filePath);

    const statistics = this.calculateModuleStatistics(functions, classes, errors, warnings);

    return {
      errors,
      warnings,
      statistics,
      recommendations,
    };
  }

  /**
   * Private validation methods
   */
  private validateTypeHints(
    func: PythonFunction,
    errors: AnalysisError[],
    warnings: AnalysisWarning[]
  ): void {
    // Check return type (skip __init__ methods as they conventionally don't need return type annotations)
    if (this.isEmptyType(func.returnType) && func.name !== '__init__') {
      if (this.config.allowMissingTypeHints) {
        warnings.push({
          type: 'missing-type',
          message: `Function '${func.name}' is missing return type annotation`,
        });
      } else if (this.config.strictTypeChecking) {
        // In strict mode without allowMissingTypeHints, we warn first then error
        warnings.push({
          type: 'missing-type',
          message: `Function '${func.name}' is missing return type annotation`,
        });
        errors.push({
          type: 'type',
          message: `Function '${func.name}' requires return type annotation`,
        });
      }
    }

    // Check parameter types (skip 'self' and 'cls' parameters)
    for (const param of func.parameters) {
      if (this.isEmptyType(param.type) && param.name !== 'self' && param.name !== 'cls') {
        if (this.config.allowMissingTypeHints) {
          warnings.push({
            type: 'missing-type',
            message: `Parameter '${param.name}' in function '${func.name}' is missing type annotation`,
          });
        } else if (this.config.strictTypeChecking) {
          // In strict mode without allowMissingTypeHints, we warn first then error
          warnings.push({
            type: 'missing-type',
            message: `Parameter '${param.name}' in function '${func.name}' is missing type annotation`,
          });
          errors.push({
            type: 'type',
            message: `Parameter '${param.name}' in function '${func.name}' requires type annotation`,
          });
        }
      }

      // Validate type structure only in strict mode (skip 'self' and 'cls' parameters)
      if (
        this.config.strictTypeChecking &&
        !this.config.allowMissingTypeHints &&
        param.name !== 'self' &&
        param.name !== 'cls'
      ) {
        const typeErrors = this.validateTypeAnnotation(param.type, `parameter '${param.name}'`);
        errors.push(...typeErrors);
      }
    }

    // Validate return type structure only in strict mode
    if (this.config.strictTypeChecking && !this.config.allowMissingTypeHints) {
      const returnTypeErrors = this.validateTypeAnnotation(func.returnType, 'return type');
      errors.push(...returnTypeErrors);
    }
  }

  private validateDocstring(
    func: PythonFunction,
    warnings: AnalysisWarning[],
    filePath?: string
  ): void {
    if (this.config.requiredDocstrings && !func.docstring) {
      warnings.push({
        type: 'missing-type',
        message: `Function '${func.name}' is missing docstring`,
        file: filePath,
      });
    }

    // Check docstring quality
    if (func.docstring && func.docstring.length < 10) {
      warnings.push({
        type: 'missing-type',
        message: `Function '${func.name}' has very short docstring`,
        file: filePath,
      });
    }
  }

  private validateParameters(
    func: PythonFunction,
    warnings: AnalysisWarning[],
    filePath?: string
  ): void {
    // Check for too many parameters
    if (func.parameters.length > 8) {
      warnings.push({
        type: 'performance',
        message: `Function '${func.name}' has too many parameters (${func.parameters.length})`,
        file: filePath,
      });
    }

    // Check parameter naming
    for (const param of func.parameters) {
      if (param.name.length < 2 && !['x', 'y', 'z', 'i', 'j', 'k'].includes(param.name)) {
        warnings.push({
          type: 'missing-type',
          message: `Parameter '${param.name}' in function '${func.name}' should have a more descriptive name`,
          file: filePath,
        });
      }
    }
  }

  private validateDeprecatedPatterns(
    func: PythonFunction,
    warnings: AnalysisWarning[],
    filePath?: string
  ): void {
    for (const pattern of this.config.deprecatedPatterns) {
      if (func.name.includes(pattern)) {
        warnings.push({
          type: 'deprecated',
          message: `Function '${func.name}' uses deprecated pattern '${pattern}'`,
          file: filePath,
        });
      }
    }
  }

  private validateComplexity(
    func: PythonFunction,
    warnings: AnalysisWarning[],
    filePath?: string
  ): void {
    // Simple complexity estimation based on parameters and async/generator flags
    let complexity = func.parameters.length * 0.5;
    if (func.isAsync) {
      complexity += 1;
    }
    if (func.isGenerator) {
      complexity += 1;
    }
    if (func.decorators.length > 0) {
      complexity += func.decorators.length * 0.5;
    }

    if (complexity > this.config.maxComplexityScore) {
      warnings.push({
        type: 'performance',
        message: `Function '${func.name}' has high complexity (${complexity.toFixed(1)})`,
        file: filePath,
      });
    }
  }

  private validateClassStructure(
    cls: PythonClass,
    warnings: AnalysisWarning[],
    filePath?: string
  ): void {
    // Check for empty classes
    if (cls.methods.length === 0 && cls.properties.length === 0) {
      warnings.push({
        type: 'missing-type',
        message: `Class '${cls.name}' appears to be empty`,
        file: filePath,
      });
    }

    // Check for missing __init__ method
    const hasInit = cls.methods.some(method => method.name === '__init__');
    if (!hasInit && cls.properties.length > 0) {
      warnings.push({
        type: 'missing-type',
        message: `Class '${cls.name}' has properties but no __init__ method`,
        file: filePath,
      });
    }
  }

  private validateInheritance(
    cls: PythonClass,
    warnings: AnalysisWarning[],
    filePath?: string
  ): void {
    // Check for deep inheritance chains
    if (cls.bases.length > 3) {
      warnings.push({
        type: 'compatibility',
        message: `Class '${cls.name}' inherits from many classes (${cls.bases.length})`,
        file: filePath,
      });
    }

    // Check for diamond inheritance pattern
    if (cls.bases.length > 1) {
      warnings.push({
        type: 'compatibility',
        message: `Class '${cls.name}' uses multiple inheritance, consider composition`,
        file: filePath,
      });
    }
  }

  private validateTypeStructure(type: PythonType, errors: AnalysisError[], context: string): void {
    switch (type.kind) {
      case 'union':
        if (type.types.length < 2) {
          errors.push({
            type: 'type',
            message: `Union type in ${context} should have at least 2 types`,
          });
        }
        // Recursively validate union member types
        for (const unionType of type.types) {
          this.validateTypeStructure(unionType, errors, context);
        }
        break;

      case 'collection':
        if (type.itemTypes.length === 0 && ['list', 'dict', 'set'].includes(type.name)) {
          errors.push({
            type: 'type',
            message: `Collection type '${type.name}' in ${context} should specify item types`,
          });
        }
        // Recursively validate item types
        for (const itemType of type.itemTypes) {
          this.validateTypeStructure(itemType, errors, context);
        }
        break;

      case 'optional':
        this.validateTypeStructure(type.type, errors, context);
        break;

      case 'generic':
        // Validate generic arguments
        for (const arg of type.typeArgs) {
          this.validateTypeStructure(arg, errors, context);
        }
        break;

      case 'custom':
        // Could add checks for known custom types
        break;

      case 'primitive':
        // Basic types are always valid
        break;
    }
  }

  private isEmptyType(type: PythonType): boolean {
    return type.kind === 'primitive' && type.name === 'None';
  }

  private generateFunctionRecommendations(
    func: PythonFunction,
    recommendations: ValidationRecommendation[],
    filePath?: string
  ): void {
    // Recommend async for I/O operations
    if (
      (!func.isAsync && func.name.includes('read')) ||
      func.name.includes('write') ||
      func.name.includes('fetch')
    ) {
      recommendations.push({
        type: 'performance',
        severity: 'medium',
        message: `Consider making '${func.name}' async for I/O operations`,
        suggestion: `Add 'async def' instead of 'def' and use await for I/O operations`,
        file: filePath,
        impact: 'Improved performance for I/O-bound operations',
      });
    }

    // Recommend type hints if missing
    if (func.parameters.some(p => this.isEmptyType(p.type)) || this.isEmptyType(func.returnType)) {
      recommendations.push({
        type: 'type-safety',
        severity: 'high',
        message: `Add type hints to '${func.name}' for better IDE support`,
        suggestion: 'Add type annotations to parameters and return type',
        file: filePath,
        impact: 'Better IDE support, type checking, and documentation',
      });
    }

    // Recommend docstrings
    if (!func.docstring) {
      recommendations.push({
        type: 'documentation',
        severity: 'medium',
        message: `Add docstring to '${func.name}'`,
        suggestion: 'Add a docstring explaining the function purpose, parameters, and return value',
        file: filePath,
        impact: 'Better code documentation and IDE support',
      });
    }
  }

  private generateModuleRecommendations(
    functions: PythonFunction[],
    classes: PythonClass[],
    recommendations: ValidationRecommendation[],
    filePath?: string
  ): void {
    const totalFunctions =
      functions.length + classes.reduce((acc, cls) => acc + cls.methods.length, 0);

    // Recommend breaking up large modules
    if (totalFunctions > 50) {
      recommendations.push({
        type: 'maintainability',
        severity: 'medium',
        message: 'Module has many functions, consider breaking it up',
        suggestion: 'Split module into smaller, focused modules',
        file: filePath,
        impact: 'Improved maintainability and code organization',
      });
    }

    // Check type hint coverage
    const functionsWithTypes = functions.filter(
      f => !this.isEmptyType(f.returnType) || f.parameters.some(p => !this.isEmptyType(p.type))
    );

    const typeHintCoverage =
      totalFunctions > 0 ? (functionsWithTypes.length / totalFunctions) * 100 : 100;

    if (typeHintCoverage < 50) {
      recommendations.push({
        type: 'type-safety',
        severity: 'high',
        message: `Low type hint coverage (${typeHintCoverage.toFixed(1)}%)`,
        suggestion: 'Add type annotations to improve type safety',
        file: filePath,
        impact: 'Better type checking and IDE support',
      });
    }
  }

  private calculateFunctionStatistics(
    func: PythonFunction,
    errors: AnalysisError[],
    warnings: AnalysisWarning[]
  ): ValidationStatistics {
    const hasTypeHints =
      !this.isEmptyType(func.returnType) || func.parameters.some(p => !this.isEmptyType(p.type));

    return {
      totalIssues: errors.length + warnings.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      typeHintCoverage: hasTypeHints ? 100 : 0,
      docstringCoverage: func.docstring ? 100 : 0,
      complexityScore: this.calculateComplexity(func),
      qualityScore: this.calculateQualityScore(func, errors, warnings),
    };
  }

  private calculateClassStatistics(
    cls: PythonClass,
    errors: AnalysisError[],
    warnings: AnalysisWarning[]
  ): ValidationStatistics {
    const methodsWithTypes = cls.methods.filter(
      m => !this.isEmptyType(m.returnType) || m.parameters.some(p => !this.isEmptyType(p.type))
    ).length;

    const methodsWithDocstrings = cls.methods.filter(m => m.docstring).length;

    const typeHintCoverage =
      cls.methods.length > 0 ? (methodsWithTypes / cls.methods.length) * 100 : 100;
    const docstringCoverage =
      cls.methods.length > 0 ? (methodsWithDocstrings / cls.methods.length) * 100 : 100;

    return {
      totalIssues: errors.length + warnings.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      typeHintCoverage,
      docstringCoverage,
      complexityScore: Math.max(...cls.methods.map(m => this.calculateComplexity(m)), 0),
      qualityScore: this.calculateClassQualityScore(cls, errors, warnings),
    };
  }

  private calculateModuleStatistics(
    functions: PythonFunction[],
    classes: PythonClass[],
    errors: AnalysisError[],
    warnings: AnalysisWarning[]
  ): ValidationStatistics {
    const allMethods = classes.flatMap(cls => cls.methods);
    const allFunctions = [...functions, ...allMethods];

    const functionsWithTypes = allFunctions.filter(
      f => !this.isEmptyType(f.returnType) || f.parameters.some(p => !this.isEmptyType(p.type))
    ).length;

    const functionsWithDocstrings = allFunctions.filter(f => f.docstring).length;

    const typeHintCoverage =
      allFunctions.length > 0 ? (functionsWithTypes / allFunctions.length) * 100 : 100;
    const docstringCoverage =
      allFunctions.length > 0 ? (functionsWithDocstrings / allFunctions.length) * 100 : 100;

    return {
      totalIssues: errors.length + warnings.length,
      errorCount: errors.length,
      warningCount: warnings.length,
      typeHintCoverage,
      docstringCoverage,
      complexityScore: Math.max(...allFunctions.map(f => this.calculateComplexity(f)), 0),
      qualityScore: this.calculateModuleQualityScore(allFunctions, errors, warnings),
    };
  }

  private calculateComplexity(func: PythonFunction): number {
    let complexity = 1; // Base complexity
    complexity += func.parameters.length * 0.5;
    complexity += func.isAsync ? 1 : 0;
    complexity += func.isGenerator ? 1 : 0;
    complexity += func.decorators.length * 0.5;
    return Math.round(complexity * 10) / 10;
  }

  private calculateQualityScore(
    func: PythonFunction,
    errors: AnalysisError[],
    warnings: AnalysisWarning[]
  ): number {
    let score = 100;

    // Deduct points for errors and warnings
    score -= errors.length * 20;
    score -= warnings.length * 10;

    // Add points for good practices
    if (!this.isEmptyType(func.returnType)) {
      score += 10;
    }
    if (func.parameters.every(p => !this.isEmptyType(p.type))) {
      score += 10;
    }
    if (func.docstring) {
      score += 10;
    }

    return Math.max(0, Math.min(100, score));
  }

  private calculateClassQualityScore(
    cls: PythonClass,
    errors: AnalysisError[],
    warnings: AnalysisWarning[]
  ): number {
    let score = 100;

    // Deduct points for errors and warnings
    score -= errors.length * 15;
    score -= warnings.length * 8;

    // Add points for good practices
    if (cls.docstring) {
      score += 10;
    }
    if (cls.methods.some(m => m.name === '__init__')) {
      score += 10;
    }
    if (cls.methods.length > 0) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  private calculateModuleQualityScore(
    functions: PythonFunction[],
    errors: AnalysisError[],
    warnings: AnalysisWarning[]
  ): number {
    if (functions.length === 0) {
      return 100;
    }

    const functionScores = functions.map(f =>
      this.calculateQualityScore(
        f,
        errors.filter(e => e.message?.includes(f.name)),
        warnings.filter(w => w.message?.includes(f.name))
      )
    );

    return functionScores.reduce((sum, score) => sum + score, 0) / functionScores.length;
  }
}
