"""Tests of the bridge host's mail writes, `draft` and `act`: the field checks, the Firefox refusal, the reply cut, the
one pending act and its long wait, against a real Thunderbird host and, where a clock must be short, in process."""
import io
import json
import os
import socket
import struct
import tempfile
import threading
import time
import unittest

from host_under_test import load_host
from test_bridge import FIREFOX_ARGV, THUNDERBIRD_ARGV, BridgeTestCase, Client, liveness_s

DRAFT = {"verb": "draft", "to": ["ann@example.org"], "subject": "Lunch", "body": "Hi,\nlunch at noon?"}
ACT = {"verb": "act", "action": "archive", "ids": [4, 5]}
RATE_LIMITED = {"ok": False, "message": "rate limit: too many requests, slow down"}


class WriteTestCase(BridgeTestCase):
    def setUp(self):
        super().setUp()
        self.bird_socket = os.path.join(self.runtime, "desertbird", "bridge.sock")

    def start_bird(self):
        return self.start(argv=THUNDERBIRD_ARGV)

    def ask_bird(self, request):
        return self.ask(request, socket_path=self.bird_socket)

    def answer(self, host, request, reply):
        """Sends one request, answers it as the add-on with `reply`, and returns (what the add-on got, what the client got)."""
        client = Client(self.bird_socket, request)
        sent = host.read_request(what=request["verb"])
        host.send(dict(reply, verb="reply", request_id=sent["request_id"]))
        return sent, client.result()

    def assert_nothing_sent(self, host):
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)


