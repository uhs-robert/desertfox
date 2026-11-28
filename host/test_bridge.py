"""Tests of the bridge host: the lock, the socket, the state file, the port lifecycle and bad input. Real processes, a temporary XDG_RUNTIME_DIR."""
import fcntl
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
import unittest.mock

from host_under_test import load_host

HOST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "desertfox-bridge")

# The arguments Firefox and Thunderbird pass a native host: the manifest path, then the extension id.
FIREFOX_ARGV = ("/home/u/.mozilla/native-messaging-hosts/desertfox_bridge.json", "desertfox@uhs-robert")
THUNDERBIRD_ARGV = ("/home/u/.mozilla/native-messaging-hosts/desertbird_bridge.json", "desertbird@uhs-robert")

MODE = {"verb": "mode", "id": "insert", "label": "INSERT", "tab_id": 17, "window_id": 3, "private": False}
PRIVATE_MODE = {"verb": "mode", "id": "normal", "label": "NORMAL", "private": True}

# How long a test waits for something that must happen. A wait ends the moment the thing happens, so a
# long bound costs nothing on a green run and only keeps a starved CPU from failing the test.
LIVENESS_S = 15
LIVENESS_CAP_S = 120


def liveness_s():
    """LIVENESS_S stretched by the machine load (one-minute average per core), never past LIVENESS_CAP_S. Read at each wait, so a load that builds up mid-run counts."""
    load_per_core = os.getloadavg()[0] / (os.cpu_count() or 1)
    return min(LIVENESS_CAP_S, LIVENESS_S * max(1, load_per_core))


def scaled_s(seconds):
    """A time bound that only catches a hang, stretched by the same load factor as liveness_s."""
    return seconds * liveness_s() / LIVENESS_S


def frame(message):
    payload = json.dumps(message).encode()
    return struct.pack("=I", len(payload)) + payload


class Host:
    """A bridge host process. With wait_ready False the constructor returns at once, for a host that is meant to wait for the lock."""

    def __init__(self, runtime_dir, wait_ready=True, cache_home=None, argv=()):
        env = dict(os.environ, XDG_RUNTIME_DIR=runtime_dir)
        # Never the real cache: a host that starts without one prunes whatever cache_home holds.
        env["XDG_CACHE_HOME"] = cache_home if cache_home is not None else os.path.join(runtime_dir, "cache")
        self.process = subprocess.Popen([sys.executable, HOST_PATH, *argv], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env, bufsize=0)
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

    def read_ready(self, timeout=None):
        # A host that never says ready fails the test instead of hanging the suite.
        timeout = timeout or liveness_s()
        waiting, _, _ = select.select([self.process.stdout], [], [], timeout)
        if not waiting:
            self.kill()
            raise AssertionError("the host did not say ready within %s s" % timeout)
        return self.read_frame()

    def read_request(self, timeout=None, what="a request"):
        """The next frame the host sends to the extension after ready: a run or list request. `what` names it in the failure."""
        timeout = timeout or liveness_s()
        waiting, _, _ = select.select([self.process.stdout], [], [], timeout)
        if not waiting:
            raise AssertionError("the host sent no request for %s within %.0f s" % (what, timeout))
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
        self.process.wait(timeout=liveness_s())
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

    def start(self, wait_ready=True, argv=()):
        host = Host(self.runtime, wait_ready, self.cache_home, argv)
        self.hosts.append(host)
        return host

    def read_state(self):
        with open(self.state_path, encoding="utf-8") as state_file:
            return json.load(state_file)

    def wait_for(self, condition, what="the state file"):
        deadline = time.monotonic() + liveness_s()
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
        deadline = time.monotonic() + liveness_s()
        while time.monotonic() < deadline:
            if not os.path.exists(path):
                return
            time.sleep(0.01)
        self.fail("%s was not deleted" % path)

    def ask(self, request, raw=None, socket_path=None):
        """One request line on a new connection, the decoded reply line."""
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(liveness_s())
            client.connect(socket_path or self.socket_path)
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
        host.process.wait(timeout=liveness_s())
        self.assertEqual(host.process.stdout.read(), b"")
        host.process.stdout.close()
        host.process.stderr.close()

    def test_without_a_runtime_dir_it_exits_before_it_says_ready(self):
        env = {key: value for key, value in os.environ.items() if key != "XDG_RUNTIME_DIR"}
        done = subprocess.run([sys.executable, HOST_PATH], stdin=subprocess.DEVNULL, capture_output=True, env=env, timeout=liveness_s())
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
        deadline = started + liveness_s()
        while time.monotonic() < deadline and first.process.poll() is None and second.process.poll() is None:
            time.sleep(0.05)
        losers = [host for host in (first, second) if host.process.poll() is not None]
        winners = [host for host in (first, second) if host.process.poll() is None]
        self.assertEqual(len(losers), 1)
        self.assertEqual(len(winners), 1)
        self.assertGreaterEqual(time.monotonic() - started, 2.5, "the loser must wait for the lock before it gives up")
        self.assertEqual(losers[0].process.wait(timeout=liveness_s()), 1)
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
        self.assertLess(time.monotonic() - started, scaled_s(2.5), "the dead host's lock must be free at once")
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
            client.settimeout(liveness_s())
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
            client.settimeout(liveness_s())
            client.connect(self.socket_path)
            client.sendall(b"x" * (200 * 1024))
            data = client.recv(4096)
        self.assertEqual(json.loads(data), {"ok": False, "message": "request too large"})
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})

    def test_an_idle_connection_is_closed(self):
        self.start()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(liveness_s())
            client.connect(self.socket_path)
            started = time.monotonic()
            self.assertEqual(client.recv(10), b"")
            self.assertLess(time.monotonic() - started, scaled_s(12))

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
            extra.settimeout(liveness_s())
            extra.connect(self.socket_path)
            self.assertEqual(extra.recv(10), b"", "the 17th connection is closed without an answer")
        finally:
            for client in held:
                client.close()
        deadline = time.monotonic() + liveness_s()
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
        self.connection.settimeout(liveness_s())
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
        self.thread.join(liveness_s())
        self.connection.close()
        return self.reply


