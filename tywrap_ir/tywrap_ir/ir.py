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


# Minimal, stringified annotation representation

def _stringify_annotation(annotation: Any) -> Optional[str]:
    if annotation is inspect._empty:  # type: ignore[attr-defined]
        return None
    try:
        # Handle forward references more elegantly
        str_repr = str(annotation)
        
        # Clean up class references to show just the class name
        if str_repr.startswith("<class '") and str_repr.endswith("'>"):
            # Extract class name from <class 'module.ClassName'>
            class_path = str_repr[8:-2]  # Remove <class ' and '>
            if '.' in class_path:
                return class_path.split('.')[-1]  # Just the class name
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


def _extract_constants(module: Any, module_name: str, include_private: bool) -> List[IRConstant]:
    """Extract module-level constants and Final variables."""
    constants: List[IRConstant] = []
    
    # Check module annotations for type hints
    annotations = getattr(module, '__annotations__', {})
    
    for name in dir(module):
        if not include_private and name.startswith("_"):
            continue
            
        try:
            value = getattr(module, name)
        except Exception:
            continue
            
        # Skip functions, classes, modules, and other non-constant items
        if (inspect.isfunction(value) or inspect.isclass(value) or 
            inspect.ismodule(value) or callable(value)):
            continue
            
        # Check if it's a constant (uppercase naming convention or Final)
        is_constant = name.isupper() or name in annotations
        
        if is_constant:
            annotation = annotations.get(name)
            annotation_str = _stringify_annotation(annotation) if annotation else None
            
            # Check if it's Final
            is_final = False
            if annotation_str and ('Final[' in annotation_str or annotation_str == 'Final'):
                is_final = True
            
            # Get string representation of value (truncated for large objects)
            try:
                value_repr = repr(value)
                if len(value_repr) > 200:
                    value_repr = value_repr[:197] + "..."
            except Exception:
                value_repr = "<unrepresentable>"
            
            constants.append(IRConstant(
                name=name,
                annotation=annotation_str,
                value_repr=value_repr,
                is_final=is_final
            ))
    
    return constants


def _extract_type_aliases(module: Any, module_name: str, include_private: bool) -> List[IRTypeAlias]:
    """Extract type aliases from module."""
    type_aliases: List[IRTypeAlias] = []
    
    # Check module annotations for type aliases
    annotations = getattr(module, '__annotations__', {})
    
    for name, annotation in annotations.items():
        if not include_private and name.startswith("_"):
            continue
            
        try:
            value = getattr(module, name, None)
        except Exception:
            continue
            
        # Type aliases are typically annotated but check for specific patterns
        annotation_str = _stringify_annotation(annotation)
        
        # Check if it's a type alias (has TypeAlias annotation or follows patterns)
        is_type_alias = (
            annotation_str and ('TypeAlias' in annotation_str or 
                              'typing.Union' in annotation_str or
                              'typing.Optional' in annotation_str or
                              'typing.List' in annotation_str or
                              'typing.Dict' in annotation_str or
                              '|' in annotation_str)  # Modern union syntax
        )
        
        if is_type_alias:
            # Check if it's generic (contains type parameters)
            is_generic = bool(annotation_str and any(
                marker in annotation_str for marker in ['[', '~', 'TypeVar', 'Generic']
            ))
            
            type_aliases.append(IRTypeAlias(
                name=name,
                definition=annotation_str or str(annotation),
                is_generic=is_generic
            ))
    
    return type_aliases


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
    
    # Extract constants and type aliases
    constants = _extract_constants(module, module_name, include_private)
    type_aliases = _extract_type_aliases(module, module_name, include_private)

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
        constants=constants,
        type_aliases=type_aliases,
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
