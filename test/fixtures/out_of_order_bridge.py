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


def send_response(msg, result):
    out = {"id": msg.get("id", -1), "protocol": PROTOCOL, "result": result}
    sys.stdout.write(json.dumps(out) + "\n")
    sys.stdout.flush()


def main():
    pending = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            msg = {}
        if msg.get("method") == "meta":
            send_response(msg, meta_payload())
            continue
        # Intentional: leave pending set at EOF to simulate missing responses.
        if pending is None:
            pending = msg
            continue
        # Respond to the newer request first, then the pending one.
        send_response(msg, 2)
        send_response(pending, 1)
        pending = None


if __name__ == "__main__":
    main()