class LivenessTest(BridgeTestCase):
    def test_a_host_that_sends_no_request_fails_and_names_the_request(self):
        host = self.start()
        with self.assertRaisesRegex(AssertionError, r"no request for tabs \(request 2 of 6\) within 1 s"):
            host.read_request(timeout=1, what="tabs (request 2 of 6)")

    def test_the_wait_grows_with_the_load_and_stops_at_the_cap(self):
        cores = os.cpu_count() or 1
        for load_per_core, expected in ((0, LIVENESS_S), (1, LIVENESS_S), (4, 4 * LIVENESS_S), (100, LIVENESS_CAP_S)):
            with unittest.mock.patch("os.getloadavg", return_value=(load_per_core * cores, 0, 0)):
                self.assertEqual(liveness_s(), expected)


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
        self.assertLess(time.monotonic() - started, liveness_s())
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
            client.settimeout(liveness_s())
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

    def push(self, host, theme, answer=True):
        """Pushes over the socket, answers the host's request like the extension does and returns (reply, the request)."""
        client = Client(self.socket_path, {"verb": "theme", "theme": theme})
        request = host.read_request()
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": answer})
        return client.result(), request

    def test_a_push_goes_to_the_extension_with_the_theme_and_nothing_else(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "theme", "theme": "oasis_dune", "setting": "bridge", "value": True, "command": "config.reload"})
        request = host.read_request()
        self.assertEqual(request, {"verb": "theme", "request_id": request["request_id"], "theme": "oasis_dune"})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "message": "m" * 2000, "url": "https://x"})
        reply = client.result()
        self.assertEqual(set(reply), {"ok", "message"})
        self.assertEqual(len(reply["message"]), 500)

    def test_a_refusal_of_the_extension_comes_back_and_the_name_is_dropped(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "theme", "theme": "no_such"})
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
            json.dump({"theme": "no_such"}, kept)
        first = self.start()
        replay = first.read_request()
        self.assertEqual(replay["theme"], "no_such")
        first.send({"verb": "reply", "request_id": replay["request_id"], "ok": False, "message": "no built-in theme has that name"})
        self.wait_path_gone(self.theme_path())
        first.close_stdin()
        first.wait()
        second = self.start()
        with self.assertRaises(AssertionError):
            second.read_request(timeout=0.3)

    def test_a_name_of_the_wrong_shape_never_reaches_the_extension_or_the_file(self):
        host = self.start()
        for theme in (None, 5, "", "a" * 65, "../x", "has space", "line\nbreak", "--help", "-x", "_x", ["oasis_dune"], {"a": 1}):
            reply = self.ask({"verb": "theme", "theme": theme})
            self.assertFalse(reply["ok"], theme)
        self.assertFalse(self.ask({"verb": "theme"})["ok"])
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)
        self.assertFalse(os.path.exists(self.theme_path()))

    def test_the_theme_verb_is_the_only_way_to_a_theme_and_sets_no_other_setting(self):
        host = self.start()
        for request in ({"verb": "settings.set", "name": "theme", "value": "x"}, {"verb": "set", "setting": "bridge", "value": False}):
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

    def test_the_last_theme_is_written_to_its_own_file(self):
        host = self.start()
        self.push(host, "oasis_dune")
        self.push(host, "oasis_rose")
        with open(self.theme_path(), encoding="utf-8") as kept:
            self.assertEqual(json.load(kept), {"theme": "oasis_rose"})

    def test_every_connect_replays_the_kept_theme_once_right_after_ready(self):
        first = self.start()
        self.push(first, "oasis_dune")
        first.close_stdin()
        first.wait()
        for _ in range(2):
            host = self.start()
            replay = host.read_request()
            self.assertEqual(replay, {"verb": "theme", "request_id": replay["request_id"], "theme": "oasis_dune"})
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
        self.assertEqual(request["theme"], "oasis_rose")
        self.assertTrue(reply["ok"])
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def test_a_corrupt_theme_file_and_a_stale_temp_file_are_ignored_and_the_temp_file_is_removed(self):
        os.makedirs(self.state_dir, mode=0o700)
        for content in (b"", b"{", b"[1]", b'{"theme": 5}', b'{"theme": "../x"}'):
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
            # No stored theme from the last round, or the replay would send a second name.
            if os.path.exists(self.path):
                os.unlink(self.path)
            keeper = self.module.ThemeKeeper(self.path)
            pusher = threading.Thread(target=lambda: keeper.push(link, "oasis_rose"))
            opener = threading.Thread(target=lambda: keeper.say_ready(link))
            pusher.start()
            opener.start()
            pusher.join(liveness_s())
            opener.join(liveness_s())
            time.sleep(0.06)
            sent = self.frames(out.getvalue())
            self.assertTrue(sent[0].get("ready"), sent)
            self.assertEqual([frame.get("theme") for frame in sent[1:]], ["oasis_rose"], sent)

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
        self.assertEqual(reply, {"ok": False, "message": "could not keep the theme"})
        self.assertIsNone(keeper.theme)
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
            self.assertEqual(json.load(kept), {"theme": "oasis_dune"})
        self.assertEqual(os.listdir(self.temp.name), ["theme.json"])
        self.assertEqual(self.module.ThemeKeeper(self.path).theme, "oasis_dune")

    def unknown_name_reply(self):
        return {"ok": False, "request_id": 1, "message": self.module.UNKNOWN_THEME_MESSAGE}

    def test_a_generic_failure_of_the_extension_keeps_the_name(self):
        import io

        keeper = self.module.ThemeKeeper(self.path)
        keeper.push(self.module.ExtensionLink(io.BytesIO()), "oasis_dune")
        keeper.drop_if_refused("oasis_dune", {"ok": False, "request_id": 1, "message": "the command failed"})
        self.assertEqual(keeper.theme, "oasis_dune")
        self.assertTrue(os.path.exists(self.path))

    def test_a_push_right_after_the_replay_started_survives_the_refusal_of_the_replay(self):
        import io

        self.module.REQUEST_TIMEOUT_S = 0.5
        link = self.module.ExtensionLink(io.BytesIO())
        keeper = self.module.ThemeKeeper(self.path)
        keeper.push(link, "oasis_dune")
        outer = self

        class GuardThatPushesOnRelease:
            """Lets a push in right after the replay started, before say_ready returns."""

            def __init__(self):
                self.inner = threading.Lock()
                self.fired = False

            def __enter__(self):
                self.inner.acquire()

            def __exit__(self, *_exc):
                self.inner.release()
                if self.fired:
                    return
                self.fired = True
                pusher = threading.Thread(target=lambda: keeper.push(link, "oasis_rose"))
                pusher.start()
                deadline = time.monotonic() + liveness_s()
                while keeper.theme != "oasis_rose" and time.monotonic() < deadline:
                    time.sleep(0.005)
                link.answered({"request_id": 1, "ok": False, "message": outer.module.UNKNOWN_THEME_MESSAGE})
                time.sleep(0.1)
                pusher.join(liveness_s())

        keeper.guard = GuardThatPushesOnRelease()
        link.say_ready()
        keeper.say_ready(link)
        self.assertEqual(keeper.theme, "oasis_rose")
        self.assertTrue(os.path.exists(self.path))

    def test_an_unanswered_push_keeps_the_name(self):
        import io

        out = io.BytesIO()
        link = self.module.ExtensionLink(out)
        link.say_ready()
        keeper = self.module.ThemeKeeper(self.path)
        self.assertEqual(keeper.push(link, "oasis_dune"), {"ok": False, "message": "the extension did not answer in time"})
        self.assertEqual(keeper.theme, "oasis_dune")
        self.assertEqual(self.module.ThemeKeeper(self.path).theme, "oasis_dune")

    def test_a_refusal_of_an_older_name_does_not_drop_a_newer_one(self):
        import io

        keeper = self.module.ThemeKeeper(self.path)
        keeper.push(self.module.ExtensionLink(io.BytesIO()), "oasis_rose")
        keeper.drop_if_refused("oasis_dune", self.unknown_name_reply())
        self.assertEqual(keeper.theme, "oasis_rose")
        keeper.drop_if_refused("oasis_rose", self.unknown_name_reply())
        self.assertIsNone(keeper.theme)
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

    def test_a_request_that_comes_while_the_ready_frame_goes_out_is_sent_after_it(self):
        import io

        results = []
        askers = []
        open_checked = threading.Event()

        class SignalsOnRelease(threading.Condition):
            """The link's pending guard. The asker leaves it right after the open check, refused or not."""

            def __exit__(self, *exc):
                super().__exit__(*exc)
                open_checked.set()

        class AsksOnReady(io.BytesIO):
            """Asks from another thread once the ready frame is written: an extension that read it and a client that connected at once."""

            def flush(self):
                if askers:
                    return
                askers.append(threading.Thread(target=lambda: results.append(link.ask("list", {}, liveness_s()))))
                askers[0].start()
                # The ready write stays in progress until the asker has checked `open`, however slow its thread is to start.
                if not open_checked.wait(liveness_s()):
                    raise AssertionError("the asker never checked whether the link is open")

        out = AsksOnReady()
        link = self.module.ExtensionLink(out)
        link.pending_guard = SignalsOnRelease()
        link.say_ready()
        deadline = time.monotonic() + liveness_s()
        while not link.pending and not results and time.monotonic() < deadline:
            time.sleep(0.01)
        link.answered({"verb": "reply", "request_id": 1, "ok": True})
        askers[0].join(liveness_s())
        self.assertEqual(results, [{"verb": "reply", "request_id": 1, "ok": True}])
        self.assertEqual([frame.get("verb", "ready") for frame in ThemeKeeperTest.frames(self, out.getvalue())], ["ready", "list"])

    def test_requests_over_the_pending_cap_are_refused_at_once(self):
        import io

        link = self.module.ExtensionLink(io.BytesIO())
        link.say_ready()
        results = []
        threads = [threading.Thread(target=lambda: results.append(link.ask("run", {"command": "x"}, liveness_s()))) for _ in range(self.module.MAX_PENDING)]
        for thread in threads:
            thread.start()
        deadline = time.monotonic() + liveness_s()
        while len(link.pending) < self.module.MAX_PENDING and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertEqual(link.ask("run", {"command": "x"}, liveness_s()), {"ok": False, "message": "too many requests are waiting"})
        link.close()
        for thread in threads:
            thread.join(liveness_s())
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