class DraftTest(WriteTestCase):
    def test_a_draft_goes_to_the_add_on_with_only_its_fields_and_the_reply_carries_no_draft_id(self):
        host = self.start_bird()
        request = dict(DRAFT, cc=["bob@example.org"], to=["Ann <ann@example.org>", "cy@example.org"], extra="x", account="a2")
        request["from"] = "me@example.org"
        sent, result = self.answer(host, request, {"ok": True, "draft_id": 99, "message": "saved", "body": "leak"})
        fields = {name: request[name] for name in ("to", "cc", "from", "subject", "body")}
        self.assertEqual(sent, dict(fields, verb="draft", request_id=sent["request_id"]))
        self.assertEqual(result, {"ok": True, "message": "saved"})

    def test_a_reply_draft_may_leave_out_to_and_a_refusal_keeps_its_message(self):
        host = self.start_bird()
        sent, result = self.answer(host, dict(DRAFT, to=[], reply_to_id=7), {"ok": False, "message": "no such identity"})
        self.assertEqual((sent["to"], sent["reply_to_id"]), ([], 7))
        self.assertEqual(result, {"ok": False, "message": "no such identity"})

    def test_a_draft_of_the_wrong_shape_is_refused_and_never_reaches_the_add_on(self):
        host = self.start_bird()
        for change in (
            {"to": []}, {"to": "ann@example.org"}, {"to": ["a@b"] * 11}, {"to": [3]}, {"to": [""]}, {"to": ["a" * 321]},
            {"to": ["ann@example.org\r\nBcc: eve@example.org"]}, {"to": ["a\x00@b"]}, {"to": ["a\x85@b"]},
            {"cc": ["a@b"] * 11}, {"cc": "a@b"}, {"cc": ["a\n@b"]},
            {"from": 5}, {"from": ""}, {"from": "me@example.org\n"},
            {"subject": None}, {"subject": "s" * 999}, {"subject": "Hi\nBcc: eve@example.org"}, {"subject": "\ud800"},
            {"body": None}, {"body": 5}, {"body": "b" * (64 * 1024 + 1)}, {"body": "\ud800"},
            {"reply_to_id": "7"}, {"reply_to_id": True}, {"reply_to_id": 1.5},
        ):
            with self.subTest(change=change):
                request = dict(DRAFT, **change)
                for name in [name for name, value in change.items() if value is None]:
                    del request[name]
                reply = self.ask_bird(request)
                self.assertIs(reply["ok"], False)
                self.assertNotEqual(reply["message"], "request too large")
        self.assert_nothing_sent(host)

    def test_the_caps_themselves_pass(self):
        host = self.start_bird()
        request = dict(DRAFT, to=["a" * 320] * 10, cc=["c@d"] * 10, subject="s" * 998, body="b" * (64 * 1024))
        sent, result = self.answer(host, request, {"ok": True})
        self.assertEqual((sent["body"], result), (request["body"], {"ok": True}))

    def test_a_64_kib_body_fits_the_request_cap_even_as_json_escapes(self):
        host = self.start_bird()
        # Three UTF-8 bytes each, six bytes each as a JSON escape: about 128 KiB on the wire, under the 192 KiB cap.
        body = "€" * (64 * 1024 // 3)
        client_request = dict(DRAFT, body=body)
        self.assertGreater(len(json.dumps(client_request)), 128 * 1024)
        sent, result = self.answer(host, client_request, {"ok": True})
        self.assertEqual((sent["body"], result), (body, {"ok": True}))


class ActTest(WriteTestCase):
    def test_each_action_goes_to_the_add_on_with_only_its_fields_and_the_reply_is_cut_to_the_count(self):
        host = self.start_bird()
        for request, fields in (
            (dict(ACT, folder_name="x"), {"action": "archive", "ids": [4, 5]}),
            ({"verb": "act", "action": "trash", "ids": [4]}, {"action": "trash", "ids": [4]}),
            ({"verb": "act", "action": "move", "ids": list(range(50)), "folder": "f" * 1024}, {"action": "move", "ids": list(range(50)), "folder": "f" * 1024}),
        ):
            with self.subTest(action=request["action"]):
                sent, result = self.answer(host, request, {"ok": True, "count": len(fields["ids"]), "subjects": ["leak"]})
                self.assertEqual(sent, dict(fields, verb="act", request_id=sent["request_id"]))
                self.assertEqual(result, {"ok": True, "count": len(fields["ids"])})
        for refusal in ("denied", "timed out", "moved 1 of 2"):
            self.assertEqual(self.answer(host, ACT, {"ok": False, "message": refusal, "count": 1})[1], {"ok": False, "message": refusal})

    def test_an_act_of_the_wrong_shape_is_refused_and_never_reaches_the_add_on(self):
        host = self.start_bird()
        for request in (
            {"verb": "act", "ids": [1]}, {"verb": "act", "action": "delete", "ids": [1]}, {"verb": "act", "action": "send", "ids": [1]},
            {"verb": "act", "action": "archive"}, {"verb": "act", "action": "archive", "ids": []}, {"verb": "act", "action": "archive", "ids": list(range(51))},
            {"verb": "act", "action": "archive", "ids": [1, 1]}, {"verb": "act", "action": "archive", "ids": ["1"]}, {"verb": "act", "action": "archive", "ids": [True]},
            {"verb": "act", "action": "archive", "ids": 1}, {"verb": "act", "action": "archive", "ids": [1], "folder": "f1"},
            {"verb": "act", "action": "trash", "ids": [1], "folder": "f1"}, {"verb": "act", "action": "move", "ids": [1]},
            {"verb": "act", "action": "move", "ids": [1], "folder": ""}, {"verb": "act", "action": "move", "ids": [1], "folder": "f" * 1025},
            {"verb": "act", "action": "move", "ids": [1], "folder": 3},
        ):
            with self.subTest(request=request):
                reply = self.ask_bird(request)
                self.assertIs(reply["ok"], False)
                self.assertNotEqual(reply["message"], "busy")
        self.assert_nothing_sent(host)

    def test_a_second_act_while_one_waits_is_busy_and_never_reaches_the_add_on_and_the_slot_frees_after_the_reply(self):
        host = self.start_bird()
        first = Client(self.bird_socket, ACT)
        asked = host.read_request(what="the first act")
        self.assertEqual(self.ask_bird(dict(ACT, action="trash")), {"ok": False, "message": "busy"})
        self.assert_nothing_sent(host)
        host.send({"verb": "reply", "request_id": asked["request_id"], "ok": True, "count": 2})
        self.assertEqual(first.result(), {"ok": True, "count": 2})
        self.assertEqual(self.answer(host, ACT, {"ok": False, "message": "denied"})[1], {"ok": False, "message": "denied"})

    def test_the_other_verbs_keep_working_while_an_act_waits(self):
        host = self.start_bird()
        waiting = Client(self.bird_socket, ACT)
        asked = host.read_request(what="the act")
        self.assertEqual(self.ask_bird({"verb": "ping"}), {"ok": True})
        for request, reply in (
            ({"verb": "run", "command": "msg.next"}, {"ok": True}),
            ({"verb": "list"}, {"ok": True, "commands": []}),
            ({"verb": "folders"}, {"ok": True, "folders": []}),
            (DRAFT, {"ok": True}),
        ):
            with self.subTest(verb=request["verb"]):
                self.assertEqual(self.answer(host, request, reply)[1], reply)
        host.send({"verb": "reply", "request_id": asked["request_id"], "ok": True, "count": 2})
        self.assertEqual(waiting.result(), {"ok": True, "count": 2})

    def test_a_client_that_leaves_frees_the_slot_for_the_next_act(self):
        host = self.start_bird()
        leaver = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        leaver.connect(self.bird_socket)
        leaver.sendall(json.dumps(ACT).encode() + b"\n")
        gone = host.read_request(what="the act that is left")
        leaver.close()
        deadline = time.monotonic() + liveness_s()
        while True:
            # A pause between tries keeps the busy answers under the rate limit.
            time.sleep(0.6)
            probe = Client(self.bird_socket, ACT)
            try:
                asked = host.read_request(timeout=0.5, what="an act after the client left")
            except AssertionError:
                self.assertEqual(probe.result(), {"ok": False, "message": "busy"})
                self.assertLess(time.monotonic(), deadline, "the slot never freed")
                continue
            self.assertNotEqual(asked["request_id"], gone["request_id"])
            host.send({"verb": "reply", "request_id": asked["request_id"], "ok": True, "count": 2})
            self.assertEqual(probe.result(), {"ok": True, "count": 2})
            return

    def test_the_firefox_socket_refuses_draft_and_act(self):
        host = self.start(argv=FIREFOX_ARGV)
        for request in (DRAFT, ACT, dict(ACT, action="move", folder="f1")):
            self.assertEqual(self.ask(request), {"ok": False, "message": "mail writes need --app thunderbird"})
        self.assert_nothing_sent(host)

    def test_writes_share_the_host_rate_limit(self):
        host = self.start_bird()
        for _ in range(5):
            self.answer(host, DRAFT, {"ok": True})
            self.answer(host, ACT, {"ok": True, "count": 2})
        self.assertEqual(self.ask_bird(DRAFT), RATE_LIMITED)
        self.assertEqual(self.ask_bird(ACT), RATE_LIMITED)
        self.assertEqual(self.ask_bird({"verb": "folders"}), RATE_LIMITED)
        self.assert_nothing_sent(host)


class FrameSink(io.RawIOBase):
    """The link's stdout in process: keeps each frame the host sends to the extension."""

    def __init__(self):
        self.data = b""
        self.arrived = threading.Condition()

    def writable(self):
        return True

    def write(self, data):
        with self.arrived:
            self.data += bytes(data)
            self.arrived.notify_all()
        return len(data)

    def frames(self):
        frames, data = [], self.data
        while len(data) >= 4:
            (length,) = struct.unpack("=I", data[:4])
            frames.append(json.loads(data[4:4 + length]))
            data = data[4 + length:]
        return frames

    def wait_for(self, count):
        """The first `count` frames after ready, once that many have arrived."""
        with self.arrived:
            if not self.arrived.wait_for(lambda: len(self.frames()) > count, liveness_s()):
                raise AssertionError("the host sent %d frames, not %d" % (len(self.frames()) - 1, count))
        return self.frames()[1:count + 1]


class ActLifecycleTest(unittest.TestCase):
    """The act slot and its wait, with short clocks, in process."""

    def setUp(self):
        self.module = load_host("desertfox-bridge")
        self.sink = FrameSink()
        self.link = self.module.ExtensionLink(self.sink, serves_tabs=False)
        self.link.say_ready()
        self.state = self.module.BridgeState("/nonexistent/state.json", os.getpid(), "1", "thunderbird")
        self.limiter = self.module.RateLimiter(100, 1.0)

    def act(self, results, client_left=None):
        thread = threading.Thread(target=lambda: results.append(self.module.answer(dict(ACT), self.state, self.link, self.limiter, client_left)), daemon=True)
        thread.start()
        return thread

    def test_the_timeout_frees_the_slot_and_a_late_reply_is_dropped(self):
        self.module.ACT_TIMEOUT_S = 0.3
        results = []
        self.act(results).join(liveness_s())
        self.assertEqual(results, [{"ok": False, "message": "the extension did not answer in time"}])
        self.assertFalse(self.link.act_slot.locked())
        self.assertEqual(self.link.pending, {})
        late = self.sink.wait_for(1)[0]
        self.link.answered({"verb": "reply", "request_id": late["request_id"], "ok": True, "count": 2})
        self.module.ACT_TIMEOUT_S = 5
        thread = self.act(results)
        again = self.sink.wait_for(2)[1]
        self.assertEqual((again["verb"], again["action"]), ("act", "archive"))
        self.link.answered({"verb": "reply", "request_id": again["request_id"], "ok": True, "count": 2})
        thread.join(liveness_s())
        self.assertEqual(results[1], {"ok": True, "count": 2})

    def test_a_closed_port_fails_the_waiting_act_and_frees_the_slot(self):
        results = []
        thread = self.act(results)
        self.sink.wait_for(1)
        self.link.close()
        thread.join(liveness_s())
        self.assertEqual(results, [{"ok": False, "message": "the extension disconnected"}])
        self.assertFalse(self.link.act_slot.locked())

    def test_a_client_that_left_ends_the_wait_within_a_peer_check(self):
        self.module.PEER_CHECK_S = 0.05
        left = threading.Event()
        results = []
        thread = self.act(results, left.is_set)
        self.sink.wait_for(1)
        left.set()
        thread.join(liveness_s())
        self.assertEqual(results, [{"ok": False, "message": "the client left"}])
        self.assertFalse(self.link.act_slot.locked())
        self.assertEqual(self.link.pending, {})

    def test_an_act_keeps_its_reply_while_the_other_requests_fill_the_pending_cap(self):
        results = []
        thread = self.act(results)
        act = self.sink.wait_for(1)[0]
        others = []
        for _ in range(self.module.MAX_PENDING - 1):
            others.append(threading.Thread(target=lambda: self.link.ask("list", {}, liveness_s()), daemon=True))
            others[-1].start()
        self.sink.wait_for(self.module.MAX_PENDING)
        self.assertEqual(self.link.ask("list", {}, 1), {"ok": False, "message": "too many requests are waiting"})
        self.link.answered({"verb": "reply", "request_id": act["request_id"], "ok": True, "count": 2})
        thread.join(liveness_s())
        self.assertEqual(results, [{"ok": True, "count": 2}])
        self.link.close()


class ActConnectionTest(unittest.TestCase):
    """An act over a real socket in process, so the idle timeout can be short."""

    def setUp(self):
        self.module = load_host("desertfox-bridge")
        self.module.IDLE_TIMEOUT_S = 0.2
        self.module.PEER_CHECK_S = 0.05
        temp = self.make_temp_dir()
        self.socket_path = os.path.join(temp, "bridge.sock")
        self.listener = self.module.bind_socket(self.socket_path)
        self.addCleanup(self.listener.close)
        self.sink = FrameSink()
        self.link = self.module.ExtensionLink(self.sink, serves_tabs=False)
        self.link.say_ready()
        state = self.module.BridgeState(os.path.join(temp, "state.json"), os.getpid(), "1", "thunderbird")
        threading.Thread(target=self.module.accept_loop, args=(self.listener, state, self.link, self.module.EventHub()), daemon=True).start()

    def make_temp_dir(self):
        temp = tempfile.TemporaryDirectory(prefix="dfw")
        self.addCleanup(temp.cleanup)
        return temp.name

    def test_an_act_wait_longer_than_the_idle_timeout_keeps_the_connection_and_gets_its_answer(self):
        client = Client(self.socket_path, ACT)
        act = self.sink.wait_for(1)[0]
        time.sleep(10 * self.module.IDLE_TIMEOUT_S)
        self.link.answered({"verb": "reply", "request_id": act["request_id"], "ok": True, "count": 2})
        self.assertEqual(client.result(), {"ok": True, "count": 2})

    def test_a_client_that_closes_its_connection_frees_the_slot(self):
        leaver = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        leaver.connect(self.socket_path)
        leaver.sendall(json.dumps(ACT).encode() + b"\n")
        self.sink.wait_for(1)
        self.assertTrue(self.link.act_slot.locked())
        leaver.close()
        deadline = time.monotonic() + liveness_s()
        while self.link.act_slot.locked() and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertFalse(self.link.act_slot.locked())
        self.assertEqual(self.link.pending, {})

    def test_a_partial_request_near_the_raised_cap_still_meets_the_idle_timeout(self):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(liveness_s())
            client.connect(self.socket_path)
            client.sendall(b"x" * (190 * 1024))
            started = time.monotonic()
            self.assertEqual(client.recv(10), b"")
            self.assertLess(time.monotonic() - started, liveness_s())


if __name__ == "__main__":
    unittest.main()
