__all__ = [
    "extract_module_ir",
    "IR_VERSION",
    "__version__",
]

__version__: str = "0.3.1"
IR_VERSION = "0.4.0"

from .ir import extract_module_ir  # noqa: E402
