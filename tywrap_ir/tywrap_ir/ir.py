from __future__ import annotations

import ast
import dataclasses as _dataclasses
import importlib
import inspect
import json
import platform
import sys
import types
import typing
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, get_type_hints

try:
    from importlib import metadata as importlib_metadata  # py3.8+
except Exception:  # pragma: no cover
    import importlib_metadata  # type: ignore


@dataclass
class IRTypeParam:
    name: str
    kind: str
    bound: str | None = None
    constraints: List[str] | None = None
    variance: str | None = None


@dataclass
class IRParam:
    name: str
    kind: str
    annotation: str | None
    default: bool


@dataclass
class IRFunction:
    name: str
    qualname: str
    docstring: Optional[str]
    parameters: List[IRParam]
    returns: Optional[str]
    is_async: bool
    is_generator: bool
    type_params: List[IRTypeParam]


@dataclass
class IRClass:
    name: str
    qualname: str
    docstring: Optional[str]
    bases: List[str]
    methods: List[IRFunction]
    typed_dict: bool
    total: Optional[bool]
    fields: List[IRParam]
    is_protocol: bool
    is_namedtuple: bool
    is_dataclass: bool
    is_pydantic: bool
    type_params: List[IRTypeParam]


@dataclass
class IRConstant:
    name: str
    annotation: str | None
    value_repr: str | None
    is_final: bool


@dataclass
class IRTypeAlias:
    name: str
    definition: str
    is_generic: bool
    type_params: List[IRTypeParam]


@dataclass
class IRModule:
    ir_version: str
    module: str
    functions: List[IRFunction]
    classes: List[IRClass]
    constants: List[IRConstant]
    type_aliases: List[IRTypeAlias]
    metadata: Dict[str, Any]
    warnings: List[str]


def _stringify_annotation(annotation: Any) -> Optional[str]:
    if annotation is inspect._empty:  # type: ignore[attr-defined]
        return None
    try:
        str_repr = str(annotation)
        if str_repr.startswith("<class '") and str_repr.endswith("'>"):
            class_path = str_repr[8:-2]
            if "." in class_path:
                return class_path.split(".")[-1]
            return class_path
        return str_repr
    except Exception:
        return None


def _param_kind_to_str(kind: inspect._ParameterKind) -> str:
    mapping = {
        inspect.Parameter.POSITIONAL_ONLY: "POSITIONAL_ONLY",
        inspect.Parameter.POSITIONAL_OR_KEYWORD: "POSITIONAL_OR_KEYWORD",
        inspect.Parameter.VAR_POSITIONAL: "VAR_POSITIONAL",
        inspect.Parameter.KEYWORD_ONLY: "KEYWORD_ONLY",
        inspect.Parameter.VAR_KEYWORD: "VAR_KEYWORD",
    }
    return mapping.get(kind, str(kind))


def _type_param_kind(value: Any) -> str | None:
    cls = type(value)
    name = getattr(cls, "__name__", "")
    module = getattr(cls, "__module__", "")
    if module == "typing" and name in {"TypeVar", "ParamSpec", "TypeVarTuple"}:
        return name.lower()
    return None


def _serialize_type_param(value: Any) -> IRTypeParam | None:
    kind = _type_param_kind(value)
    if kind is None:
        return None

    if kind == "typevar":
        constraints = [_stringify_annotation(item) or str(item) for item in getattr(value, "__constraints__", ())] or None
        variance = "invariant"
        if getattr(value, "__covariant__", False):
            variance = "covariant"
        elif getattr(value, "__contravariant__", False):
            variance = "contravariant"
        bound_value = getattr(value, "__bound__", None)
        return IRTypeParam(
            name=str(getattr(value, "__name__", str(value)).replace("~", "")),
            kind="typevar",
            bound=_stringify_annotation(bound_value) if bound_value is not None else None,
            constraints=constraints,
            variance=variance,
        )

    if kind == "paramspec":
        return IRTypeParam(
            name=str(getattr(value, "__name__", str(value)).replace("~", "")),
            kind="paramspec",
        )

    if kind == "typevartuple":
        return IRTypeParam(
            name=str(getattr(value, "__name__", str(value)).replace("~", "")),
            kind="typevartuple",
        )

    return None


def _append_type_param(value: Any, seen: set[str], out: List[IRTypeParam]) -> None:
    param = _serialize_type_param(value)
    if param is None:
        return
    key = f"{param.kind}:{param.name}"
    if key in seen:
        return
    seen.add(key)
    out.append(param)


