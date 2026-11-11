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

    def __init__(self, runtime_dir, wait_ready=True, cache_home=None):
        env = dict(os.environ, XDG_RUNTIME_DIR=runtime_dir)
        # Never the real cache: a host that starts without one prunes whatever cache_home holds.
        env["XDG_CACHE_HOME"] = cache_home if cache_home is not None else os.path.join(runtime_dir, "cache")
        self.process = subprocess.Popen([sys.executable, HOST_PATH], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, bufsize=0)
        self.ready = self.read_ready() if wait_ready else None

    def read_frame(self):
        # Unbuffered, so a frame that follows another one stays visible to `select`.
        (length,) = struct.unpack("=I", self.read_bytes(4))
        return json.loads(self.read_bytes(length))

    def read_bytes(self, count):
        data = b""
        while len(data) < count:
            chunk = self.process.stdout.read(count - len(data))
            if not chunk:
                raise AssertionError("the host closed its output mid-frame")
            data += chunk
        return data

    def read_ready(self, timeout=10):
        # A host that never says ready fails the test instead of hanging the suite.
        waiting, _, _ = select.select([self.process.stdout], [], [], timeout)
        if not waiting:
            self.kill()
            raise AssertionError("the host did not say ready within %s s" % timeout)
        return self.read_frame()

    def read_request(self, timeout=5):
        """The next frame the host sends to the extension after ready: a run or list request."""
        waiting, _, _ = select.select([self.process.stdout], [], [], timeout)
        if not waiting:
            raise AssertionError("the host sent no request within %s s" % timeout)
        return self.read_frame()

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
        # Thumbnails go under the cache home, so no test writes into the real one.
        self.cache_home = os.path.join(self.runtime, "cache")
        self.hosts = []
        self.addCleanup(lambda: [host.kill() for host in self.hosts])

    def start(self, wait_ready=True):
        host = Host(self.runtime, wait_ready, self.cache_home)
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
        self.assertEqual(host.ready, {"ready": True, "host_version": 1, "release_version": "dev"})
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
        self.assertEqual(winners[0].read_ready(), {"ready": True, "host_version": 1, "release_version": "dev"})
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
        self.assertEqual(second.read_ready(), {"ready": True, "host_version": 1, "release_version": "dev"})
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
        self.assertEqual(second.ready, {"ready": True, "host_version": 1, "release_version": "dev"})

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
        for verb in ("whichkey_show", "shell", "eval", "capture_tab", None, 5):
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


class Client:
    """A socket client that sends one request line and reads its reply on its own thread, so many can wait at once."""

    def __init__(self, socket_path, request):
        self.connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.connection.settimeout(15)
        self.connection.connect(socket_path)
        self.reply = None
        self.thread = threading.Thread(target=self.exchange, args=(request,), daemon=True)
        self.thread.start()

    def exchange(self, request):
        try:
            self.connection.sendall(json.dumps(request).encode() + b"\n")
            data = b""
            while not data.endswith(b"\n"):
                chunk = self.connection.recv(4096)
                if not chunk:
                    break
                data += chunk
            self.reply = json.loads(data) if data else None
        except OSError:
            pass

    def result(self):
        self.thread.join(15)
        self.connection.close()
        return self.reply


