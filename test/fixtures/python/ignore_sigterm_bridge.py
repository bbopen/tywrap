import signal
import sys
import time


signal.signal(signal.SIGTERM, signal.SIG_IGN)
print('READY', file=sys.stderr, flush=True)
sys.stdin.readline()
while True:
    time.sleep(0.1)