class AppFromArgvTest(unittest.TestCase):
    def setUp(self):
        self.module = load_host("desertfox-bridge")

    def test_each_manifest_and_its_own_extension_pick_its_app(self):
        self.assertEqual(self.module.app_from_argv(list(FIREFOX_ARGV)), "firefox")
        self.assertEqual(self.module.app_from_argv(list(THUNDERBIRD_ARGV)), "thunderbird")
        self.assertEqual(self.module.app_from_argv([THUNDERBIRD_ARGV[0]]), "thunderbird")

    def test_no_arguments_is_firefox_as_before(self):
        self.assertEqual(self.module.app_from_argv([]), "firefox")

    def test_an_unknown_or_crossed_value_is_refused_never_guessed(self):
        for argv in (
            ["/x/other_bridge.json", "desertfox@uhs-robert"],
            ["/x/desertfox_bridge", "desertfox@uhs-robert"],
            [""],
            [FIREFOX_ARGV[0], "desertbird@uhs-robert"],
            [THUNDERBIRD_ARGV[0], "desertfox@uhs-robert"],
            [THUNDERBIRD_ARGV[0], "someone@else"],
            [THUNDERBIRD_ARGV[0], ""],
        ):
            with self.assertRaises(ValueError, msg=argv):
                self.module.app_from_argv(argv)

    def test_the_firefox_paths_are_the_ones_shipped_before_thunderbird(self):
        with unittest.mock.patch.dict(os.environ, {"XDG_RUNTIME_DIR": "/run/user/1"}):
            paths = self.module.runtime_paths("firefox")
            self.assertEqual(paths["folder"], "/run/user/1/desertfox")
            self.assertEqual(paths["bridge.sock"], "/run/user/1/desertfox/bridge.sock")
            self.assertEqual(paths["bridge.lock"], "/run/user/1/desertfox/bridge.lock")
            self.assertEqual(self.module.runtime_paths("thunderbird")["folder"], "/run/user/1/desertbird")


