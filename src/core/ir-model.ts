/** Map validated Python IR to the generator model without runtime effects. */

import { parseAnnotationToPythonType } from './annotation-parser.js';
import type {
  IrClass,
  IrFunction,
  IrParameter,
  IrTypeAlias,
  IrTypeParameter,
  ValidatedIrContract,
} from './ir-contract.js';
import type {
  Parameter,
  PythonClass,
  PythonFunction,
  PythonGenericParameter,
  PythonModule,
  PythonType,
  PythonTypeAlias,
} from '../types/index.js';

function collectModuleTypeVarNames(ir: ValidatedIrContract): Set<string> {
  const names = new Set<string>();
  for (const constant of ir.constants) {
    const name = constant.name.trim();
    if (!name) {
      continue;
    }
    const valueRepr = constant.value_repr?.trim() ?? '';
    if (/^~?[A-Za-z_][A-Za-z0-9_]*$/.test(valueRepr) && valueRepr.replace(/^~/, '') === name) {
      names.add(name);
      continue;
    }
    const annotation = constant.annotation?.trim() ?? '';
    if (/(^|\.)(TypeVar|ParamSpec|TypeVarTuple)(\[|\(|$)/.test(annotation)) {
      names.add(name);
    }
  }
  return names;
}

export function transformIrToTsModel(
  ir: ValidatedIrContract,
  onUnknownTypeName?: (name: string) => void
): PythonModule {
  const moduleTypeVarNames = collectModuleTypeVarNames(ir);
  const parseType = (
    annotation: unknown,
    typeParameters: readonly PythonGenericParameter[] = []
  ): PythonType =>
    parseAnnotationToPythonType(annotation, {
      onUnknownTypeName,
      knownTypeVarNames: moduleTypeVarNames,
      typeParameters,
    });
  const mapTypeParameters = (
    typeParameters: readonly IrTypeParameter[]
  ): PythonGenericParameter[] =>
    typeParameters.map(param => ({
      name: param.name,
      kind: param.kind,
      bound: param.bound ? parseType(param.bound) : undefined,
      constraints: param.constraints ? param.constraints.map(item => parseType(item)) : undefined,
      variance: param.variance ?? undefined,
    }));
  const mapParam = (
    param: IrParameter,
    typeParameters: readonly PythonGenericParameter[] = []
  ): Parameter => ({
    name: param.name,
    type: parseType(param.annotation, typeParameters),
    optional: param.default,
    varArgs: param.kind === 'VAR_POSITIONAL',
    kwArgs: param.kind === 'VAR_KEYWORD',
    positionalOnly: param.kind === 'POSITIONAL_ONLY',
    keywordOnly: param.kind === 'KEYWORD_ONLY',
  });
  const mapMethodKind = (value: unknown): PythonFunction['methodKind'] =>
    value === 'class' || value === 'static' ? value : 'instance';
  const mapFunc = (
    func: IrFunction,
    inheritedTypeParameters: readonly PythonGenericParameter[] = []
  ): PythonFunction => {
    const localTypeParameters = mapTypeParameters(func.type_params);
    const annotationTypeParameters = [...inheritedTypeParameters, ...localTypeParameters];
    return {
      name: func.name,
      signature: {
        parameters: func.parameters.map(param => mapParam(param, annotationTypeParameters)),
        returnType: parseType(func.returns, annotationTypeParameters),
        isAsync: func.is_async,
        isGenerator: func.is_generator,
      },
      docstring: func.docstring ?? undefined,
      decorators: [],
      isAsync: func.is_async,
      isGenerator: func.is_generator,
      typeParameters: [...localTypeParameters],
      returnType: parseType(func.returns, annotationTypeParameters),
      parameters: func.parameters.map(param => mapParam(param, annotationTypeParameters)),
      overloads: func.overloads.map(overload => ({
        parameters: overload.parameters.map(param => mapParam(param, annotationTypeParameters)),
        returnType: parseType(overload.returns, annotationTypeParameters),
      })),
      methodKind: mapMethodKind(func.method_kind),
    };
  };
  const mapClass = (cls: IrClass): PythonClass => {
    const classTypeParameters = mapTypeParameters(cls.type_params);
    return {
      name: cls.name,
      bases: cls.bases,
      methods: cls.methods.map(method => mapFunc(method, classTypeParameters)),
      properties: cls.fields.map(field => ({
        name: field.name,
        type: parseType(field.annotation, classTypeParameters),
        readonly: false,
        setter: false,
        getter: true,
        // A constructor default does not make the returned dataclass field absent.
        optional: cls.is_dataclass ? false : field.default,
      })),
      accessors: cls.accessors.map(accessor => ({
        name: accessor.name,
        type: parseType(accessor.returns, classTypeParameters),
        docstring: accessor.docstring ?? undefined,
        readOnly: accessor.read_only ?? undefined,
        isCached: accessor.is_cached,
      })),
      docstring: cls.docstring ?? undefined,
      decorators: cls.typed_dict ? ['__typed_dict__'] : [],
      kind: cls.typed_dict
        ? 'typed_dict'
        : cls.is_protocol
          ? 'protocol'
          : cls.is_namedtuple
            ? 'namedtuple'
            : cls.is_dataclass
              ? 'dataclass'
              : cls.is_pydantic
                ? 'pydantic'
                : 'class',
      typeParameters: classTypeParameters,
    };
  };
  const mapTypeAlias = (alias: IrTypeAlias): PythonTypeAlias => {
    const typeParameters = mapTypeParameters(alias.type_params);
    return {
      name: alias.name,
      type: parseType(alias.definition, typeParameters),
      typeParameters,
    };
  };
  return {
    name: ir.module,
    path: undefined,
    version:
      typeof ir.metadata.package_version === 'string' ? ir.metadata.package_version : undefined,
    functions: ir.functions.map(func => mapFunc(func)),
    classes: ir.classes.map(mapClass),
    typeAliases: ir.type_aliases.map(mapTypeAlias),
    imports: [],
    exports: [],
  };
}
