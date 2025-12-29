#!/usr/bin/env python3
import json
import sys


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        # Emit a non-JSON line to simulate noisy stdout corrupting the protocol.
        sys.stdout.write("NOISE\n")
        sys.stdout.flush()
        try:
            msg = json.loads(line)
        except Exception:
            msg = {}
        out = {"id": msg.get("id", -1), "result": 1}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
