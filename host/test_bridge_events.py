"""Tests of the bridge host's event stream: `subscribe`, the events it carries, its caps and how a subscriber ends. Real processes for the protocol, the hub in process for the races."""
import base64
import hashlib
import json
import os
import socket
import tempfile
import threading
import time
import unittest

from host_under_test import load_host
from test_bridge import LIVENESS_S, MODE, PRIVATE_MODE, BridgeTestCase, Client

ACTIVATED = {"verb": "event", "event": "tab_activated", "tab_id": 10, "window_id": 1}
UPDATED = {"verb": "event", "event": "tab_updated", "tab_id": 10, "window_id": 1, "title": "Mail", "url": "https://mail.example/"}
AUDIBLE = {"verb": "event", "event": "tab_audible", "tab_id": 11, "window_id": 1, "audible": True, "title": "Music", "url": "https://music.example/"}
REMOVED = {"verb": "event", "event": "tab_removed", "tab_id": 11}
TABS_OFF = {"verb": "event", "event": "tabs_off"}


def without_verb(message):
    return {name: value for name, value in message.items() if name != "verb"}


class Stream:
    """A subscriber connection that reads its lines on its own thread, so a test can wait for a count of them."""

    def __init__(self, socket_path, reading=True):
        self.connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.connection.settimeout(15)
        self.connection.connect(socket_path)
        self.connection.sendall(b'{"verb":"subscribe"}\n')
        self.lines = []
        self.ended = threading.Event()
        if reading:
            threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        data = b""
        try:
            while True:
                chunk = self.connection.recv(65536)
                if not chunk:
                    break
                data += chunk
                *complete, data = data.split(b"\n")
                self.lines.extend(json.loads(line) for line in complete)
        except OSError:
            pass
        self.ended.set()

    def wait_lines(self, count, timeout=LIVENESS_S):
        deadline = time.monotonic() + timeout
        while len(self.lines) < count and time.monotonic() < deadline:
            time.sleep(0.01)
        if len(self.lines) < count:
            raise AssertionError("got %d lines, wanted %d: %r" % (len(self.lines), count, self.lines))
        return self.lines

    def close(self):
        # A close alone leaves the socket open while the reader thread sits in recv.
        try:
            self.connection.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.connection.close()