class RunAndListTest(BridgeTestCase):
    def test_run_goes_to_the_extension_and_the_reply_comes_back(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "run", "command": "tab.next"})
        request = host.read_request()
        self.assertEqual(request, {"verb": "run", "request_id": request["request_id"], "command": "tab.next"})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True})
        self.assertEqual(client.result(), {"ok": True})

    def test_a_refusal_keeps_its_message(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "run", "command": "config.reload"})
        host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": False, "message": "config.reload never runs through the bridge"})
        self.assertEqual(client.result(), {"ok": False, "message": "config.reload never runs through the bridge"})

    def test_a_run_reply_carries_no_page_data(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "run", "command": "tab.next"})
        host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": True, "message": "m" * 2000, "text": "page text", "url": "https://x", "commands": [1]})
        reply = client.result()
        self.assertEqual(set(reply), {"ok", "message"})
        self.assertEqual(len(reply["message"]), 500)

    def test_list_returns_the_commands(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "list"})
        request = host.read_request()
        self.assertEqual(request, {"verb": "list", "request_id": request["request_id"]})
        commands = [{"id": "tab.next", "label": "Next tab", "params": []}]
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "commands": commands})
        self.assertEqual(client.result(), {"ok": True, "commands": commands})

    def test_a_run_without_a_command_is_refused_and_never_reaches_the_extension(self):
        host = self.start()
        for request in ({"verb": "run"}, {"verb": "run", "command": ""}, {"verb": "run", "command": "   "}, {"verb": "run", "command": 5}, {"verb": "run", "command": "x" * 5000}):
            self.assertEqual(self.ask(request), {"ok": False, "message": "run needs a command text"})
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def test_two_clients_at_once_each_get_their_own_reply_when_the_answers_come_in_reverse(self):
        host = self.start()
        first = Client(self.socket_path, {"verb": "run", "command": "first"})
        asked_first = host.read_request()
        second = Client(self.socket_path, {"verb": "run", "command": "second"})
        asked_second = host.read_request()
        self.assertNotEqual(asked_first["request_id"], asked_second["request_id"])
        host.send({"verb": "reply", "request_id": asked_second["request_id"], "ok": True, "message": "answer to second"})
        host.send({"verb": "reply", "request_id": asked_first["request_id"], "ok": False, "message": "answer to first"})
        self.assertEqual(first.result(), {"ok": False, "message": "answer to first"})
        self.assertEqual(second.result(), {"ok": True, "message": "answer to second"})

    def test_many_clients_against_the_cap_all_get_their_own_answer_and_the_host_lives(self):
        host = self.start()
        clients = [Client(self.socket_path, {"verb": "run", "command": "cmd%d" % number}) for number in range(10)]
        requests = [host.read_request() for _ in clients]
        self.assertEqual(len({request["request_id"] for request in requests}), 10)
        for request in reversed(requests):
            host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "message": request["command"]})
        for number, client in enumerate(clients):
            self.assertEqual(client.result(), {"ok": True, "message": "cmd%d" % number})
        self.assertIsNone(host.process.poll())
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})

    def test_a_client_that_leaves_mid_request_does_not_hurt_the_next_one(self):
        host = self.start()
        leaver = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        leaver.connect(self.socket_path)
        leaver.sendall(b'{"verb":"run","command":"gone"}\n')
        gone = host.read_request()
        leaver.close()
        stayer = Client(self.socket_path, {"verb": "run", "command": "stays"})
        stays = host.read_request()
        # The late reply to the client that left finds a closed socket, and the stayer's reply is untouched.
        host.send({"verb": "reply", "request_id": gone["request_id"], "ok": True, "message": "late"})
        host.send({"verb": "reply", "request_id": stays["request_id"], "ok": True, "message": "mine"})
        self.assertEqual(stayer.result(), {"ok": True, "message": "mine"})
        self.assertIsNone(host.process.poll())
        again = Client(self.socket_path, {"verb": "run", "command": "after"})
        host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": True})
        self.assertEqual(again.result(), {"ok": True})

    def test_a_reply_nobody_waits_for_is_dropped(self):
        host = self.start()
        for stray in ({"verb": "reply", "request_id": 999, "ok": True}, {"verb": "reply", "ok": True}, {"verb": "reply", "request_id": "1", "ok": True}, {"verb": "reply", "request_id": True, "ok": True}):
            host.send(stray)
        client = Client(self.socket_path, {"verb": "run", "command": "x"})
        host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": True})
        self.assertEqual(client.result(), {"ok": True})

    def test_the_extension_going_away_fails_the_waiting_run_and_does_not_hang_it(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "run", "command": "tab.next"})
        host.read_request()
        started = time.monotonic()
        host.close_stdin()
        self.assertEqual(client.result(), {"ok": False, "message": "the extension disconnected"})
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(host.wait(), 0)

    def test_a_run_after_the_host_is_gone_cannot_connect(self):
        host = self.start()
        host.close_stdin()
        host.wait()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client, self.assertRaises(OSError):
            client.connect(self.socket_path)

    def test_the_rate_limit_is_for_the_host_so_a_new_connection_per_call_is_limited_too(self):
        host = self.start()
        clients = []
        for number in range(10):
            clients.append(Client(self.socket_path, {"verb": "list"}))
            host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": True, "commands": []})
        for client in clients:
            self.assertEqual(client.result(), {"ok": True, "commands": []})
        self.assertEqual(self.ask({"verb": "list"}), {"ok": False, "message": "rate limit: too many requests, slow down"})
        self.assertEqual(self.ask({"verb": "run", "command": "tab.next"}), {"ok": False, "message": "rate limit: too many requests, slow down"})
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)
        time.sleep(1.1)
        again = Client(self.socket_path, {"verb": "list"})
        host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": True, "commands": []})
        self.assertEqual(again.result(), {"ok": True, "commands": []})

    def test_a_refused_run_over_the_rate_limit_never_reaches_the_extension(self):
        host = self.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(5)
            client.connect(self.socket_path)
            client.sendall(b'{"verb":"run","command":"tab.next"}\n' * 12)
            for _ in range(10):
                host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": True})
            data = b""
            while data.count(b"\n") < 12:
                data += client.recv(4096)
        replies = [json.loads(line) for line in data.splitlines()]
        self.assertEqual(replies[:10], [{"ok": True}] * 10)
        self.assertEqual([reply["ok"] for reply in replies[10:]], [False, False])
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)


