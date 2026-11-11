"""Tests of the bridge host: the lock, the socket, the state file, the port lifecycle and bad input. Real processes, a temporary XDG_RUNTIME_DIR."""
import json
import os
import select
import signal
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

from host_under_test import load_host

HOST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "desertfox-bridge")

MODE = {"verb": "mode", "id": "insert", "label": "INSERT", "tab_id": 17, "window_id": 3, "private": False}
PRIVATE_MODE = {"verb": "mode", "id": "normal", "label": "NORMAL", "private": True}


def frame(message):
    payload = json.dumps(message).encode()
    return struct.pack("=I", len(payload)) + payload


class Host:
    """A bridge host process. With wait_ready False the constructor returns at once, for a host that is meant to wait for the lock."""

    def __init__(self, runtime_dir, wait_ready=True):
        env = dict(os.environ, XDG_RUNTIME_DIR=runtime_dir)
        self.process = subprocess.Popen([sys.executable, HOST_PATH], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        self.ready = self.read_ready() if wait_ready else None

    def read_ready(self, timeout=10):
        # A host that never says ready fails the test instead of hanging the suite.
        waiting, _, _ = select.select([self.process.stdout], [], [], timeout)
        if not waiting:
            self.kill()
            raise AssertionError("the host did not say ready within %s s" % timeout)
        (length,) = struct.unpack("=I", self.process.stdout.read(4))
        return json.loads(self.process.stdout.read(length))

    def send(self, message):
        self.process.stdin.write(frame(message))
        self.process.stdin.flush()

    def send_raw(self, data):
        self.process.stdin.write(data)
        self.process.stdin.flush()

    def close_stdin(self):
        self.process.stdin.close()

    def wait(self):
        self.process.wait(timeout=10)
        self.process.stdout.close()
        self.process.stderr.close()
        return self.process.returncode

    def kill(self):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait()
        for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
            if stream and not stream.closed:
                stream.close()


class BridgeTestCase(unittest.TestCase):
    def setUp(self):
        # A short path: a Unix socket path is limited to about 100 bytes.
        self.temp = tempfile.TemporaryDirectory(prefix="dfb")
        self.addCleanup(self.temp.cleanup)
        self.runtime = self.temp.name
        self.state_dir = os.path.join(self.runtime, "desertfox")
        self.state_path = os.path.join(self.state_dir, "state.json")
        self.socket_path = os.path.join(self.state_dir, "bridge.sock")
        self.lock_path = os.path.join(self.state_dir, "bridge.lock")
        self.hosts = []
        self.addCleanup(lambda: [host.kill() for host in self.hosts])

    def start(self, wait_ready=True):
        host = Host(self.runtime, wait_ready)
        self.hosts.append(host)
        return host

    def read_state(self):
        with open(self.state_path, encoding="utf-8") as state_file:
            return json.load(state_file)

    def wait_for(self, condition, what="the state file"):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                state = self.read_state()
                if condition(state):
                    return state
            except (OSError, ValueError):
                pass
            time.sleep(0.01)
        self.fail("timed out waiting for " + what)

    def wait_path_gone(self, path):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if not os.path.exists(path):
                return
            time.sleep(0.01)
        self.fail("%s was not deleted" % path)

    def ask(self, request, raw=None):
        """One request line on a new connection, the decoded reply line."""
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(5)
            client.connect(self.socket_path)
            client.sendall(raw if raw is not None else json.dumps(request).encode() + b"\n")
            data = b""
            while not data.endswith(b"\n"):
                chunk = client.recv(4096)
                if not chunk:
                    break
                data += chunk
        return json.loads(data)


class PortAndStateTest(BridgeTestCase):
    def test_ready_then_mode_writes_the_agreed_shape(self):
        host = self.start()
        self.assertEqual(host.ready, {"ready": True, "host_version": 1})
        host.send(MODE)
        state = self.wait_for(lambda s: s["mode"] is not None)
        self.assertEqual(state["version"], 2)
        self.assertEqual(state["seq"], 1)
        self.assertEqual(state["host"], {"pid": host.process.pid, "start": state["host"]["start"]})
        self.assertIsInstance(state["host"]["start"], str)
        self.assertEqual(state["firefox"], {"window_id": 3, "private": False})
        self.assertEqual(state["mode"], {"id": "insert", "label": "INSERT", "tab_id": 17})
        self.assertNotIn("whichkey", state)

    def test_a_private_window_leaves_only_its_mode_and_the_private_flag(self):
        host = self.start()
        host.send(dict(PRIVATE_MODE, tab_id=9, window_id=4, url="https://secret.example/", title="secret"))
        state = self.wait_for(lambda s: True)
        self.assertEqual(state["firefox"], {"private": True})
        self.assertEqual(state["mode"], {"id": "normal", "label": "NORMAL"})
        self.assertNotIn("secret", json.dumps(state))
        self.assertNotIn("secret", json.dumps(self.ask({"verb": "state"})))

    def test_seq_only_goes_up(self):
        host = self.start()
        host.send(MODE)
        seqs = [self.wait_for(lambda s: True)["seq"]]
        for _ in range(5):
            host.send(MODE)
            seqs.append(self.wait_for(lambda s: s["seq"] > seqs[-1])["seq"])
        self.assertEqual(seqs, sorted(set(seqs)))

    def test_a_reader_never_sees_a_partial_file_or_a_stray_temp_file(self):
        host = self.start()
        host.send(MODE)
        self.wait_for(lambda s: True)
        failures = []
        stop = threading.Event()

        def reader():
            while not stop.is_set():
                try:
                    with open(self.state_path, encoding="utf-8") as state_file:
                        json.load(state_file)
                except FileNotFoundError:
                    failures.append("missing")
                except ValueError as error:
                    failures.append("partial: %s" % error)

        thread = threading.Thread(target=reader)
        thread.start()
        for count in range(300):
            host.send(dict(MODE, id="m%d" % count, label="L" * 64))
        host.send(dict(MODE, id="visual", label="VISUAL"))
        self.wait_for(lambda s: s["mode"]["id"] == "visual")
        stop.set()
        thread.join()
        self.assertEqual(failures, [])
        self.assertEqual(sorted(os.listdir(self.state_dir)), ["bridge.lock", "bridge.sock", "state.json"])

    def test_a_failed_write_leaves_no_temp_file_and_the_old_file(self):
        module = load_host("desertfox-bridge")
        os.makedirs(self.state_dir)
        module.write_atomically(self.state_path, {"seq": 1})
        original_replace = module.os.replace

        def failing_replace(*_args):
            raise OSError("disk full")

        module.os.replace = failing_replace
        try:
            with self.assertRaises(OSError):
                module.write_atomically(self.state_path, {"seq": 2})
        finally:
            module.os.replace = original_replace
        self.assertEqual(os.listdir(self.state_dir), ["state.json"])
        self.assertEqual(self.read_state(), {"seq": 1})

    def test_bad_messages_do_not_end_the_host(self):
        host = self.start()
        big = b'{"verb":"mode","id":"' + b"x" * (2 * 1024 * 1024) + b'"}'
        host.send_raw(struct.pack("=I", len(big)) + big)
        host.send_raw(struct.pack("=I", 8) + b"not json")
        host.send_raw(struct.pack("=I", 2) + b"\xff\xfe")
        host.send_raw(frame([1, 2, 3]))
        host.send_raw(frame("mode"))
        host.send_raw(frame(None))
        host.send_raw(struct.pack("=I", 4096 * 2) + b"[" * (4096 * 2))
        for verb in ("shell", "whichkey_show", "whichkey_hide", "run"):
            host.send({"verb": verb, "cmd": "touch /tmp/x"})
        host.send({"verb": "mode"})
        host.send(dict(MODE, tab_id="17"))
        host.send(dict(MODE, id="x" * 1000))
        host.send(dict(MODE, tab_id=True))
        host.send(dict(MODE, private="yes"))
        host.send(MODE)
        state = self.wait_for(lambda s: True)
        self.assertEqual(state["mode"]["id"], "insert")
        self.assertEqual(state["seq"], 1, "no bad message may count as a state change")
        self.assertIsNone(host.process.poll())
        host.close_stdin()
        self.assertEqual(host.wait(), 0)

    def test_a_frame_cut_off_at_eof_ends_the_host_clean(self):
        host = self.start()
        host.send(MODE)
        self.wait_for(lambda s: True)
        host.send_raw(struct.pack("=I", 100) + b"{")
        host.close_stdin()
        self.assertEqual(host.wait(), 0)
        self.assertFalse(os.path.exists(self.state_path))

    def test_a_frame_that_claims_an_absurd_size_ends_the_host_clean(self):
        host = self.start()
        host.send(MODE)
        self.wait_for(lambda s: True)
        host.send_raw(struct.pack("=I", 0xFFFFFFFF))
        self.assertEqual(host.wait(), 0)
        self.assertFalse(os.path.exists(self.state_path))

    def test_stdout_carries_only_the_ready_frame(self):
        host = self.start()
        host.send(MODE)
        host.send_raw(struct.pack("=I", 3) + b"bad")
        self.ask({"verb": "ping"})
        self.wait_for(lambda s: True)
        host.close_stdin()
        host.process.wait(timeout=10)
        self.assertEqual(host.process.stdout.read(), b"")
        host.process.stdout.close()
        host.process.stderr.close()

    def test_without_a_runtime_dir_it_exits_before_it_says_ready(self):
        env = {key: value for key, value in os.environ.items() if key != "XDG_RUNTIME_DIR"}
        done = subprocess.run([sys.executable, HOST_PATH], stdin=subprocess.DEVNULL, capture_output=True, env=env, timeout=10)
        self.assertEqual(done.returncode, 1)
        self.assertEqual(done.stdout, b"")


class LifecycleTest(BridgeTestCase):
    def test_eof_removes_the_state_file_and_the_socket_and_exits_clean(self):
        host = self.start()
        host.send(MODE)
        self.wait_for(lambda s: True)
        host.close_stdin()
        self.assertEqual(host.wait(), 0)
        self.assertFalse(os.path.exists(self.state_path))
        self.assertFalse(os.path.exists(self.socket_path))

    def test_sigterm_removes_the_state_file_and_the_socket(self):
        host = self.start()
        host.send(MODE)
        self.wait_for(lambda s: True)
        host.process.send_signal(signal.SIGTERM)
        self.assertEqual(host.wait(), 0)
        self.assertFalse(os.path.exists(self.state_path))
        self.assertFalse(os.path.exists(self.socket_path))

    def test_two_hosts_starting_at_once_leave_one_owner(self):
        first = self.start(wait_ready=False)
        second = self.start(wait_ready=False)
        started = time.monotonic()
        # Both processes race for the lock. Whoever loses waits 3 s and exits without ready.
        deadline = started + 10
        while time.monotonic() < deadline and first.process.poll() is None and second.process.poll() is None:
            time.sleep(0.05)
        losers = [host for host in (first, second) if host.process.poll() is not None]
        winners = [host for host in (first, second) if host.process.poll() is None]
        self.assertEqual(len(losers), 1)
        self.assertEqual(len(winners), 1)
        self.assertGreaterEqual(time.monotonic() - started, 2.5, "the loser must wait for the lock before it gives up")
        self.assertEqual(losers[0].process.wait(timeout=5), 1)
        self.assertEqual(losers[0].process.stdout.read(), b"", "the loser must not say ready")
        self.assertIn(b"another bridge host", losers[0].process.stderr.read())
        self.assertEqual(winners[0].read_ready(), {"ready": True, "host_version": 1})
        winners[0].send(MODE)
        self.wait_for(lambda s: s["host"]["pid"] == winners[0].process.pid)
        self.assertEqual(self.ask({"verb": "state"})["state"]["host"]["pid"], winners[0].process.pid)
        # The loser exiting must not have touched the winner's files.
        self.assertTrue(os.path.exists(self.socket_path))

    def test_a_second_host_takes_over_when_the_first_exits_inside_the_wait(self):
        first = self.start()
        first.send(MODE)
        self.wait_for(lambda s: True)
        second = self.start(wait_ready=False)
        time.sleep(0.5)
        self.assertIsNone(second.process.poll())
        first.close_stdin()
        first.wait()
        self.assertEqual(second.read_ready(), {"ready": True, "host_version": 1})
        second.send(dict(MODE, id="normal", label="NORMAL"))
        state = self.wait_for(lambda s: s["host"]["pid"] == second.process.pid)
        self.assertEqual(state["mode"]["id"], "normal")
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})

    def test_a_stale_socket_and_state_file_from_a_crashed_host_are_replaced(self):
        first = self.start()
        first.send(MODE)
        self.wait_for(lambda s: True)
        first.process.kill()
        first.process.wait()
        self.assertTrue(os.path.exists(self.socket_path), "a killed host leaves its socket behind")
        self.assertTrue(os.path.exists(self.state_path))
        second = self.start()
        # The stale state file goes at start, so a reader never takes the dead host's mode for the new one.
        self.assertFalse(os.path.exists(self.state_path))
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        self.assertIsNone(self.ask({"verb": "state"})["state"])
        second.send(dict(MODE, id="visual", label="VISUAL"))
        state = self.wait_for(lambda s: s["host"]["pid"] == second.process.pid)
        self.assertEqual(state["mode"]["id"], "visual")

    def test_a_leftover_plain_file_at_the_socket_path_is_replaced(self):
        os.makedirs(self.state_dir)
        with open(self.socket_path, "w") as leftover:
            leftover.write("junk")
        self.start()
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})

    def test_a_host_that_dies_while_firefox_runs_leaves_no_lock_behind(self):
        # SIGKILL gives the host no chance to clean up, which is what a crash does.
        first = self.start()
        first.process.kill()
        first.process.wait()
        started = time.monotonic()
        second = self.start()
        self.assertLess(time.monotonic() - started, 2.5, "the dead host's lock must be free at once")
        self.assertEqual(second.ready, {"ready": True, "host_version": 1})

    def test_the_folder_is_0700_and_the_socket_0600(self):
        os.makedirs(self.state_dir, mode=0o755)
        self.start()
        self.assertEqual(stat.S_IMODE(os.stat(self.state_dir).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(self.socket_path).st_mode), 0o600)