class SubscribeTest(BridgeTestCase):
    def stream(self, reading=True):
        stream = Stream(self.socket_path, reading)
        self.addCleanup(stream.close)
        return stream

    def test_the_ack_then_the_current_mode_then_each_event_in_order_with_a_rising_seq(self):
        host = self.start()
        host.send(MODE)
        self.wait_for(lambda s: True)
        stream = self.stream()
        stream.wait_lines(2)
        for message in (ACTIVATED, UPDATED, AUDIBLE, REMOVED, dict(MODE, id="normal", label="NORMAL")):
            host.send(message)
        lines = stream.wait_lines(7)
        self.assertEqual(lines[0], {"ok": True})
        self.assertEqual(lines[1], {"event": "mode", "id": "insert", "label": "INSERT", "tab_id": 17, "window_id": 3, "private": False, "seq": 1})
        self.assertEqual([{k: v for k, v in line.items() if k != "seq"} for line in lines[2:]], [without_verb(ACTIVATED), without_verb(UPDATED), without_verb(AUDIBLE), without_verb(REMOVED), {"event": "mode", "id": "normal", "label": "NORMAL", "tab_id": 17, "window_id": 3, "private": False}])
        self.assertEqual([line["seq"] for line in lines[1:]], list(range(1, 7)))

    def test_a_subscriber_before_any_mode_gets_the_ack_and_then_the_first_mode(self):
        host = self.start()
        stream = self.stream()
        self.assertEqual(stream.wait_lines(1), [{"ok": True}])
        host.send(MODE)
        self.assertEqual(stream.wait_lines(2)[1]["event"], "mode")

    def test_a_private_mode_event_carries_no_ids(self):
        host = self.start()
        stream = self.stream()
        stream.wait_lines(1)
        host.send(dict(PRIVATE_MODE, tab_id=9, window_id=4, title="secret"))
        self.assertEqual(stream.wait_lines(2)[1], {"event": "mode", "id": "normal", "label": "NORMAL", "private": True, "seq": 1})

    def test_unknown_private_or_malformed_events_are_dropped_and_extra_fields_cut(self):
        host = self.start()
        stream = self.stream()
        stream.wait_lines(1)
        for bad in (
            dict(UPDATED, event="tab_secret"),
            dict(UPDATED, private=True),
            dict(UPDATED, incognito=True),
            dict(UPDATED, tab_id="10"),
            dict(UPDATED, title=None),
            dict(AUDIBLE, audible=1),
            {"verb": "event"},
            {"verb": "event", "event": 5},
        ):
            host.send(bad)
        host.send(dict(UPDATED, cookies="x", title="T" * 600, url="https://x/" + "u" * 3000))
        lines = stream.wait_lines(2)
        time.sleep(0.2)
        self.assertEqual(len(stream.lines), 2)
        self.assertNotIn("cookies", lines[1])
        self.assertEqual((len(lines[1]["title"]), len(lines[1]["url"])), (512, 2048))
        self.assertIsNone(host.process.poll())

    def test_tabs_off_reaches_subscribers_and_deletes_both_caches(self):
        host = self.start()
        folders = [os.path.join(self.cache_home, "desertfox", name) for name in ("bridge-thumbs", "bridge-favicons")]
        for folder in folders:
            os.makedirs(folder)
            open(os.path.join(folder, "a.png"), "w").close()
        stream = self.stream()
        stream.wait_lines(1)
        host.send(TABS_OFF)
        self.assertEqual(stream.wait_lines(2)[1], {"event": "tabs_off", "seq": 1})
        for folder in folders:
            self.wait_path_gone(folder)

    def test_a_subscriber_is_not_cut_by_the_idle_timeout(self):
        host = self.start()
        stream = self.stream()
        stream.wait_lines(1)
        time.sleep(6)
        host.send(ACTIVATED)
        self.assertEqual(stream.wait_lines(2)[1]["event"], "tab_activated")
        self.assertFalse(stream.ended.is_set())

    def test_subscribers_over_the_cap_are_refused_and_a_closed_one_frees_its_place(self):
        self.start()
        streams = [self.stream() for _ in range(4)]
        for stream in streams:
            stream.wait_lines(1)
        extra = self.stream()
        self.assertEqual(extra.wait_lines(1), [{"ok": False, "message": "too many subscribers"}])
        self.assertTrue(extra.ended.wait(LIVENESS_S))
        self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        streams[0].close()
        deadline = time.monotonic() + LIVENESS_S
        while True:
            late = self.stream()
            if late.wait_lines(1)[0] == {"ok": True}:
                break
            self.assertLess(time.monotonic(), deadline, "the closed subscriber kept its place")
            time.sleep(0.1)

    def test_subscribe_counts_once_against_the_rate_limit_and_its_events_never(self):
        host = self.start()
        stream = self.stream()
        stream.wait_lines(1)
        for _ in range(30):
            host.send(ACTIVATED)
        replies = []
        for _ in range(10):
            client = Client(self.socket_path, {"verb": "list"})
            try:
                request = host.read_request(timeout=1)
            except AssertionError:
                replies.append(client.result())
                break
            host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "commands": []})
            replies.append(client.result())
        self.assertEqual(replies[:9], [{"ok": True, "commands": []}] * 9)
        self.assertEqual(replies[9], {"ok": False, "message": "rate limit: too many requests, slow down"})
        self.assertEqual(len(stream.wait_lines(31)), 31)

    def test_a_subscriber_that_stops_reading_is_dropped_while_the_rest_keeps_flowing(self):
        host = self.start()
        stuck = self.stream(reading=False)
        reader = self.stream()
        reader.wait_lines(1)
        title, url = "t" * 512, "https://x/" + "u" * 2030
        sent = 0
        for _ in range(40):
            for _ in range(30):
                host.send(dict(UPDATED, title=title, url=url))
                sent += 1
            reader.wait_lines(1 + sent)
            self.assertEqual(self.ask({"verb": "ping"}), {"ok": True})
        self.assertEqual([line["seq"] for line in reader.lines[1:]], list(range(1, sent + 1)))
        stuck.connection.settimeout(LIVENESS_S)
        received = b""
        while True:
            chunk = stuck.connection.recv(1 << 20)
            if not chunk:
                break
            received += chunk
        self.assertLess(received.count(b"\n"), sent + 1, "the stuck subscriber got every event, so it was never dropped")

    def test_host_exit_ends_every_subscriber(self):
        host = self.start()
        streams = [self.stream() for _ in range(2)]
        for stream in streams:
            stream.wait_lines(1)
        host.close_stdin()
        self.assertEqual(host.wait(), 0)
        for stream in streams:
            self.assertTrue(stream.ended.wait(LIVENESS_S))

    def test_a_subscriber_line_after_subscribe_is_ignored(self):
        host = self.start()
        stream = self.stream()
        stream.wait_lines(1)
        stream.connection.sendall(b'{"verb":"ping"}\n')
        host.send(ACTIVATED)
        self.assertEqual(stream.wait_lines(2)[1]["event"], "tab_activated")


