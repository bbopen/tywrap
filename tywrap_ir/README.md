# tywrap-ir

[![PyPI version](https://img.shields.io/pypi/v/tywrap-ir.svg)](https://pypi.org/project/tywrap-ir/)
[![Python versions](https://img.shields.io/pypi/pyversions/tywrap-ir.svg)](https://pypi.org/project/tywrap-ir/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Python IR extractor for [tywrap](https://github.com/bbopen/tywrap). Emits versioned JSON IR for Python modules using inspect/typing/importlib.

## Installation

```bash
pip install tywrap-ir
```

## Usage

```bash
# Extract IR for a module
python -m tywrap_ir --module math

# Or using the CLI
tywrap-ir --module math

# Output to file
tywrap-ir --module pandas --output pandas_ir.json
```

## What is this?

This package is the Python component of tywrap, a TypeScript wrapper generator for Python libraries. It analyzes Python modules and extracts type information into a JSON intermediate representation (IR) that tywrap uses to generate TypeScript bindings.

You typically don't need to use this package directly - the `tywrap` npm package invokes it automatically during code generation.

## Requirements

- Python 3.10+

## Related

- [tywrap](https://www.npmjs.com/package/tywrap) - The main TypeScript package
- [GitHub](https://github.com/bbopen/tywrap) - Source code and issues

## License

MIT
