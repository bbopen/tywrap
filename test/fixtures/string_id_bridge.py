#!/usr/bin/env python3
import json
import sys


PROTOCOL = "tywrap/1"
PROTOCOL_VERSION = 1


def meta_payload():
    return {
        "protocol": PROTOCOL,
        "protocolVersion": PROTOCOL_VERSION,
        "bridge": "python-subprocess",
        "pythonVersion": "fixture",
        "pid": 0,
        "codecFallback": "none",
        "arrowAvailable": False,
        "instances": 0,
    }


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
            out = {"id": msg.get("id", -1), "protocol": PROTOCOL, "result": meta_payload()}
        else:
            out = {"id": str(msg.get("id", "1")), "protocol": PROTOCOL, "result": 1}
        sys.stdout.write(json.dumps(out) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