class HubTest(unittest.TestCase):
    """The hub's queues and its writer threads against socket pairs, with short timeouts."""

    def setUp(self):
        self.module = load_host("desertfox-bridge")
        self.module.WRITE_TIMEOUT_S = 0.2
        self.module.PEER_CHECK_S = 0.05
        self.hub = self.module.EventHub()
        self.pairs = []
        self.threads = []
        self.addCleanup(lambda: [end.close() for pair in self.pairs for end in pair])
        # Runs first: the writers end before their sockets close under them.
        self.addCleanup(lambda: [thread.join(LIVENESS_S) for thread in self.threads])
        self.addCleanup(self.hub.close)

    def pair(self):
        pair = socket.socketpair(socket.AF_UNIX, socket.SOCK_STREAM)
        self.pairs.append(pair)
        return pair

    def streaming(self):
        """A subscriber with its writer running on a thread, and the client end of its socket."""
        server, client = self.pair()
        subscriber = self.hub.add(server)
        thread = threading.Thread(target=self.hub.stream, args=(subscriber,), daemon=True)
        thread.start()
        self.threads.append(thread)
        return subscriber, client, thread

    def test_a_full_queue_drops_that_subscriber_and_no_other(self):
        slow = self.hub.add(self.pair()[0])
        fast = self.hub.add(self.pair()[0])
        fast.next_batch()
        for count in range(self.module.SUBSCRIBER_QUEUE_EVENTS + 5):
            self.hub.publish({"event": "tab_activated", "tab_id": count, "window_id": 1})
            self.assertTrue(fast.next_batch())
        self.assertEqual(self.hub.subscribers, {fast})
        self.assertTrue(slow.ended)
        self.assertIsNone(slow.next_batch())

    def test_a_write_that_blocks_past_the_timeout_drops_the_subscriber(self):
        _, _, thread = self.streaming()
        for _ in range(40):
            self.hub.publish({"event": "x", "pad": "p" * 100_000})
        thread.join(LIVENESS_S)
        self.assertFalse(thread.is_alive())
        self.assertEqual(self.hub.subscribers, set())

    def test_a_blocked_writer_does_not_hold_up_publish_or_another_subscriber(self):
        self.module.WRITE_TIMEOUT_S = 30
        _, _, blocked = self.streaming()
        _, reader, _ = self.streaming()
        reader.settimeout(LIVENESS_S)
        reader.recv(100)
        started = time.monotonic()
        for _ in range(40):
            self.hub.publish({"event": "x", "pad": "p" * 100_000})
        self.assertLess(time.monotonic() - started, 1)
        self.assertTrue(blocked.is_alive())
        received = b""
        while received.count(b"\n") < 40:
            received += reader.recv(1 << 20)
        self.hub.close()
        blocked.join(LIVENESS_S)
        self.assertFalse(blocked.is_alive(), "closing the hub did not wake the blocked writer")

    def test_closing_the_hub_ends_an_idle_writer_and_refuses_new_subscribers(self):
        _, client, thread = self.streaming()
        self.hub.close()
        thread.join(LIVENESS_S)
        self.assertFalse(thread.is_alive())
        client.settimeout(LIVENESS_S)
        received = b""
        while chunk := client.recv(100):
            received += chunk
        # The close can come before the writer has sent the ack.
        self.assertIn(received, (b"", b'{"ok":true}\n'))
        self.assertIsNone(self.hub.add(self.pair()[0]))

    def test_a_client_that_closes_while_idle_is_removed(self):
        subscriber, client, thread = self.streaming()
        client.close()
        thread.join(LIVENESS_S)
        self.assertFalse(thread.is_alive())
        self.assertNotIn(subscriber, self.hub.subscribers)

    def test_publishing_while_subscribers_come_and_go_loses_no_event_of_a_live_one(self):
        _, steady, _ = self.streaming()
        stop = threading.Event()

        def churn():
            while not stop.is_set():
                _, client, thread = self.streaming()
                client.close()
                thread.join(LIVENESS_S)

        churner = threading.Thread(target=churn, daemon=True)
        churner.start()
        steady.settimeout(LIVENESS_S)
        received = b""
        for count in range(300):
            self.hub.publish({"event": "tab_activated", "tab_id": count, "window_id": 1})
            if count % 20 == 0:
                while received.count(b"\n") < count + 2:
                    received += steady.recv(1 << 16)
        stop.set()
        churner.join(LIVENESS_S)
        while received.count(b"\n") < 301:
            received += steady.recv(1 << 16)
        events = [json.loads(line) for line in received.splitlines()[1:]]
        self.assertEqual([event["tab_id"] for event in events], list(range(300)))

    def test_a_removal_goes_only_to_a_subscriber_told_of_that_tab(self):
        early = self.hub.add(self.pair()[0])
        self.hub.publish({"event": "tab_updated", "tab_id": 5, "window_id": 1, "title": "", "url": ""})
        late = self.hub.add(self.pair()[0])
        early.next_batch()
        late.next_batch()
        self.hub.publish({"event": "tab_removed", "tab_id": 5})
        self.assertEqual([line["event"] for line in early.next_batch()], ["tab_removed"])
        self.assertEqual(late.next_batch(), [])
        self.hub.publish({"event": "tab_removed", "tab_id": 5})
        self.assertEqual(early.next_batch(), [], "a second removal of the same tab is not passed on")

    def test_tabs_off_and_the_cap_make_a_subscriber_forget_tabs(self):
        self.module.MAX_NAMED_TABS = 2
        subscriber = self.hub.add(self.pair()[0])
        for tab_id in (1, 2, 3):
            self.hub.publish({"event": "tab_activated", "tab_id": tab_id, "window_id": 1})
        self.assertEqual(list(subscriber.named_tabs), [2, 3])
        self.hub.publish({"event": "tabs_off"})
        subscriber.next_batch()
        self.hub.publish({"event": "tab_removed", "tab_id": 3})
        self.assertEqual(subscriber.next_batch(), [])

    def test_the_current_mode_given_on_subscribe_names_its_tab(self):
        self.hub.publish({"event": "mode", "id": "normal", "label": "NORMAL", "private": False, "tab_id": 7, "window_id": 1})
        subscriber = self.hub.add(self.pair()[0])
        subscriber.next_batch()
        self.hub.publish({"event": "tab_removed", "tab_id": 7})
        self.assertEqual([line["event"] for line in subscriber.next_batch()], ["tab_removed"])


