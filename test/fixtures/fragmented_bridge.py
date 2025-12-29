#!/usr/bin/env python3
import json
import sys


PROTOCOL = "tywrap/1"
PROTOCOL_VERSION = 1


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            msg = {}

        if msg.get("method") == "meta":
            result = {
                "protocol": PROTOCOL,
                "protocolVersion": PROTOCOL_VERSION,
                "bridge": "python-subprocess",
                "pythonVersion": "fixture",
                "pid": 0,
                "codecFallback": "none",
                "arrowAvailable": False,
                "instances": 0,
            }
        else:
            result = 42

        payload = {"id": msg.get("id", -1), "protocol": PROTOCOL, "result": result}
        data = json.dumps(payload)
        split_at = max(1, len(data) // 2)
        sys.stdout.write(data[:split_at])
        sys.stdout.flush()
        sys.stdout.write(data[split_at:] + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
