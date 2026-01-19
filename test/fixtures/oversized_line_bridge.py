#!/usr/bin/env python3
import sys


def main():
    # Payload exceeds typical 1MB line-buffer limits to test oversized line handling.
    payload = "x" * 1100000
    for line in sys.stdin:
        if not line.strip():
            continue
        sys.stdout.write(payload + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
