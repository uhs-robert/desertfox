#!/usr/bin/python3 -I
# Spike native host: append every message to a JSONL log, answer "echo" for the latency test.
import json, os, struct, sys, time

log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "results", "log.jsonl")
with open(log_path, "a", buffering=1) as log:
    while True:
        header = sys.stdin.buffer.read(4)
        if len(header) < 4:
            break
        msg = json.loads(sys.stdin.buffer.read(struct.unpack("=I", header)[0]))
        if msg.get("kind") == "echo":
            out = json.dumps({"kind": "echo"}).encode()
            sys.stdout.buffer.write(struct.pack("=I", len(out)) + out)
            sys.stdout.buffer.flush()
            continue
        msg["host_s"] = time.time()
        log.write(json.dumps(msg) + "\n")