class ThemeTest(BridgeTestCase):
    def theme_path(self):
        return os.path.join(self.state_dir, "theme.json")

    def push(self, host, palette, answer=True):
        """Pushes over the socket, answers the host's request like the extension does and returns (reply, the request)."""
        client = Client(self.socket_path, {"verb": "theme", "palette": palette})
        request = host.read_request()
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": answer})
        return client.result(), request

    def test_a_push_goes_to_the_extension_with_the_palette_and_nothing_else(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "theme", "palette": "oasis_dune", "setting": "bridge", "value": True, "command": "config.reload"})
        request = host.read_request()
        self.assertEqual(request, {"verb": "theme", "request_id": request["request_id"], "palette": "oasis_dune"})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "message": "m" * 2000, "url": "https://x"})
        reply = client.result()
        self.assertEqual(set(reply), {"ok", "message"})
        self.assertEqual(len(reply["message"]), 500)

    def test_a_refusal_of_the_extension_comes_back_and_the_name_is_dropped(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "theme", "palette": "no_such"})
        host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": False, "message": "no built-in theme has that name"})
        self.assertEqual(client.result(), {"ok": False, "message": "no built-in theme has that name"})
        self.assertFalse(os.path.exists(self.theme_path()))
        host.close_stdin()
        host.wait()
        later = self.start()
        with self.assertRaises(AssertionError):
            later.read_request(timeout=0.3)

    def test_a_kept_name_the_extension_refuses_on_replay_is_dropped_and_not_replayed_again(self):
        os.makedirs(self.state_dir, mode=0o700)
        with open(self.theme_path(), "w", encoding="utf-8") as kept:
            json.dump({"palette": "no_such"}, kept)
        first = self.start()
        replay = first.read_request()
        self.assertEqual(replay["palette"], "no_such")
        first.send({"verb": "reply", "request_id": replay["request_id"], "ok": False, "message": "no built-in theme has that name"})
        self.wait_path_gone(self.theme_path())
        first.close_stdin()
        first.wait()
        second = self.start()
        with self.assertRaises(AssertionError):
            second.read_request(timeout=0.3)

    def test_a_name_of_the_wrong_shape_never_reaches_the_extension_or_the_file(self):
        host = self.start()
        for palette in (None, 5, "", "a" * 65, "../x", "has space", "line\nbreak", "--help", "-x", "_x", ["oasis_dune"], {"a": 1}):
            reply = self.ask({"verb": "theme", "palette": palette})
            self.assertFalse(reply["ok"], palette)
        self.assertFalse(self.ask({"verb": "theme"})["ok"])
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)
        self.assertFalse(os.path.exists(self.theme_path()))

    def test_the_theme_verb_is_the_only_way_to_a_palette_and_sets_no_other_setting(self):
        host = self.start()
        for request in ({"verb": "settings.set", "name": "palette", "value": "x"}, {"verb": "set", "setting": "bridge", "value": False}):
            self.assertEqual(self.ask(request), {"ok": False, "message": "unknown verb"})
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def test_theme_pushes_are_not_rate_limited(self):
        host = self.start()
        for _ in range(self.module_limit() + 5):
            reply, _request = self.push(host, "oasis_dune")
            self.assertTrue(reply["ok"], reply)

    def module_limit(self):
        return load_host("desertfox-bridge").RATE_LIMIT_REQUESTS

    def test_the_last_palette_is_written_to_its_own_file(self):
        host = self.start()
        self.push(host, "oasis_dune")
        self.push(host, "oasis_rose")
        with open(self.theme_path(), encoding="utf-8") as kept:
            self.assertEqual(json.load(kept), {"palette": "oasis_rose"})

    def test_every_connect_replays_the_kept_palette_once_right_after_ready(self):
        first = self.start()
        self.push(first, "oasis_dune")
        first.close_stdin()
        first.wait()
        for _ in range(2):
            host = self.start()
            replay = host.read_request()
            self.assertEqual(replay, {"verb": "theme", "request_id": replay["request_id"], "palette": "oasis_dune"})
            with self.assertRaises(AssertionError):
                host.read_request(timeout=0.3)
            host.close_stdin()
            host.wait()

    def test_a_host_with_nothing_kept_replays_nothing(self):
        host = self.start()
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def test_a_push_later_than_the_replay_is_sent_once_and_the_file_follows_it(self):
        first = self.start()
        self.push(first, "oasis_dune")
        first.close_stdin()
        first.wait()
        host = self.start()
        host.read_request()
        reply, request = self.push(host, "oasis_rose")
        self.assertEqual(request["palette"], "oasis_rose")
        self.assertTrue(reply["ok"])
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def test_a_corrupt_theme_file_and_a_stale_temp_file_are_ignored_and_the_temp_file_is_removed(self):
        os.makedirs(self.state_dir, mode=0o700)
        for content in (b"", b"{", b"[1]", b'{"palette": 5}', b'{"palette": "../x"}'):
            with open(self.theme_path(), "wb") as kept:
                kept.write(content)
            stale = os.path.join(self.state_dir, ".state.dead.tmp")
            with open(stale, "w") as leftover:
                leftover.write("half")
            host = self.start()
            with self.assertRaises(AssertionError):
                host.read_request(timeout=0.3)
            self.assertFalse(os.path.exists(stale))
            host.close_stdin()
            host.wait()