class CacheGateTest(unittest.TestCase):
    """An image the extension sends while sharing goes off must not bring a deleted cache back."""

    def setUp(self):
        self.module = load_host("desertfox-bridge")
        temp = tempfile.TemporaryDirectory(prefix="dfg")
        self.addCleanup(temp.cleanup)
        old_cache = os.environ.get("XDG_CACHE_HOME")
        os.environ["XDG_CACHE_HOME"] = temp.name
        self.addCleanup(lambda: os.environ.pop("XDG_CACHE_HOME") if old_cache is None else os.environ.__setitem__("XDG_CACHE_HOME", old_cache))

    def link_that_turns_sharing_off(self, reply):
        module = self.module

        class Link:
            def ask(self, verb, fields, timeout_s):
                module.forget_tab_caches()
                return reply

        return Link()

    def test_an_icon_answered_across_tabs_off_is_dropped(self):
        data_url = "data:image/png;base64," + base64.b64encode(b"icon").decode()
        key = hashlib.sha256(data_url.encode()).hexdigest()
        stored = {}
        self.module.fill_favicons(self.link_that_turns_sharing_off({"ok": True, "data_url": data_url}), [{"tab_id": 1, "fav_icon_key": key}], stored)
        self.assertEqual(stored, {})
        self.assertFalse(os.path.exists(self.module.favicon_dir()))

    def test_a_thumbnail_answered_across_tabs_off_is_dropped(self):
        jpeg = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8 image").decode()
        result = self.module.capture_one(self.link_that_turns_sharing_off({"ok": True, "url": "https://a.example/", "data_url": jpeg}), 1)
        self.assertEqual(result["ok"], False)
        self.assertFalse(os.path.exists(self.module.thumbnail_dir()))

    def test_a_write_in_the_same_generation_lands(self):
        generation = self.module.TAB_CACHES.generation
        path = os.path.join(self.module.favicon_dir(), "a.png")
        self.assertTrue(self.module.TAB_CACHES.write(path, b"x", generation))
        self.assertTrue(os.path.exists(path))


if __name__ == "__main__":
    unittest.main()