def _collect_type_params_from_annotation(
    annotation: Any,
    seen: set[str],
    out: List[IRTypeParam],
) -> None:
    _append_type_param(annotation, seen, out)

    try:
        origin = typing.get_origin(annotation)
    except Exception:
        origin = None
    if origin is not None:
        _append_type_param(origin, seen, out)

    try:
        args = typing.get_args(annotation)
    except Exception:
        args = ()
    for arg in args:
        _collect_type_params_from_annotation(arg, seen, out)

    text = _stringify_annotation(annotation) or ""
    paramspec_match = text.split(".", 1)[0] if text.endswith(".args") or text.endswith(".kwargs") else None
    if paramspec_match:
        inferred = IRTypeParam(name=paramspec_match.replace("~", ""), kind="paramspec")
        key = f"{inferred.kind}:{inferred.name}"
        if key not in seen:
            seen.add(key)
            out.append(inferred)


def _collect_type_params_from_annotations(*annotations: Any) -> List[IRTypeParam]:
    seen: set[str] = set()
    out: List[IRTypeParam] = []
    for annotation in annotations:
        _collect_type_params_from_annotation(annotation, seen, out)
    return out


def _top_level_assigned_names(module: Any) -> set[str]:
    try:
        source = inspect.getsource(module)
    except Exception:
        return set()

    try:
        tree = ast.parse(source)
    except Exception:
        return set()

    names: set[str] = set()
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    names.add(target.id)
        elif isinstance(stmt, ast.AnnAssign):
            if isinstance(stmt.target, ast.Name):
                names.add(stmt.target.id)
        elif hasattr(ast, "TypeAlias") and isinstance(stmt, getattr(ast, "TypeAlias")):
            name_node = getattr(stmt, "name", None)
            if isinstance(name_node, ast.Name):
                names.add(name_node.id)
    return names


def _is_type_alias_value(value: Any) -> bool:
    if inspect.isfunction(value) or inspect.isbuiltin(value) or inspect.isclass(value) or inspect.ismodule(value):
        return False
    type_alias_type = getattr(typing, "TypeAliasType", None)
    if type_alias_type is not None and isinstance(value, type_alias_type):
        return True
    if isinstance(value, types.GenericAlias):
        return True
    try:
        if typing.get_origin(value) is not None:
            return True
    except Exception:
        pass
    return hasattr(value, "__parameters__") and bool(getattr(value, "__parameters__", ()))


def _extract_constants(module: Any, module_name: str, include_private: bool) -> List[IRConstant]:
    """Extract module-level constants and Final variables."""
    constants: List[IRConstant] = []
    annotations = getattr(module, "__annotations__", {})

    for name in dir(module):
        if not include_private and name.startswith("_"):
            continue

        try:
            value = getattr(module, name)
        except Exception:
            continue

        if inspect.isfunction(value) or inspect.isclass(value) or inspect.ismodule(value) or callable(value):
            continue

        is_constant = name.isupper() or name in annotations
        if not is_constant:
            continue

        annotation = annotations.get(name)
        annotation_str = _stringify_annotation(annotation) if annotation else None
        is_final = bool(annotation_str and ("Final[" in annotation_str or annotation_str == "Final"))

        try:
            value_repr = repr(value)
            if len(value_repr) > 200:
                value_repr = value_repr[:197] + "..."
        except Exception:
            value_repr = "<unrepresentable>"

        constants.append(
            IRConstant(
                name=name,
                annotation=annotation_str,
                value_repr=value_repr,
                is_final=is_final,
            )
        )

    return constants


def _extract_type_aliases(module: Any, module_name: str, include_private: bool) -> List[IRTypeAlias]:
    """Extract top-level type aliases from module assignments."""
    type_aliases: List[IRTypeAlias] = []
    annotations = getattr(module, "__annotations__", {})
    assigned_names = _top_level_assigned_names(module)
    candidate_names = sorted(assigned_names | set(annotations.keys()))

    for name in candidate_names:
        if not include_private and name.startswith("_"):
            continue

        try:
            value = getattr(module, name)
        except Exception:
            continue

        annotation = annotations.get(name)
        annotation_str = _stringify_annotation(annotation) if annotation is not None else None
        is_type_alias_annotation = bool(annotation_str and "TypeAlias" in annotation_str)
        if not _is_type_alias_value(value) and not is_type_alias_annotation:
            continue

        type_params = _collect_type_params_from_annotations(value)
        definition = _stringify_annotation(value) or annotation_str or str(value)
        type_aliases.append(
            IRTypeAlias(
                name=name,
                definition=definition,
                is_generic=bool(type_params),
                type_params=type_params,
            )
        )

    return type_aliases