class ThemeKeeperTest(unittest.TestCase):
    """The keeper in process, with a link that writes into a buffer and a clock short enough to run fast."""

    def setUp(self):
        self.module = load_host("desertfox-bridge")
        self.module.REQUEST_TIMEOUT_S = 0.05
        self.temp = tempfile.TemporaryDirectory(prefix="dft")
        self.addCleanup(self.temp.cleanup)
        self.path = os.path.join(self.temp.name, "theme.json")

    def frames(self, data):
        found = []
        while data:
            (length,) = struct.unpack("=I", data[:4])
            found.append(json.loads(data[4:4 + length]))
            data = data[4 + length:]
        return found

    def test_a_push_before_ready_is_kept_and_replayed_once(self):
        import io

        out = io.BytesIO()
        link = self.module.ExtensionLink(out)
        keeper = self.module.ThemeKeeper(self.path)
        self.assertEqual(keeper.push(link, "oasis_dune"), {"ok": True, "message": "kept for when the extension connects"})
        self.assertEqual(out.getvalue(), b"")
        keeper.say_ready(link)
        self.assertEqual([frame["verb"] if "verb" in frame else "ready" for frame in self.frames(out.getvalue())], ["ready", "theme"])

    def test_a_push_and_a_ready_at_the_same_time_send_the_name_exactly_once_after_ready(self):
        import io

        for _ in range(200):
            out = io.BytesIO()
            link = self.module.ExtensionLink(out)
            # No stored palette from the last round, or the replay would send a second name.
            if os.path.exists(self.path):
                os.unlink(self.path)
            keeper = self.module.ThemeKeeper(self.path)
            pusher = threading.Thread(target=lambda: keeper.push(link, "oasis_rose"))
            opener = threading.Thread(target=lambda: keeper.say_ready(link))
            pusher.start()
            opener.start()
            pusher.join(5)
            opener.join(5)
            time.sleep(0.06)
            sent = self.frames(out.getvalue())
            self.assertTrue(sent[0].get("ready"), sent)
            self.assertEqual([frame.get("palette") for frame in sent[1:]], ["oasis_rose"], sent)

    def test_a_failed_write_is_a_failed_reply_and_keeps_and_sends_nothing(self):
        import io

        out = io.BytesIO()
        link = self.module.ExtensionLink(out)
        link.say_ready()
        keeper = self.module.ThemeKeeper(self.path)
        sent_before = out.getvalue()
        real_replace = os.replace
        os.replace = lambda *_args: (_ for _ in ()).throw(OSError("disk full"))
        try:
            reply = keeper.push(link, "oasis_rose")
        finally:
            os.replace = real_replace
        self.assertEqual(reply, {"ok": False, "message": "could not keep the palette"})
        self.assertIsNone(keeper.palette)
        self.assertEqual(out.getvalue(), sent_before)

    def test_a_write_cut_short_leaves_the_old_file_and_no_temp_file(self):
        import io

        keeper = self.module.ThemeKeeper(self.path)
        keeper.push(self.module.ExtensionLink(io.BytesIO()), "oasis_dune")
        real_replace = os.replace

        def stop_before_rename(*_args):
            raise OSError("host stopped")

        os.replace = stop_before_rename
        try:
            keeper.push(self.module.ExtensionLink(io.BytesIO()), "oasis_rose")
        finally:
            os.replace = real_replace
        with open(self.path, encoding="utf-8") as kept:
            self.assertEqual(json.load(kept), {"palette": "oasis_dune"})
        self.assertEqual(os.listdir(self.temp.name), ["theme.json"])
        self.assertEqual(self.module.ThemeKeeper(self.path).palette, "oasis_dune")


    def test_an_unanswered_push_keeps_the_name(self):
        import io

        out = io.BytesIO()
        link = self.module.ExtensionLink(out)
        link.say_ready()
        keeper = self.module.ThemeKeeper(self.path)
        self.assertEqual(keeper.push(link, "oasis_dune"), {"ok": False, "message": "the extension did not answer in time"})
        self.assertEqual(keeper.palette, "oasis_dune")
        self.assertEqual(self.module.ThemeKeeper(self.path).palette, "oasis_dune")

    def test_a_refusal_of_an_older_name_does_not_drop_a_newer_one(self):
        import io

        keeper = self.module.ThemeKeeper(self.path)
        keeper.push(self.module.ExtensionLink(io.BytesIO()), "oasis_rose")
        keeper.drop_if_refused("oasis_dune", {"ok": False, "request_id": 1})
        self.assertEqual(keeper.palette, "oasis_rose")
        keeper.drop_if_refused("oasis_rose", {"ok": False, "request_id": 2})
        self.assertIsNone(keeper.palette)
        self.assertFalse(os.path.exists(self.path))