class TwoAppsTest(BridgeTestCase):
    """A Firefox host and a Thunderbird host from one script, each in its own runtime folder."""

    def setUp(self):
        super().setUp()
        self.bird_dir = os.path.join(self.runtime, "desertbird")
        self.bird_socket = os.path.join(self.bird_dir, "bridge.sock")
        self.bird_lock = os.path.join(self.bird_dir, "bridge.lock")
        self.bird_state = os.path.join(self.bird_dir, "state.json")

    def pid_on(self, socket_path, host, mode):
        """Sends a mode to the host and returns the pid the state verb on `socket_path` names, once that mode shows."""
        host.send(mode)
        deadline = time.monotonic() + liveness_s()
        while time.monotonic() < deadline:
            state = self.ask({"verb": "state"}, socket_path=socket_path)["state"]
            if state and state["mode"]["id"] == mode["id"]:
                return state["host"]["pid"]
            time.sleep(0.01)
        self.fail("the mode never showed on %s" % socket_path)

    def assert_lock_held(self, path):
        descriptor = os.open(path, os.O_RDWR)
        try:
            with self.assertRaises(BlockingIOError, msg=path):
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(descriptor)

    def test_a_thunderbird_host_keeps_to_its_own_folder(self):
        host = self.start(argv=THUNDERBIRD_ARGV)
        self.assertEqual(host.ready, {"ready": True, "host_version": 1, "release_version": "dev"})
        self.assertEqual(self.pid_on(self.bird_socket, host, MODE), host.process.pid)
        with open(self.bird_state, encoding="utf-8") as state_file:
            self.assertEqual(json.load(state_file)["mode"]["id"], "insert")
        self.assertFalse(os.path.exists(self.state_dir), "a Thunderbird host makes nothing in the Firefox folder")
        self.assertEqual(stat.S_IMODE(os.stat(self.bird_dir).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(self.bird_socket).st_mode), 0o600)
        host.close_stdin()
        self.assertEqual(host.wait(), 0)
        self.assertEqual(sorted(os.listdir(self.bird_dir)), ["bridge.lock"])

    def test_a_firefox_host_started_by_firefox_uses_the_shipped_folder(self):
        host = self.start(argv=FIREFOX_ARGV)
        self.assertEqual(self.pid_on(self.socket_path, host, MODE), host.process.pid)
        self.assertFalse(os.path.exists(self.bird_dir))

    def test_both_hosts_start_at_once_and_neither_waits_on_the_other(self):
        started = time.monotonic()
        firefox = self.start(wait_ready=False, argv=FIREFOX_ARGV)
        thunderbird = self.start(wait_ready=False, argv=THUNDERBIRD_ARGV)
        self.assertEqual(firefox.read_ready()["ready"], True)
        self.assertEqual(thunderbird.read_ready()["ready"], True)
        self.assertLess(time.monotonic() - started, scaled_s(2.5), "a host that waited on the other's lock would take 3 s")
        self.assertEqual(self.pid_on(self.socket_path, firefox, MODE), firefox.process.pid)
        self.assertEqual(self.pid_on(self.bird_socket, thunderbird, dict(MODE, id="normal", label="NORMAL")), thunderbird.process.pid)
        self.assert_lock_held(self.lock_path)
        self.assert_lock_held(self.bird_lock)

    def test_a_second_thunderbird_host_exits_and_leaves_both_running_hosts_alone(self):
        firefox = self.start(argv=FIREFOX_ARGV)
        thunderbird = self.start(argv=THUNDERBIRD_ARGV)
        self.pid_on(self.socket_path, firefox, MODE)
        firefox_socket = os.stat(self.socket_path).st_ino
        bird_socket = os.stat(self.bird_socket).st_ino
        second = self.start(wait_ready=False, argv=THUNDERBIRD_ARGV)
        self.assertEqual(second.process.wait(timeout=liveness_s()), 1)
        self.assertEqual(second.process.stdout.read(), b"", "the second host must not say ready")
        self.assertIn(b"another bridge host", second.process.stderr.read())
        self.assertEqual((os.stat(self.socket_path).st_ino, os.stat(self.bird_socket).st_ino), (firefox_socket, bird_socket))
        self.assertEqual(self.ask({"verb": "state"})["state"]["host"]["pid"], firefox.process.pid)
        self.assertEqual(self.pid_on(self.bird_socket, thunderbird, MODE), thunderbird.process.pid)

    def test_a_dead_hosts_socket_is_replaced_without_touching_the_other_apps_live_socket(self):
        for dead_argv, dead_socket, live_argv, live_socket in (
            (THUNDERBIRD_ARGV, self.bird_socket, FIREFOX_ARGV, self.socket_path),
            (FIREFOX_ARGV, self.socket_path, THUNDERBIRD_ARGV, self.bird_socket),
        ):
            with self.subTest(dead=dead_argv[1]):
                live = self.start(argv=live_argv)
                dead = self.start(argv=dead_argv)
                dead.process.kill()
                dead.process.wait()
                self.assertTrue(os.path.exists(dead_socket), "a killed host leaves its socket behind")
                live_inode = os.stat(live_socket).st_ino
                replacement = self.start(argv=dead_argv)
                self.assertEqual(self.pid_on(dead_socket, replacement, MODE), replacement.process.pid)
                self.assertEqual(os.stat(live_socket).st_ino, live_inode)
                self.assertEqual(self.pid_on(live_socket, live, MODE), live.process.pid)
                for host in (live, replacement):
                    host.close_stdin()
                    self.assertEqual(host.wait(), 0)

    def test_unknown_or_crossed_arguments_start_no_host_and_leave_a_running_one_alone(self):
        firefox = self.start(argv=FIREFOX_ARGV)
        inode = os.stat(self.socket_path).st_ino
        for argv in (("/x/other_bridge.json", "desertfox@uhs-robert"), (FIREFOX_ARGV[0], "desertbird@uhs-robert"), (THUNDERBIRD_ARGV[0], "desertfox@uhs-robert")):
            with self.subTest(argv=argv):
                refused = self.start(wait_ready=False, argv=argv)
                started = time.monotonic()
                self.assertEqual(refused.process.wait(timeout=liveness_s()), 1)
                self.assertLess(time.monotonic() - started, scaled_s(2.5), "it stops before it takes any lock")
                self.assertEqual(refused.process.stdout.read(), b"")
                self.assertIn(b"cannot start", refused.process.stderr.read())
        self.assertFalse(os.path.exists(self.bird_dir))
        self.assertEqual(os.stat(self.socket_path).st_ino, inode)
        self.assertEqual(self.pid_on(self.socket_path, firefox, MODE), firefox.process.pid)

    def test_a_thunderbird_host_has_no_tab_verbs_and_never_touches_the_firefox_tab_caches(self):
        old_thumbnail = os.path.join(self.cache_home, "desertfox", "bridge-thumbs", "a" * 64 + ".jpg")
        os.makedirs(os.path.dirname(old_thumbnail))
        with open(old_thumbnail, "wb") as image:
            image.write(b"\xff\xd8")
        month_ago = time.time() - 30 * 24 * 3600
        os.utime(old_thumbnail, (month_ago, month_ago))
        host = self.start(argv=THUNDERBIRD_ARGV)
        for request in ({"verb": "tabs"}, {"verb": "capture"}, {"verb": "close", "tab_id": 1}):
            self.assertEqual(self.ask(request, socket_path=self.bird_socket), {"ok": False, "message": "tab verbs need --app firefox"})
        host.send({"verb": "event", "event": "tabs_off"})
        # Messages are taken in order, so once this mode shows the event before it was handled.
        self.pid_on(self.bird_socket, host, MODE)
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)
        self.assertTrue(os.path.exists(old_thumbnail), "neither the start prune nor tabs_off may delete a Firefox image")


