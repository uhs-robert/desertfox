"""Tests of the display host: the state file, the port lifecycle and bad input. Real processes, a temporary XDG_RUNTIME_DIR."""
import json
import os
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

HOST_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "desertfox-display-host")

MODE = {"verb": "mode", "id": "insert", "label": "INSERT", "tab_id": 17, "window_id": 3, "fullscreen": False, "private": False}
ROWS = [{"keys": "gt", "command": "Next tab", "description": "", "more": False}, {"keys": "gc", "command": "+Close tabs", "description": "", "more": True}]
SHOW = {"verb": "whichkey_show", "title": ["+Go"], "border": "square", "rows": ROWS}


def frame(message):
    payload = json.dumps(message).encode()
    return struct.pack("=I", len(payload)) + payload


class Host:
    def __init__(self, runtime_dir):
        env = dict(os.environ, XDG_RUNTIME_DIR=runtime_dir)
        self.process = subprocess.Popen([sys.executable, HOST_PATH], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        (length,) = struct.unpack("=I", self.process.stdout.read(4))
        self.ready = json.loads(self.process.stdout.read(length))

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


class DisplayHostTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.runtime = self.temp.name
        self.state_dir = os.path.join(self.runtime, "desertfox")
        self.state_path = os.path.join(self.state_dir, "state.json")
        self.hosts = []
        self.addCleanup(lambda: [host.kill() for host in self.hosts])

    def start(self):
        host = Host(self.runtime)
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

    def wait_gone(self):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if not os.path.exists(self.state_path):
                return
            time.sleep(0.01)
        self.fail("the state file was not deleted")

    def test_ready_then_mode_writes_the_agreed_shape(self):
        host = self.start()
        self.assertEqual(host.ready, {"ready": True, "host_version": 1})
        host.send(MODE)
        state = self.wait_for(lambda s: s["mode"] is not None)
        self.assertEqual(state["version"], 1)
        self.assertEqual(state["seq"], 1)
        self.assertEqual(state["host"], {"pid": host.process.pid, "start": state["host"]["start"]})
        self.assertIsInstance(state["host"]["start"], str)
        self.assertEqual(state["firefox"], {"window_id": 3, "fullscreen": False, "private": False})
        self.assertEqual(state["mode"], {"id": "insert", "label": "INSERT", "tab_id": 17})
        self.assertIsNone(state["whichkey"])

    def test_whichkey_show_and_hide_keep_the_mode_and_count_shows(self):
        host = self.start()
        host.send(MODE)
        host.send(SHOW)
        state = self.wait_for(lambda s: s["whichkey"] is not None)
        self.assertEqual(state["whichkey"], {"seq": 1, "title": ["+Go"], "border": "square", "rows": ROWS})
        self.assertEqual(state["mode"]["id"], "insert")
        host.send(dict(MODE, id="normal", label="NORMAL"))
        state = self.wait_for(lambda s: s["mode"]["id"] == "normal")
        self.assertEqual(state["whichkey"]["seq"], 1, "a mode change must not move the panel's seq")
        host.send(SHOW)
        state = self.wait_for(lambda s: s["whichkey"] is not None and s["whichkey"]["seq"] == 2)
        host.send({"verb": "whichkey_hide"})
        state = self.wait_for(lambda s: s["whichkey"] is None)
        self.assertGreater(state["seq"], 3)

    def test_seq_only_goes_up_and_a_repeated_hide_writes_nothing(self):
        host = self.start()
        host.send(MODE)
        seqs = [self.wait_for(lambda s: True)["seq"]]
        for _ in range(5):
            host.send(MODE)
            seqs.append(self.wait_for(lambda s: s["seq"] > seqs[-1])["seq"])
        host.send({"verb": "whichkey_hide"})
        time.sleep(0.2)
        self.assertEqual(self.read_state()["seq"], seqs[-1])
        self.assertEqual(seqs, sorted(set(seqs)))

    def test_nothing_is_written_before_the_first_mode(self):
        host = self.start()
        host.send(SHOW)
        host.send({"verb": "whichkey_hide"})
        host.send(MODE)
        state = self.wait_for(lambda s: True)
        self.assertIsNone(state["whichkey"])

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
        big_rows = [{"keys": "k%d" % i, "command": "c" * 200, "description": "d" * 200, "more": False} for i in range(200)]
        for count in range(100):
            host.send(dict(SHOW, rows=big_rows, title=["t%d" % count]))
        host.send(dict(MODE, id="visual", label="VISUAL"))
        self.wait_for(lambda s: s["mode"]["id"] == "visual")
        stop.set()
        thread.join()
        self.assertEqual(failures, [])
        self.assertEqual(os.listdir(self.state_dir), ["state.json"])

    def test_a_failed_write_leaves_no_temp_file_and_the_old_file(self):
        import importlib.machinery
        import importlib.util

        loader = importlib.machinery.SourceFileLoader("display_host", HOST_PATH)
        spec = importlib.util.spec_from_loader("display_host", loader)
        module = importlib.util.module_from_spec(spec)
        loader.exec_module(module)
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

    def test_eof_deletes_the_own_file_and_exits_clean(self):
        host = self.start()
        host.send(MODE)
        self.wait_for(lambda s: True)
        host.close_stdin()
        self.assertEqual(host.wait(), 0)
        self.assertFalse(os.path.exists(self.state_path))
        self.assertEqual(os.listdir(self.state_dir), [])

    def test_sigterm_deletes_the_own_file(self):
        host = self.start()
        host.send(MODE)
        self.wait_for(lambda s: True)
        host.process.send_signal(signal.SIGTERM)
        self.assertEqual(host.wait(), 0)
        self.assertFalse(os.path.exists(self.state_path))

    def test_exit_keeps_a_file_that_names_another_host(self):
        host = self.start()
        host.send(MODE)
        state = self.wait_for(lambda s: True)
        foreign = dict(state, host={"pid": host.process.pid + 1, "start": state["host"]["start"]}, seq=99)
        with open(self.state_path, "w", encoding="utf-8") as state_file:
            json.dump(foreign, state_file)
        host.close_stdin()
        host.wait()
        self.assertEqual(self.read_state(), foreign)

    def test_exit_keeps_a_file_with_the_same_pid_and_another_start(self):
        host = self.start()
        host.send(MODE)
        state = self.wait_for(lambda s: True)
        foreign = dict(state, host={"pid": host.process.pid, "start": str(int(state["host"]["start"]) + 1000)})
        with open(self.state_path, "w", encoding="utf-8") as state_file:
            json.dump(foreign, state_file)
        host.process.send_signal(signal.SIGTERM)
        host.wait()
        self.assertEqual(self.read_state(), foreign)

    def test_a_newer_host_wins_and_seq_never_goes_back_when_the_older_one_exits_late(self):
        old = self.start()
        old.send(MODE)
        for _ in range(3):
            old.send(MODE)
        old_state = self.wait_for(lambda s: s["seq"] >= 4)
        time.sleep(0.05)
        new = self.start()
        new.send(dict(MODE, id="normal", label="NORMAL"))
        new_state = self.wait_for(lambda s: s["host"]["pid"] == new.process.pid)
        self.assertGreater(int(new_state["host"]["start"]), int(old_state["host"]["start"]))
        self.assertGreater(new_state["seq"], old_state["seq"])
        seen = [new_state["seq"]]
        # The old host still writes: it must notice the newer owner and leave the file alone.
        old.send(dict(MODE, id="visual", label="VISUAL"))
        old.send(SHOW)
        time.sleep(0.3)
        after = self.read_state()
        self.assertEqual(after["host"]["pid"], new.process.pid)
        self.assertEqual(after["mode"]["id"], "normal")
        self.assertIsNone(after["whichkey"])
        seen.append(after["seq"])
        # And it exits late, which must not delete the new host's file.
        old.close_stdin()
        old.wait()
        after_exit = self.read_state()
        self.assertEqual(after_exit["host"]["pid"], new.process.pid)
        new.send(dict(MODE, id="insert", label="INSERT"))
        seen.append(self.wait_for(lambda s: s["mode"]["id"] == "insert")["seq"])
        self.assertEqual(seen, sorted(seen))

    def test_a_new_host_continues_the_seq_of_a_file_it_finds(self):
        os.makedirs(self.state_dir)
        with open(self.state_path, "w", encoding="utf-8") as state_file:
            json.dump({"version": 1, "seq": 500, "host": {"pid": 1, "start": "1"}, "firefox": None, "mode": None, "whichkey": None}, state_file)
        host = self.start()
        host.send(MODE)
        state = self.wait_for(lambda s: s["host"]["pid"] == host.process.pid)
        self.assertEqual(state["seq"], 501)

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
        host.send({"verb": "shell", "cmd": "touch /tmp/x"})
        host.send({"verb": "mode"})
        host.send(dict(MODE, tab_id="17"))
        host.send(dict(MODE, fullscreen=1))
        host.send(dict(MODE, id="x" * 1000))
        host.send(dict(MODE, tab_id=True))
        host.send(dict(SHOW, rows=[{"keys": "a"}]))
        host.send(dict(SHOW, rows="nope"))
        host.send(dict(SHOW, title="nope"))
        host.send(dict(SHOW, rows=[ROWS[0]] * 501))
        host.send(MODE)
        state = self.wait_for(lambda s: True)
        self.assertEqual(state["mode"]["id"], "insert")
        self.assertIsNone(state["whichkey"])
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


if __name__ == "__main__":
    unittest.main()
