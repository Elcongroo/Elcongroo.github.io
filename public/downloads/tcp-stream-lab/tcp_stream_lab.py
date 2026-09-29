#!/usr/bin/env python3
"""A loopback TCP framing experiment; it makes no claim about packet boundaries."""
import argparse
import hashlib
import json
import platform
import socket
import struct
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path


PAYLOAD = b"cipher-to-packet"
PREFIX = PAYLOAD[: len(PAYLOAD) // 2]
SUFFIX = PAYLOAD[len(PAYLOAD) // 2 :]
IO_TIMEOUT = 2.0
MAX_MESSAGE = 4096


class PrematureEOF(Exception):
    pass


def run_case(name):
    first_payload_read = threading.Event()
    sender_finished = threading.Event()
    trace = []
    trace_lock = threading.Lock()
    sender_errors = []
    start = time.monotonic()
    recv_calls = []

    def log(event, **fields):
        with trace_lock:
            trace.append({"event": event, **fields})

    def receive(sock, requested, phase):
        chunk = sock.recv(requested)
        item = {"phase": phase, "requested": requested, "received": len(chunk),
                "hex": chunk.hex(), "ascii": chunk.decode("ascii", errors="replace")}
        recv_calls.append(item)
        log("recv_returned", **item)
        return chunk

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.settimeout(IO_TIMEOUT)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        port = listener.getsockname()[1]

        def sender():
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=IO_TIMEOUT) as sock:
                    first_write = struct.pack("!I", len(PAYLOAD)) + PREFIX
                    sock.sendall(first_write)
                    log("sendall_returned", write=1, bytes=len(first_write), hex=first_write.hex())
                    if not first_payload_read.wait(IO_TIMEOUT):
                        raise TimeoutError("receiver did not acknowledge its first payload recv")
                    if name == "normal":
                        sock.sendall(SUFFIX)
                        log("sendall_returned", write=2, bytes=len(SUFFIX), hex=SUFFIX.hex())
                    else:
                        log("intentional_early_eof", omitted_bytes=len(SUFFIX))
                    sock.shutdown(socket.SHUT_WR)
                    log("shutdown_write")
            except Exception as exc:
                sender_errors.append({"type": type(exc).__name__, "message": str(exc)})
            finally:
                sender_finished.set()

        thread = threading.Thread(target=sender, name="loopback-sender", daemon=True)
        thread.start()
        received = bytearray()
        declared_length = None
        detected_eof = False
        first_payload_length = None
        failure = None
        try:
            connection, _ = listener.accept()
            with connection:
                connection.settimeout(IO_TIMEOUT)
                header = bytearray()
                while len(header) < 4:
                    chunk = receive(connection, 4 - len(header), "length_header")
                    if not chunk:
                        raise PrematureEOF("EOF before complete 4-byte length header")
                    header.extend(chunk)
                declared_length = struct.unpack("!I", header)[0]
                if not 0 < declared_length <= MAX_MESSAGE:
                    raise ValueError("declared length is outside the accepted bound")
                # The sender cannot send the suffix until this first recv returns.
                # recv() is still allowed to return less than the available prefix.
                first = receive(connection, declared_length, "payload_first")
                first_payload_length = len(first)
                received.extend(first)
                if not 0 < len(first) <= len(PREFIX) < declared_length:
                    raise AssertionError("first payload recv must be nonempty and incomplete")
                if first != PREFIX[:len(first)]:
                    raise AssertionError("unexpected first payload bytes")
                first_payload_read.set()
                while len(received) < declared_length:
                    chunk = receive(connection, declared_length - len(received), "payload_remaining")
                    if not chunk:
                        detected_eof = True
                        raise PrematureEOF(f"expected {declared_length} payload bytes, received {len(received)}")
                    received.extend(chunk)
        except PrematureEOF as exc:
            if name != "early_eof":
                failure = {"type": type(exc).__name__, "message": str(exc)}
            else:
                log("expected_failure_detected", type=type(exc).__name__, message=str(exc))
        except Exception as exc:
            failure = {"type": type(exc).__name__, "message": str(exc)}
        finally:
            first_payload_read.set()
            thread.join(IO_TIMEOUT + 1.0)

    assertions = {
        "sender_finished_within_timeout": sender_finished.is_set() and not thread.is_alive(),
        "sender_has_no_errors": not sender_errors,
        "declared_length_matches_input": declared_length == len(PAYLOAD),
        "first_payload_recv_is_incomplete": first_payload_length is not None and 0 < first_payload_length <= len(PREFIX) < len(PAYLOAD),
        "no_unexpected_exception": failure is None,
    }
    if name == "normal":
        assertions["length_framing_recovers_exact_message"] = bytes(received) == PAYLOAD
        assertions["no_premature_eof"] = not detected_eof
    else:
        assertions["premature_eof_is_detected"] = detected_eof
        assertions["only_prefix_is_received"] = bytes(received) == PREFIX
        assertions["incomplete_message_is_not_accepted"] = len(received) < len(PAYLOAD)

    return {
        "case": name,
        "passed": all(assertions.values()),
        "duration_seconds": round(time.monotonic() - start, 6),
        "input": {"payload_ascii": PAYLOAD.decode("ascii"), "payload_hex": PAYLOAD.hex(),
                  "payload_length": len(PAYLOAD), "prefix_ascii": PREFIX.decode("ascii"),
                  "suffix_ascii": SUFFIX.decode("ascii"), "length_header": "uint32 big-endian"},
        "recv_calls": recv_calls,
        "assembled_payload_ascii": received.decode("ascii", errors="replace"),
        "assembled_payload_hex": received.hex(),
        "assertions": assertions,
        "unexpected_failure": failure,
        "sender_errors": sender_errors,
        "trace": trace,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case", choices=["normal", "early_eof", "all"], default="all")
    args = parser.parse_args()
    names = ["normal", "early_eof"] if args.case == "all" else [args.case]
    report = {
        "experiment": "tcp-stream-length-framing-v2",
        "source_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "started_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "environment": {"python": platform.python_version(), "python_implementation": platform.python_implementation(),
                        "os": platform.system(), "kernel": platform.release(), "architecture": platform.machine(),
                        "bind_address": "127.0.0.1", "port_selection": "OS-assigned ephemeral port",
                        "socket_and_event_timeout_seconds": IO_TIMEOUT, "max_message_length": MAX_MESSAGE},
        "scope": "Application-visible recv results; no packet capture and no inference about TCP segments or packets.",
        "cases": [run_case(name) for name in names],
    }
    report["passed"] = all(case["passed"] for case in report["cases"])
    json.dump(report, sys.stdout, indent=2, ensure_ascii=False)
    print()
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