class ThunderbirdLinkTest(BridgeTestCase):
    """The frames the DesertBird add-on speaks, driven through a Thunderbird host from the socket side."""

    def setUp(self):
        super().setUp()
        self.bird_socket = os.path.join(self.runtime, "desertbird", "bridge.sock")

    def test_a_desertbird_style_add_on_runs_lists_and_reports_its_mode(self):
        host = self.start(argv=THUNDERBIRD_ARGV)
        self.assertEqual(host.ready, {"ready": True, "host_version": 1, "release_version": "dev"})
        commands = [{"id": "pane.toggle", "label": "Toggle a pane", "intent": "show or hide a pane", "params": [{"name": "pane", "type": "enum", "values": ["folder"]}]}]
        listing = Client(self.bird_socket, {"verb": "list"})
        request = host.read_request(what="list")
        self.assertEqual(request, {"verb": "list", "request_id": request["request_id"]})
        self.assertIsInstance(request["request_id"], int)
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "commands": commands})
        self.assertEqual(listing.result(), {"ok": True, "commands": commands})
        run = Client(self.bird_socket, {"verb": "run", "command": "pane.toggle folder"})
        request = host.read_request(what="run")
        self.assertEqual(request, {"verb": "run", "request_id": request["request_id"], "command": "pane.toggle folder"})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": False, "message": "msg.delete never runs through the bridge"})
        self.assertEqual(run.result(), {"ok": False, "message": "msg.delete never runs through the bridge"})
        host.send({"verb": "mode", "id": "visual", "label": "VISUAL", "private": False, "tab_id": 7, "window_id": 3})
        state = self.wait_for_bird_state("visual")
        self.assertEqual((state["firefox"], state["mode"]), ({"window_id": 3, "private": False}, {"id": "visual", "label": "VISUAL", "tab_id": 7}))

    def test_theme_and_a_run_in_a_tab_are_refused_and_never_reach_the_add_on(self):
        theme_file = os.path.join(self.runtime, "desertbird", "theme.json")
        os.makedirs(os.path.dirname(theme_file))
        with open(theme_file, "w", encoding="utf-8") as kept:
            json.dump({"theme": "oasis_dune"}, kept)
        host = self.start(argv=THUNDERBIRD_ARGV)
        self.assertEqual(self.ask({"verb": "theme", "theme": "gruvbox"}, socket_path=self.bird_socket), {"ok": False, "message": "theme needs --app firefox"})
        self.assertEqual(self.ask({"verb": "run", "command": "msg.next", "tab_id": 17}, socket_path=self.bird_socket), {"ok": False, "message": "tab verbs need --app firefox"})
        with self.assertRaises(AssertionError, msg="no theme replay after ready and no request"):
            host.read_request(timeout=0.3)
        with open(theme_file, encoding="utf-8") as kept:
            self.assertEqual(json.load(kept), {"theme": "oasis_dune"}, "a refused push writes nothing")

    def test_state_is_answered_by_the_host_and_never_sent_to_the_add_on(self):
        host = self.start(argv=THUNDERBIRD_ARGV)
        self.assertEqual(self.ask({"verb": "state"}, socket_path=self.bird_socket), {"ok": True, "state": None})
        host.send({"verb": "mode", "id": "normal", "label": "NORMAL", "private": False, "tab_id": 7, "window_id": 3})
        self.assertEqual(self.wait_for_bird_state("normal")["host"]["pid"], host.process.pid)
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def wait_for_bird_state(self, mode_id):
        deadline = time.monotonic() + liveness_s()
        while time.monotonic() < deadline:
            state = self.ask({"verb": "state"}, socket_path=self.bird_socket)["state"]
            if state and state["mode"]["id"] == mode_id:
                return state
            time.sleep(0.01)
        self.fail("the Thunderbird host never showed mode %s" % mode_id)