def _extract_function(
    obj: Any,
    qualname: str,
    *,
    include_type_params: bool = True,
) -> Optional[IRFunction]:
    try:
        sig = inspect.signature(obj)
    except Exception:
        return None

    try:
        hints = get_type_hints(obj, include_extras=True)
    except Exception:
        try:
            hints = get_type_hints(obj)
        except Exception:
            hints = {}

    params: List[IRParam] = []
    annotations_for_params: List[Any] = []
    for name, p in sig.parameters.items():
        ann = hints.get(name, p.annotation)
        annotations_for_params.append(ann)
        params.append(
            IRParam(
                name=name,
                kind=_param_kind_to_str(p.kind),
                annotation=_stringify_annotation(ann),
                default=(p.default is not inspect._empty),
            )
        )

    returns = hints.get("return", sig.return_annotation)
    is_async = inspect.iscoroutinefunction(obj) or inspect.isasyncgenfunction(obj)
    # Async generators must be marked as generators so callers can distinguish
    # them from plain coroutines.
    is_generator = inspect.isgeneratorfunction(obj) or inspect.isasyncgenfunction(obj)
    type_params = _collect_type_params_from_annotations(*annotations_for_params, returns) if include_type_params else []
    

    return IRFunction(
        name=getattr(obj, "__name__", qualname.split(".")[-1]),
        qualname=qualname,
        docstring=inspect.getdoc(obj),
        parameters=params,
        returns=_stringify_annotation(returns),
        is_async=is_async,
        is_generator=is_generator,
        type_params=type_params,
    )


def _extract_class(cls: type, module_name: str, include_private: bool) -> Optional[IRClass]:
    name = getattr(cls, "__name__", None)
    if not name:
        return None
    if not include_private and name.startswith("_"):
        return None

    bases = [b.__name__ for b in getattr(cls, "__bases__", []) if hasattr(b, "__name__")]
    class_type_params = _collect_type_params_from_annotations(*getattr(cls, "__parameters__", ()))

    methods: List[IRFunction] = []
    for meth_name, value in inspect.getmembers(
        cls,
        predicate=lambda x: inspect.isfunction(x) or inspect.ismethoddescriptor(x) or inspect.isbuiltin(x),
    ):
        if not include_private and meth_name.startswith("_") and meth_name != "__init__":
            continue
        fn = _extract_function(
            value,
            f"{module_name}.{cls.__name__}.{meth_name}",
            include_type_params=False,
        )
        if fn is not None:
            methods.append(fn)

    typed_dict = False
    total: Optional[bool] = None
    fields: List[IRParam] = []
    try:
        if hasattr(cls, "__annotations__") and hasattr(cls, "__total__"):
            typed_dict = True
            total = bool(getattr(cls, "__total__", True))
            ann = (
                get_type_hints(cls, include_extras=True)
                if hasattr(typing, "get_origin")
                else getattr(cls, "__annotations__", {})
            )
            for fname, ftype in ann.items():
                text = _stringify_annotation(ftype)
                s = str(ftype)
                is_not_required = "NotRequired[" in s or "typing.NotRequired[" in s
                is_required = "Required[" in s or "typing.Required[" in s
                optional_flag = is_not_required or (not is_required and total is False)
                fields.append(IRParam(name=fname, kind="FIELD", annotation=text, default=optional_flag))
    except Exception:
        pass

    is_protocol = False
    try:
        for b in getattr(cls, "__mro__", []):
            if getattr(b, "__name__", None) == "Protocol":
                is_protocol = True
                break
    except Exception:
        is_protocol = False

    is_namedtuple = hasattr(cls, "_fields") and isinstance(getattr(cls, "_fields", None), (list, tuple))
    if is_namedtuple and not fields:
        try:
            ann = (
                get_type_hints(cls, include_extras=True)
                if hasattr(typing, "get_origin")
                else getattr(cls, "__annotations__", {})
            )
            for fname in getattr(cls, "_fields", []):
                ftype = ann.get(fname, None)
                fields.append(
                    IRParam(
                        name=str(fname),
                        kind="FIELD",
                        annotation=_stringify_annotation(ftype),
                        default=False,
                    )
                )
        except Exception:
            pass

    is_dataclass = False
    try:
        is_dataclass = _dataclasses.is_dataclass(cls)
    except Exception:
        is_dataclass = False
    if is_dataclass and not fields:
        try:
            for f in _dataclasses.fields(cls):  # type: ignore[attr-defined]
                defaulted = not (
                    f.default is _dataclasses.MISSING and f.default_factory is _dataclasses.MISSING
                )  # type: ignore[attr-defined]
                fields.append(
                    IRParam(
                        name=f.name,
                        kind="FIELD",
                        annotation=_stringify_annotation(f.type),
                        default=defaulted,
                    )
                )
        except Exception:
            pass

    is_pydantic = False
    try:
        import pydantic

        try:
            base = pydantic.BaseModel  # type: ignore[attr-defined]
        except Exception:
            base = None
        if base is not None:
            try:
                is_pydantic = issubclass(cls, base)
            except Exception:
                is_pydantic = False
    except Exception:
        is_pydantic = False
    if is_pydantic and not fields:
        try:
            model_fields = getattr(cls, "model_fields", None)
            if isinstance(model_fields, dict):
                for fname, finfo in model_fields.items():
                    ann = getattr(finfo, "annotation", None)
                    required = getattr(finfo, "is_required", False)
                    fields.append(
                        IRParam(
                            name=str(fname),
                            kind="FIELD",
                            annotation=_stringify_annotation(ann),
                            default=(not required),
                        )
                    )
            else:
                __fields__ = getattr(cls, "__fields__", None)
                if isinstance(__fields__, dict):
                    for fname, finfo in __fields__.items():
                        ann = getattr(finfo, "type_", None)
                        required = getattr(finfo, "required", False)
                        fields.append(
                            IRParam(
                                name=str(fname),
                                kind="FIELD",
                                annotation=_stringify_annotation(ann),
                                default=(not required),
                            )
                        )
        except Exception:
            pass

    return IRClass(
        name=name,
        qualname=f"{module_name}.{name}",
        docstring=inspect.getdoc(cls) if getattr(cls, "__doc__", None) else None,
        bases=bases,
        methods=methods,
        typed_dict=typed_dict,
        total=total,
        fields=fields,
        is_protocol=is_protocol,
        is_namedtuple=is_namedtuple,
        is_dataclass=is_dataclass,
        is_pydantic=is_pydantic,
        type_params=class_type_params,
    )