class SocketTest(BridgeTestCase):
    def test_ping_and_state(self):
        host = self.start()
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        self.assertEqual(self.ask({"verb": "state"}), {"ok": True, "state": None})
        host.send(MODE)
        state = self.wait_for(lambda s: True)
        self.assertEqual(self.ask({"verb": "state"}), {"ok": True, "state": state})

    def test_one_connection_takes_several_requests(self):
        self.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(5)
            client.connect(self.socket_path)
            client.sendall(b'{"verb":"ping"}\n{"verb":"ping"}\n')
            data = b""
            while data.count(b"\n") < 2:
                data += client.recv(4096)
        self.assertEqual(data, b'{"ok":true}\n{"ok":true}\n')

    def test_other_verbs_and_bad_requests_are_refused_and_the_host_lives(self):
        host = self.start()
        for verb in ("run", "list", "tabs", "activate", "whichkey_show", "shell", None, 5):
            self.assertEqual(self.ask({"verb": verb, "command": "touch /tmp/x"}), {"ok": False, "message": "unknown verb"})
        self.assertEqual(self.ask([1, 2]), {"ok": False, "message": "unknown verb"})
        self.assertEqual(self.ask(None, raw=b"not json\n"), {"ok": False, "message": "not JSON"})
        self.assertEqual(self.ask(None, raw=b"\xff\xfe\n"), {"ok": False, "message": "not JSON"})
        self.assertIsNone(host.process.poll())
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})

    def test_a_request_over_the_cap_is_refused(self):
        self.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(5)
            client.connect(self.socket_path)
            client.sendall(b"x" * (70 * 1024))
            data = client.recv(4096)
        self.assertEqual(json.loads(data), {"ok": False, "message": "request too large"})
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})

    def test_an_idle_connection_is_closed(self):
        self.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(10)
            client.connect(self.socket_path)
            started = time.monotonic()
            self.assertEqual(client.recv(10), b"")
            self.assertLess(time.monotonic() - started, 8)

    def test_connections_over_the_cap_are_dropped_and_the_host_recovers(self):
        self.start()
        held = []
        try:
            for _ in range(16):
                client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                client.connect(self.socket_path)
                held.append(client)
            time.sleep(0.2)
            extra = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            held.append(extra)
            extra.settimeout(5)
            extra.connect(self.socket_path)
            self.assertEqual(extra.recv(10), b"", "the 17th connection is closed without an answer")
        finally:
            for client in held:
                client.close()
        deadline = time.monotonic() + 5
        while True:
            try:
                self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
                break
            except (AssertionError, OSError, ValueError):
                if time.monotonic() > deadline:
                    raise
                time.sleep(0.05)


class AcceptErrorTest(BridgeTestCase):
    def test_a_transient_accept_error_does_not_end_the_server(self):
        import errno

        module = load_host("desertfox-bridge")
        module.ACCEPT_RETRY_S = 0.01
        os.makedirs(self.state_dir)
        real = module.bind_socket(self.socket_path)

        class Flaky:
            """Fails the first accept like a full descriptor table, then serves."""

            failures = 1

            def accept(self):
                if Flaky.failures:
                    Flaky.failures -= 1
                    raise OSError(errno.EMFILE, "too many open files")
                return real.accept()

            def fileno(self):
                return real.fileno()

        state = module.BridgeState(self.state_path, os.getpid(), "1")
        thread = threading.Thread(target=module.accept_loop, args=(Flaky(), state), daemon=True)
        thread.start()
        self.addCleanup(real.close)
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        self.assertTrue(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