class MailReadTest(BridgeTestCase):
    """The mail reads: on the Thunderbird socket only, fields checked before the add-on, replies passed through."""

    def setUp(self):
        super().setUp()
        self.bird_socket = os.path.join(self.runtime, "desertbird", "bridge.sock")

    def read(self, host, request, reply):
        """Sends one read, answers it as the add-on with `reply`, and returns (what the add-on got, what the client got)."""
        client = Client(self.bird_socket, request)
        sent = host.read_request(what=request["verb"])
        host.send(dict(reply, verb="reply", request_id=sent["request_id"]))
        return sent, client.result()

    def test_each_read_goes_to_the_add_on_with_only_its_fields_and_the_reply_comes_back_as_it_was(self):
        host = self.start(argv=THUNDERBIRD_ARGV)
        cases = [
            ({"verb": "folders", "extra": 1}, {}, {"ok": True, "folders": [{"id": "f1", "name": "Inbox", "path": "/INBOX", "account": "a1", "unread": 2, "total": 9}]}),
            ({"verb": "messages", "folder": "f1", "limit": 200, "unread_only": True, "path": "/etc"}, {"folder": "f1", "limit": 200, "unread_only": True},
             {"ok": True, "messages": [{"id": 4, "from": "a@b", "subject": "Hi", "date": "2026-11-17T08:00:00Z", "folder": "f1", "read": False, "flagged": False}], "truncated": False}),
            ({"verb": "messages", "folder": "x" * 1024}, {"folder": "x" * 1024}, {"ok": True, "messages": [], "truncated": False}),
            ({"verb": "message", "id": 4}, {"id": 4},
             {"ok": True, "message": {"id": 4, "from": "a@b", "to": ["c@d"], "subject": "Hi", "date": "2026-11-17T08:00:00Z", "content_type": "text/html", "body": "text", "untrusted": True, "html_stripped": True, "truncated": False}}),
            ({"verb": "attachments", "id": 4}, {"id": 4}, {"ok": True, "attachments": [{"part": "1.2", "name": "a.pdf", "size": 10, "content_type": "application/pdf"}]}),
            ({"verb": "message", "id": 5}, {"id": 5}, {"ok": False, "message": "the body is encrypted"}),
            ({"verb": "contacts", "query": "ann", "limit": 20, "path": "/etc"}, {"query": "ann", "limit": 20},
             {"ok": True, "contacts": [{"name": "Ann", "emails": ["ann@example.org"]}], "untrusted": True, "truncated": False}),
            ({"verb": "contacts", "query": "x" * 100}, {"query": "x" * 100}, {"ok": True, "contacts": [], "untrusted": True, "truncated": False}),
            ({"verb": "contacts", "query": "ann"}, {"query": "ann"}, {"ok": False, "message": "contact sharing is off, set bridge_share_contacts to true"}),
        ]
        for request, fields, reply in cases:
            with self.subTest(request=request["verb"]):
                sent, result = self.read(host, request, reply)
                self.assertEqual(sent, dict(fields, verb=request["verb"], request_id=sent["request_id"]))
                self.assertEqual(result, reply)

    def test_a_read_of_the_wrong_shape_is_refused_and_never_reaches_the_add_on(self):
        host = self.start(argv=THUNDERBIRD_ARGV)
        for request in (
            {"verb": "messages"}, {"verb": "messages", "folder": ""}, {"verb": "messages", "folder": "x" * 1025}, {"verb": "messages", "folder": 3},
            {"verb": "messages", "folder": "f1", "limit": 0}, {"verb": "messages", "folder": "f1", "limit": 201},
            {"verb": "messages", "folder": "f1", "limit": True}, {"verb": "messages", "folder": "f1", "limit": "5"},
            {"verb": "messages", "folder": "f1", "unread_only": "yes"},
            {"verb": "message"}, {"verb": "message", "id": "4"}, {"verb": "message", "id": True}, {"verb": "message", "id": 1.5},
            {"verb": "attachments", "id": None},
            {"verb": "contacts"}, {"verb": "contacts", "query": ""}, {"verb": "contacts", "query": 5}, {"verb": "contacts", "query": "x" * 101},
            {"verb": "contacts", "query": "\U0001F600" * 51}, {"verb": "contacts", "query": "an\nn"}, {"verb": "contacts", "query": "an\x00"},
            {"verb": "contacts", "query": "ann", "limit": 0}, {"verb": "contacts", "query": "ann", "limit": 21},
            {"verb": "contacts", "query": "ann", "limit": True}, {"verb": "contacts", "query": "ann", "limit": "5"},
        ):
            with self.subTest(request=request):
                reply = self.ask(request, socket_path=self.bird_socket)
                self.assertIs(reply["ok"], False)
                self.assertIsInstance(reply["message"], str)
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def test_the_firefox_socket_refuses_every_read(self):
        host = self.start(argv=FIREFOX_ARGV)
        for request in ({"verb": "folders"}, {"verb": "messages", "folder": "f1"}, {"verb": "message", "id": 4}, {"verb": "attachments", "id": 4}, {"verb": "contacts", "query": "ann"}):
            self.assertEqual(self.ask(request), {"ok": False, "message": "mail reads need --app thunderbird"})
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def test_reads_share_the_rate_limit(self):
        host = self.start(argv=THUNDERBIRD_ARGV)
        for _ in range(10):
            self.read(host, {"verb": "folders"}, {"ok": True, "folders": []})
        self.assertEqual(self.ask({"verb": "message", "id": 1}, socket_path=self.bird_socket), {"ok": False, "message": "rate limit: too many requests, slow down"})
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def test_a_reply_near_the_cap_passes_whole_and_one_over_it_is_dropped(self):
        host = self.start(argv=THUNDERBIRD_ARGV)
        body = "b" * (1024 * 1024 - 4096)
        sent, result = self.read(host, {"verb": "message", "id": 4}, {"ok": True, "message": {"id": 4, "body": body}})
        self.assertEqual(result["message"]["body"], body)
        client = Client(self.bird_socket, {"verb": "message", "id": 5})
        request_id = host.read_request(what="message")["request_id"]
        host.send({"verb": "reply", "request_id": request_id, "ok": True, "message": {"id": 5, "body": "b" * (1024 * 1024)}})
        # The host skipped the oversized frame unread, so the request still waits and the next reply answers it.
        host.send({"verb": "reply", "request_id": request_id, "ok": False, "message": "too large"})
        self.assertEqual(client.result(), {"ok": False, "message": "too large"})


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
        # The accept thread is a daemon that outlives the test, so the recorder is never undone.
        logged = []
        module.log = logged.append
        thread = threading.Thread(target=module.accept_loop, args=(Flaky(), state, module.ExtensionLink(None), module.EventHub()), daemon=True)
        thread.start()
        self.addCleanup(real.close)
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        self.assertTrue(thread.is_alive())
        self.assertEqual(len(logged), 1)
        self.assertIn("accept failed, retrying", logged[0])


if __name__ == "__main__":
    unittest.main()
