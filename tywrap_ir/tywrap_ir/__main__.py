from __future__ import annotations

import argparse
import sys
from .ir import emit_ir_json


def main() -> None:
    parser = argparse.ArgumentParser(description="tywrap IR extractor")
    parser.add_argument("--module", help="Python module name, e.g. math or pandas")
    parser.add_argument("--package", help="Python package name (alias of --module for now)")
    parser.add_argument("--output", help="Write JSON IR to file instead of stdout")
    parser.add_argument("--ir-version", default="0.1.0", help="IR schema version")
    parser.add_argument("--include-private", action="store_true", help="Include private members (leading _)")
    parser.add_argument("--no-pretty", action="store_true", help="Disable pretty JSON formatting")
    args = parser.parse_args()

    target = args.module or args.package
    if not target:
        sys.stderr.write("Error: --module or --package is required\n")
        sys.exit(2)

    try:
        output = emit_ir_json(
            target,
            ir_version=args.ir_version,
            include_private=args.include_private,
            pretty=not args.no_pretty,
        )
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output)
        else:
            sys.stdout.write(output + "\n")
    except Exception as exc:  # pragma: no cover
        sys.stderr.write(f"Error: {exc}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
