__all__ = [
    "extract_module_ir",
    "IR_VERSION",
    "__version__",
]

__version__ = "0.2.0"
IR_VERSION = "0.1.0"

from .ir import extract_module_ir  # noqa: E402