class LinkTest(unittest.TestCase):
    """The pieces that need a clock or a count, driven in process."""

    def setUp(self):
        self.module = load_host("desertfox-bridge")

    def test_the_limiter_admits_the_limit_per_window_and_a_refusal_is_not_counted(self):
        now = [0.0]
        limiter = self.module.RateLimiter(3, 1.0, clock=lambda: now[0])
        self.assertEqual([limiter.admit() for _ in range(5)], [True, True, True, False, False])
        now[0] = 0.99
        self.assertFalse(limiter.admit())
        now[0] = 1.0
        self.assertEqual([limiter.admit() for _ in range(4)], [True, True, True, False])

    def test_a_request_before_ready_is_refused_and_writes_nothing(self):
        import io

        out = io.BytesIO()
        link = self.module.ExtensionLink(out)
        self.assertEqual(link.ask("run", {"command": "x"}, 1), {"ok": False, "message": "the extension is not connected"})
        self.assertEqual(out.getvalue(), b"")

    def test_requests_over_the_pending_cap_are_refused_at_once(self):
        import io

        link = self.module.ExtensionLink(io.BytesIO())
        link.say_ready()
        results = []
        threads = [threading.Thread(target=lambda: results.append(link.ask("run", {"command": "x"}, 5))) for _ in range(self.module.MAX_PENDING)]
        for thread in threads:
            thread.start()
        deadline = time.monotonic() + 5
        while len(link.pending) < self.module.MAX_PENDING and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(link.ask("run", {"command": "x"}, 5), {"ok": False, "message": "too many requests are waiting"})
        link.close()
        for thread in threads:
            thread.join(5)
        self.assertEqual(len(results), self.module.MAX_PENDING)
        self.assertEqual({result["message"] for result in results}, {"the extension disconnected"})

    def test_an_extension_that_never_answers_times_out_and_frees_its_slot(self):
        import io

        link = self.module.ExtensionLink(io.BytesIO())
        link.say_ready()
        self.assertEqual(link.ask("run", {"command": "x"}, 0.05), {"ok": False, "message": "the extension did not answer in time"})
        self.assertEqual(link.pending, {})

    def test_a_broken_stdout_fails_the_request_cleanly(self):
        class Broken:
            writes = 0

            def write(self, data):
                Broken.writes += 1
                if Broken.writes > 1:
                    raise BrokenPipeError()

            def flush(self):
                pass

        link = self.module.ExtensionLink(Broken())
        link.say_ready()
        self.assertEqual(link.ask("run", {"command": "x"}, 1), {"ok": False, "message": "the extension is not connected"})
        self.assertEqual(link.pending, {})


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
        thread = threading.Thread(target=module.accept_loop, args=(Flaky(), state, module.ExtensionLink(None), module.EventHub()), daemon=True)
        thread.start()
        self.addCleanup(real.close)
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        self.assertTrue(thread.is_alive())


if __name__ == "__main__":
    unittest.main()