def _collect_metadata(module_name: str, ir_version: str) -> Dict[str, Any]:
    py_version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    plat = platform.platform()

    pkg_root = module_name.split(".")[0]
    version: Optional[str]
    try:
        version = importlib_metadata.version(pkg_root)
    except Exception:
        try:
            mod = importlib.import_module(pkg_root)
            version = getattr(mod, "__version__", None)
        except Exception:
            version = None

    cache_key = f"{module_name}@{version or 'unknown'}|py{py_version}|ir{ir_version}"
    return {
        "python_version": py_version,
        "platform": plat,
        "package": pkg_root,
        "package_version": version,
        "cache_key": cache_key,
    }


def extract_module_ir(
    module_name: str,
    *,
    ir_version: str = "0.2.0",
    include_private: bool = False,
) -> Dict[str, Any]:
    module = importlib.import_module(module_name)

    functions: List[IRFunction] = []
    classes: List[IRClass] = []
    warnings: List[str] = []

    constants = _extract_constants(module, module_name, include_private)
    type_aliases = _extract_type_aliases(module, module_name, include_private)

    for name in dir(module):
        try:
            value = getattr(module, name)
        except Exception:
            continue
        if not include_private and name.startswith("_"):
            continue
        if inspect.isfunction(value) or inspect.isbuiltin(value):
            fn = _extract_function(value, f"{module_name}.{name}")
            if fn is not None:
                functions.append(fn)
        if inspect.isclass(value) and getattr(value, "__module__", None) == module.__name__:
            cls_ir = _extract_class(value, module_name, include_private)
            if cls_ir is not None:
                classes.append(cls_ir)

    ir = IRModule(
        ir_version=ir_version,
        module=module_name,
        functions=functions,
        classes=classes,
        constants=constants,
        type_aliases=type_aliases,
        metadata=_collect_metadata(module_name, ir_version),
        warnings=warnings,
    )
    return asdict(ir)


def emit_ir_json(
    module_name: str,
    *,
    ir_version: str = "0.2.0",
    include_private: bool = False,
    pretty: bool = True,
) -> str:
    return json.dumps(
        extract_module_ir(module_name, ir_version=ir_version, include_private=include_private),
        ensure_ascii=False,
        indent=2 if pretty else None,
    )
