"""Tests of the `desertfox` command line script: against a fake socket server for the protocol and exit codes, and against the real bridge host for one round trip."""
import json
import os
import select
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

import test_bridge

CLI_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "desertfox")


class FakeBridge:
    """Answers each request line with the next canned reply and keeps the requests it saw."""

    def __init__(self, path, replies):
        self.requests = []
        self.replies = list(replies)
        self.listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.listener.bind(path)
        self.listener.listen(4)
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while True:
            try:
                connection, _ = self.listener.accept()
            except OSError:
                return
            with connection:
                data = b""
                while not data.endswith(b"\n"):
                    chunk = connection.recv(4096)
                    if not chunk:
                        break
                    data += chunk
                self.requests.append(json.loads(data))
                reply = self.replies.pop(0)
                if reply is not None:
                    connection.sendall(reply if isinstance(reply, bytes) else json.dumps(reply).encode() + b"\n")

    def close(self):
        self.listener.close()


class CliTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dfc")
        self.addCleanup(self.temp.cleanup)
        self.runtime = self.temp.name
        os.makedirs(os.path.join(self.runtime, "desertfox"))
        self.socket_path = os.path.join(self.runtime, "desertfox", "bridge.sock")

    def serve(self, *replies):
        bridge = FakeBridge(self.socket_path, replies)
        self.addCleanup(bridge.close)
        return bridge

    def cli(self, *args, runtime=None):
        env = dict(os.environ, XDG_RUNTIME_DIR=self.runtime if runtime is None else runtime)
        return subprocess.run([sys.executable, CLI_PATH, *args], capture_output=True, text=True, env=env, timeout=20)

    def test_run_sends_the_words_as_one_command_line_and_exits_zero(self):
        bridge = self.serve({"ok": True}, {"ok": True}, {"ok": True})
        self.assertEqual(self.cli("run", "tab.next").returncode, 0)
        self.assertEqual(self.cli("run", "scroll.lines 3").returncode, 0)
        done = self.cli("run", "tab.switch", "my tab", "it's")
        self.assertEqual(done.returncode, 0)
        self.assertEqual(done.stdout, "")
        self.assertEqual([request["command"] for request in bridge.requests], ["tab.next", "scroll.lines 3", "tab.switch 'my tab' 'it'\"'\"'s'"])
        self.assertEqual({request["verb"] for request in bridge.requests}, {"run"})

    def test_a_refusal_prints_its_message_on_stderr_and_exits_one(self):
        self.serve({"ok": False, "message": "tab.close is not allowed through the bridge"})
        done = self.cli("run", "tab.close")
        self.assertEqual(done.returncode, 1)
        self.assertEqual(done.stdout, "")
        self.assertEqual(done.stderr, "desertfox: tab.close is not allowed through the bridge\n")

    def test_list_prints_one_line_per_command_and_json_on_request(self):
        commands = [
            {"id": "tab.next", "name": "next", "label": "Next tab"},
            {"id": "scroll.lines", "label": "Scroll lines", "params": [{"name": "count", "type": "int", "default": 1}, {"name": "dir", "type": "enum", "values": ["up", "down"]}]},
        ]
        self.serve({"ok": True, "commands": commands}, {"ok": True, "commands": commands})
        done = self.cli("list")
        self.assertEqual(done.returncode, 0)
        self.assertEqual(done.stdout.splitlines(), ["next\ttab.next\tNext tab\t", "scroll.lines\tscroll.lines\tScroll lines\t[count] dir=up|down"])
        self.assertEqual(json.loads(self.cli("list", "--json").stdout), commands)

    def test_state_prints_the_snapshot_or_null(self):
        self.serve({"ok": True, "state": {"seq": 2}}, {"ok": True, "state": None})
        self.assertEqual(json.loads(self.cli("state").stdout), {"seq": 2})
        self.assertEqual(self.cli("state").stdout.strip(), "null")

    def test_no_bridge_exits_three_with_a_plain_message(self):
        done = self.cli("run", "tab.next")
        self.assertEqual(done.returncode, 3)
        self.assertIn("the bridge is not running", done.stderr)
        self.assertEqual(self.cli("state", runtime="").returncode, 3)

    def test_a_listener_that_hangs_up_is_a_failure_not_a_hang(self):
        self.serve(None)
        done = self.cli("run", "tab.next")
        self.assertEqual(done.returncode, 3)
        self.assertIn("without an answer", done.stderr)

    def test_bad_usage_exits_two(self):
        for args in ([], ["run"], ["list", "--wide"], ["frobnicate"], ["state", "x"]):
            done = self.cli(*args)
            self.assertEqual(done.returncode, 2, args)
            self.assertIn("usage:", done.stderr + done.stdout)
        self.assertEqual(self.cli("--help").returncode, 0)

    def test_run_with_a_tab_sends_the_tab_id_and_keeps_the_command_after_it(self):
        bridge = self.serve({"ok": True}, {"ok": True}, {"ok": False, "message": "no such tab"})
        self.assertEqual(self.cli("run", "--tab", "42", "media.act", "play_pause").returncode, 0)
        self.assertEqual(self.cli("run", "--tab=7", "tab.next").returncode, 0)
        done = self.cli("run", "--tab", "9", "tab.next")
        self.assertEqual((done.returncode, done.stderr), (1, "desertfox: no such tab\n"))
        self.assertEqual(bridge.requests, [
            {"verb": "run", "tab_id": 42, "command": "media.act play_pause"},
            {"verb": "run", "tab_id": 7, "command": "tab.next"},
            {"verb": "run", "tab_id": 9, "command": "tab.next"},
        ])

    def test_a_tab_option_after_the_command_is_part_of_the_command(self):
        bridge = self.serve({"ok": True})
        self.cli("run", "open", "--tab", "https://example.org/")
        self.assertEqual(bridge.requests, [{"verb": "run", "command": "open --tab https://example.org/"}])

    def test_tabs_prints_one_line_per_tab_and_json_on_request(self):
        tabs = [
            {"tab_id": 10, "window_id": 1, "title": "Mail", "url": "https://mail.example/", "active": True, "audible": False, "discarded": False, "pinned": True},
            {"tab_id": 11, "window_id": 1, "title": "Music", "url": "https://music.example/", "audible": True},
        ]
        bridge = self.serve({"ok": True, "tabs": tabs}, {"ok": True, "tabs": tabs}, {"ok": False, "message": "tab sharing is off, set bridge_share_tabs to true"})
        self.assertEqual(self.cli("tabs").stdout.splitlines(), ["10\t1\ta--p\tMail\thttps://mail.example/", "11\t1\t-s--\tMusic\thttps://music.example/"])
        self.assertEqual(json.loads(self.cli("tabs", "--json").stdout), tabs)
        off = self.cli("tabs")
        self.assertEqual((off.returncode, off.stdout), (1, ""))
        self.assertIn("bridge_share_tabs", off.stderr)
        self.assertEqual({request["verb"] for request in bridge.requests}, {"tabs"})

    def test_tabs_current_asks_for_the_current_tab_only(self):
        tab = {"tab_id": 10, "window_id": 1, "title": "Mail", "url": "https://mail.example/", "active": True}
        bridge = self.serve({"ok": True, "tabs": [tab]}, {"ok": True, "tabs": []})
        self.assertEqual(json.loads(self.cli("tabs", "--current", "--json").stdout), [tab])
        empty = self.cli("tabs", "--current")
        self.assertEqual((empty.returncode, empty.stdout), (0, ""))
        self.assertEqual(bridge.requests, [{"verb": "tabs", "current": True}] * 2)

    def test_events_prints_each_event_line_and_exits_zero_when_the_host_ends(self):
        host = test_bridge.Host(self.runtime)
        self.addCleanup(host.kill)
        env = dict(os.environ, XDG_RUNTIME_DIR=self.runtime)
        events = subprocess.Popen([sys.executable, CLI_PATH, "events"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
        self.addCleanup(lambda: events.poll() is None and events.kill())
        host.send({"verb": "event", "event": "tab_removed", "tab_id": 4})
        # The CLI may subscribe after that event, so the test sends events until one arrives.
        line = ""
        deadline = time.monotonic() + 10
        while not line and time.monotonic() < deadline:
            host.send({"verb": "event", "event": "tab_removed", "tab_id": 5})
            if select.select([events.stdout], [], [], 0.2)[0]:
                line = events.stdout.readline()
        self.assertEqual({name: value for name, value in json.loads(line).items() if name != "seq"}, {"event": "tab_removed", "tab_id": 5})
        host.close_stdin()
        self.assertEqual(events.wait(10), 0)
        events.stdout.close()
        self.assertEqual(events.stderr.read(), "")
        events.stderr.close()

    def test_events_refused_by_the_bridge_exits_one_and_without_a_bridge_three(self):
        self.serve({"ok": False, "message": "too many subscribers"})
        refused = self.cli("events")
        self.assertEqual((refused.returncode, refused.stderr), (1, "desertfox: too many subscribers\n"))
        self.assertEqual(self.cli("events", runtime=os.path.join(self.runtime, "none")).returncode, 3)

    def test_activate_clear_preface_and_close_send_their_fields(self):
        bridge = self.serve({"ok": True, "window_id": 1, "focused": True, "preface_set": True, "extra": 1}, {"ok": True, "window_id": 1, "focused": True, "preface_set": False}, {"ok": True, "cleared": True}, {"ok": True}, {"ok": False, "message": "no such tab"})
        done = self.cli("activate", "10", "--preface", "abc123")
        self.assertEqual(json.loads(done.stdout), {"window_id": 1, "focused": True, "preface_set": True})
        self.assertEqual(self.cli("activate", "11").returncode, 0)
        self.assertEqual(json.loads(self.cli("clear-preface", "1", "--preface=abc123").stdout), {"cleared": True})
        closed = self.cli("close", "12")
        self.assertEqual((closed.returncode, closed.stdout), (0, ""))
        stale = self.cli("close", "999")
        self.assertEqual((stale.returncode, stale.stderr), (1, "desertfox: no such tab\n"))
        self.assertEqual(bridge.requests, [
            {"verb": "activate", "tab_id": 10, "preface": "abc123"},
            {"verb": "activate", "tab_id": 11},
            {"verb": "clear_preface", "window_id": 1, "preface": "abc123"},
            {"verb": "close", "tab_id": 12},
            {"verb": "close", "tab_id": 999},
        ])

    def test_capture_prints_the_path_of_each_image_and_exits_one_when_any_failed(self):
        results = [{"tab_id": 10, "ok": True, "thumbnail": "/cache/a.jpg", "thumbnail_at": 5}, {"tab_id": 11, "ok": False, "thumbnail": "", "thumbnail_at": 0, "error": "the tab is not loaded"}]
        bridge = self.serve({"ok": True, "results": results[:1]}, {"ok": True, "results": results})
        self.assertEqual(self.cli("capture").stdout, "10\t/cache/a.jpg\n")
        done = self.cli("capture", "10", "11")
        self.assertEqual((done.returncode, done.stdout.splitlines()), (1, ["10\t/cache/a.jpg", "11\tfailed: the tab is not loaded"]))
        self.assertEqual(bridge.requests, [{"verb": "capture"}, {"verb": "capture", "tab_ids": [10, 11]}])

    def test_tab_commands_with_bad_usage_exit_two_and_send_nothing(self):
        bridge = self.serve()
        for args in (["activate"], ["activate", "x"], ["activate", "1", "2"], ["close"], ["close", "a"], ["clear-preface"], ["clear-preface", "1", "--preface"], ["run", "--tab"], ["run", "--tab", "x", "tab.next"], ["run", "--tab", "5"], ["capture", "z"], ["tabs", "--wide"], ["tabs", "--current", "--current"], ["events", "x"]):
            done = self.cli(*args)
            self.assertEqual(done.returncode, 2, args)
            self.assertIn("usage:", done.stderr)
        self.assertEqual(bridge.requests, [])

    def test_a_round_trip_through_the_real_host(self):
        host = test_bridge.Host(self.runtime)
        self.addCleanup(host.kill)
        done = {}
        thread = threading.Thread(target=lambda: done.update(result=self.cli("run", "scroll.lines", "3")))
        thread.start()
        request = host.read_request()
        self.assertEqual(request["command"], "scroll.lines 3")
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": False, "message": "no normal window is open"})
        thread.join(20)
        self.assertEqual(done["result"].returncode, 1)
        self.assertEqual(done["result"].stderr, "desertfox: no normal window is open\n")


if __name__ == "__main__":
    unittest.main()
