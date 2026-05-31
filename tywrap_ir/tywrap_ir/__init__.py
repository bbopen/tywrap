__all__ = [
    "extract_module_ir",
    "IR_VERSION",
    "__version__",
]

__version__ = "0.2.1"
IR_VERSION = "0.3.0"

from .ir import extract_module_ir  # noqa: E402
