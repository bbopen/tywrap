#!/usr/bin/env python3
import sys


def main():
    payload = "x" * 1100000
    for line in sys.stdin:
        if not line.strip():
            continue
        sys.stdout.write(payload + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
