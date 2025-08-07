from __future__ import annotations

import importlib
import inspect
import json
import platform
import sys
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional, get_type_hints
import dataclasses as _dataclasses
import typing

try:
    from importlib import metadata as importlib_metadata  # py3.8+
except Exception:  # pragma: no cover
    import importlib_metadata  # type: ignore


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


@dataclass
class IRModule:
    ir_version: str
    module: str
    functions: List[IRFunction]
    classes: List[IRClass]
    metadata: Dict[str, Any]
    warnings: List[str]


# Minimal, stringified annotation representation

def _stringify_annotation(annotation: Any) -> Optional[str]:
    if annotation is inspect._empty:  # type: ignore[attr-defined]
        return None
    try:
        return str(annotation)
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


def _extract_function(obj: Any, qualname: str) -> Optional[IRFunction]:
    try:
        sig = inspect.signature(obj)
    except Exception:
        return None

    # Use get_type_hints to resolve ForwardRefs where possible
    try:
        hints = get_type_hints(obj)
    except Exception:
        hints = {}

    params: List[IRParam] = []
    for name, p in sig.parameters.items():
        ann = hints.get(name, p.annotation)
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
    is_generator = inspect.isgeneratorfunction(obj)

    return IRFunction(
        name=getattr(obj, "__name__", qualname.split(".")[-1]),
        qualname=qualname,
        docstring=inspect.getdoc(obj),
        parameters=params,
        returns=_stringify_annotation(returns),
        is_async=is_async,
        is_generator=is_generator,
    )


def _extract_class(cls: type, module_name: str, include_private: bool) -> Optional[IRClass]:
    name = getattr(cls, "__name__", None)
    if not name:
        return None
    if not include_private and name.startswith("_"):
        return None

    bases = [b.__name__ for b in getattr(cls, "__bases__", []) if hasattr(b, "__name__")]

    methods: List[IRFunction] = []
    for meth_name, value in inspect.getmembers(
        cls,
        predicate=lambda x: inspect.isfunction(x) or inspect.ismethoddescriptor(x) or inspect.isbuiltin(x),
    ):
        if not include_private and meth_name.startswith("_"):
            continue
        fn = _extract_function(value, f"{module_name}.{cls.__name__}.{meth_name}")
        if fn is not None:
            methods.append(fn)

    # TypedDict detection and fields
    typed_dict = False
    total: Optional[bool] = None
    fields: List[IRParam] = []
    try:
        # Heuristic: TypedDict classes have __annotations__ and __total__
        if hasattr(cls, "__annotations__") and hasattr(cls, "__total__"):
            typed_dict = True
            total = bool(getattr(cls, "__total__", True))
            ann = get_type_hints(cls, include_extras=True) if hasattr(typing, "get_origin") else getattr(cls, "__annotations__", {})
            for fname, ftype in ann.items():
                text = _stringify_annotation(ftype)
                # Determine optionality from NotRequired/Required wrappers if present
                s = str(ftype)
                is_not_required = "NotRequired[" in s or "typing.NotRequired[" in s
                is_required = "Required[" in s or "typing.Required[" in s
                optional_flag = is_not_required or (not is_required and total is False)
                fields.append(IRParam(name=fname, kind="FIELD", annotation=text, default=optional_flag))
    except Exception:
        pass

    # Protocol detection
    is_protocol = False
    try:
        for b in getattr(cls, "__mro__", []):
            if getattr(b, "__name__", None) == "Protocol":
                is_protocol = True
                break
    except Exception:
        is_protocol = False

    # NamedTuple detection
    is_namedtuple = hasattr(cls, "_fields") and isinstance(getattr(cls, "_fields", None), (list, tuple))
    if is_namedtuple and not fields:
        try:
            ann = get_type_hints(cls, include_extras=True) if hasattr(typing, "get_origin") else getattr(cls, "__annotations__", {})
            for fname in getattr(cls, "_fields", []):
                ftype = ann.get(fname, None)
                fields.append(IRParam(name=str(fname), kind="FIELD", annotation=_stringify_annotation(ftype), default=False))
        except Exception:
            pass

    # Dataclass detection
    is_dataclass = False
    try:
        is_dataclass = _dataclasses.is_dataclass(cls)
    except Exception:
        is_dataclass = False
    if is_dataclass and not fields:
        try:
            for f in _dataclasses.fields(cls):  # type: ignore[attr-defined]
                defaulted = not (f.default is _dataclasses.MISSING and f.default_factory is _dataclasses.MISSING)  # type: ignore[attr-defined]
                fields.append(IRParam(name=f.name, kind="FIELD", annotation=_stringify_annotation(f.type), default=defaulted))
        except Exception:
            pass

    # Pydantic detection
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
            # v2
            model_fields = getattr(cls, "model_fields", None)
            if isinstance(model_fields, dict):
                for fname, finfo in model_fields.items():
                    ann = getattr(finfo, "annotation", None)
                    required = getattr(finfo, "is_required", False)
                    fields.append(IRParam(name=str(fname), kind="FIELD", annotation=_stringify_annotation(ann), default=(not required)))
            else:
                # v1
                __fields__ = getattr(cls, "__fields__", None)
                if isinstance(__fields__, dict):
                    for fname, finfo in __fields__.items():
                        ann = getattr(finfo, "type_", None)
                        required = getattr(finfo, "required", False)
                        fields.append(IRParam(name=str(fname), kind="FIELD", annotation=_stringify_annotation(ann), default=(not required)))
        except Exception:
            pass

    return IRClass(
        name=name,
        qualname=f"{module_name}.{name}",
        docstring=inspect.getdoc(cls),
        bases=bases,
        methods=methods,
        typed_dict=typed_dict,
        total=total,
        fields=fields,
        is_protocol=is_protocol,
        is_namedtuple=is_namedtuple,
        is_dataclass=is_dataclass,
        is_pydantic=is_pydantic,
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
    ir_version: str = "0.1.0",
    include_private: bool = False,
) -> Dict[str, Any]:
    """
    Extract a minimal IR for a Python module: top-level callables with signature info.
    """
    module = importlib.import_module(module_name)

    functions: List[IRFunction] = []
    classes: List[IRClass] = []
    warnings: List[str] = []

    for name in dir(module):
        try:
            value = getattr(module, name)
        except Exception:
            continue
        if not include_private and name.startswith("_"):
            continue
        # Include plain functions and builtins (e.g., math.sqrt)
        if inspect.isfunction(value) or inspect.isbuiltin(value):
            fn = _extract_function(value, f"{module_name}.{name}")
            if fn is not None:
                functions.append(fn)
        # Include classes defined in this module
        if inspect.isclass(value) and getattr(value, "__module__", None) == module.__name__:
            cls_ir = _extract_class(value, module_name, include_private)
            if cls_ir is not None:
                classes.append(cls_ir)

    ir = IRModule(
        ir_version=ir_version,
        module=module_name,
        functions=functions,
        classes=classes,
        metadata=_collect_metadata(module_name, ir_version),
        warnings=warnings,
    )
    # Return as plain dicts ready for JSON emitting
    return asdict(ir)

def emit_ir_json(
    module_name: str,
    *,
    ir_version: str = "0.1.0",
    include_private: bool = False,
    pretty: bool = True,
) -> str:
    return json.dumps(
        extract_module_ir(module_name, ir_version=ir_version, include_private=include_private),
        ensure_ascii=False,
        indent=2 if pretty else None,
    )
