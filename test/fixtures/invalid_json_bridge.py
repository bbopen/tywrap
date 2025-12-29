#!/usr/bin/env python3
import sys


def main():
    for line in sys.stdin:
        if not line.strip():
            continue
        # Emit a truncated JSON line to trigger protocol parsing errors.
        sys.stdout.write('{"id":')
        sys.stdout.write("\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
