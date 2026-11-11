"""Tests of the bridge host's tab verbs: tabs, activate, clear_preface, close, capture and `run` with a tab id. Real processes with a fake extension on stdin and stdout."""
import base64
import hashlib
import json
import os
import time
import unittest

from host_under_test import load_host
from test_bridge import BridgeTestCase, Client

JPEG = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xe0 fake image").decode()
MAIL = {"tab_id": 10, "window_id": 1, "title": "Mail", "url": "https://mail.example/", "active": True, "audible": False, "discarded": False, "last_accessed": 5, "pinned": False, "hidden": False, "fav_icon_url": ""}
MUSIC = dict(MAIL, tab_id=11, title="Music", url="https://music.example/", audible=True)
OFF = {"ok": False, "message": "tab sharing is off, set bridge_share_tabs to true"}


def thumbnail_file(cache_home, url):
    return os.path.join(cache_home, "desertfox", "bridge-thumbs", hashlib.sha256(url.encode()).hexdigest() + ".jpg")


class TabsTest(BridgeTestCase):
    def serve_tabs(self, host, tabs):
        request = host.read_request()
        self.assertEqual(request, {"verb": "tabs", "request_id": request["request_id"]})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "tabs": tabs})

    def test_tabs_are_forwarded_and_the_reply_keeps_only_the_known_fields(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "tabs"})
        extra = dict(MAIL, secret="x", cookies=["a"])
        self.serve_tabs(host, [extra])
        reply = client.result()
        self.assertEqual(reply, {"ok": True, "tabs": [dict(MAIL, thumbnail="", thumbnail_at=0)]})

    def test_a_tab_flagged_private_or_with_wrong_types_is_dropped_by_the_host(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "tabs"})
        self.serve_tabs(host, [dict(MAIL, tab_id=20, incognito=True), dict(MAIL, tab_id=21, private=True), dict(MAIL, tab_id="22"), {"title": "no ids"}, "text", dict(MAIL, tab_id=23, title=5), MUSIC])
        reply = client.result()
        self.assertEqual([tab["tab_id"] for tab in reply["tabs"]], [23, 11])
        self.assertNotIn("title", reply["tabs"][0])

    def test_with_sharing_off_the_extension_refusal_comes_back_unchanged(self):
        host = self.start()
        for request in ({"verb": "tabs"}, {"verb": "activate", "tab_id": 10}, {"verb": "close", "tab_id": 10}, {"verb": "clear_preface", "window_id": 1}, {"verb": "run", "command": "tab.next", "tab_id": 10}, {"verb": "capture"}):
            client = Client(self.socket_path, request)
            asked = host.read_request()
            host.send({"verb": "reply", "request_id": asked["request_id"], **OFF})
            self.assertEqual(client.result(), OFF, request["verb"])

    def test_an_extension_error_on_the_tab_list_has_no_tabs(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "tabs"})
        host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": False, "message": "tabs failed", "tabs": [MAIL]})
        self.assertEqual(client.result(), {"ok": False, "message": "tabs failed"})


class ActivateAndCloseTest(BridgeTestCase):
    def test_activate_is_forwarded_with_its_preface_and_the_reply_is_cut(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "activate", "tab_id": 10, "preface": "abc123", "extra": "x"})
        request = host.read_request()
        self.assertEqual(request, {"verb": "activate", "request_id": request["request_id"], "tab_id": 10, "preface": "abc123"})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "window_id": 1, "focused": True, "preface_set": True, "title": "Mail", "url": "https://x"})
        self.assertEqual(client.result(), {"ok": True, "window_id": 1, "focused": True, "preface_set": True})

    def test_activate_without_a_preface_sends_none(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "activate", "tab_id": 10})
        request = host.read_request()
        self.assertEqual(request, {"verb": "activate", "request_id": request["request_id"], "tab_id": 10})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "window_id": 1, "focused": False, "preface_set": False})
        self.assertEqual(client.result()["focused"], False)

    def test_a_stale_or_private_id_gets_the_extension_refusal_and_nothing_else(self):
        host = self.start()
        for verb in ("activate", "close"):
            client = Client(self.socket_path, {"verb": verb, "tab_id": 999})
            host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": False, "message": "no such tab", "title": "Secret"})
            self.assertEqual(client.result(), {"ok": False, "message": "no such tab"})

    def test_bad_ids_and_prefaces_never_reach_the_extension(self):
        host = self.start()
        bad = [
            {"verb": "activate"}, {"verb": "activate", "tab_id": "1"}, {"verb": "activate", "tab_id": True}, {"verb": "activate", "tab_id": 1.5},
            {"verb": "close"}, {"verb": "close", "tab_id": None},
            {"verb": "activate", "tab_id": 1, "preface": ""}, {"verb": "activate", "tab_id": 1, "preface": "a b"}, {"verb": "activate", "tab_id": 1, "preface": "x" * 33}, {"verb": "activate", "tab_id": 1, "preface": 5},
            {"verb": "clear_preface"}, {"verb": "clear_preface", "window_id": "1"}, {"verb": "clear_preface", "window_id": 1, "preface": "a;b"},
            {"verb": "run", "command": "tab.next", "tab_id": "1"}, {"verb": "run", "command": "tab.next", "tab_id": True},
            {"verb": "capture", "tab_ids": "1"}, {"verb": "capture", "tab_ids": [1, "2"]}, {"verb": "capture", "tab_ids": list(range(65))},
        ]
        for request in bad:
            self.assertEqual(self.ask(request)["ok"], False, request)
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)

    def test_clear_preface_and_close_are_forwarded(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "clear_preface", "window_id": 1, "preface": "abc"})
        request = host.read_request()
        self.assertEqual(request, {"verb": "clear_preface", "request_id": request["request_id"], "window_id": 1, "preface": "abc"})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "cleared": False, "x": 1})
        self.assertEqual(client.result(), {"ok": True, "cleared": False})
        client = Client(self.socket_path, {"verb": "close", "tab_id": 12})
        request = host.read_request()
        self.assertEqual(request, {"verb": "close", "request_id": request["request_id"], "tab_id": 12})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "title": "gone"})
        self.assertEqual(client.result(), {"ok": True})

    def test_concurrent_activates_each_get_their_own_reply_when_the_answers_come_in_reverse(self):
        host = self.start()
        first = Client(self.socket_path, {"verb": "activate", "tab_id": 10, "preface": "aaa"})
        asked_first = host.read_request()
        second = Client(self.socket_path, {"verb": "activate", "tab_id": 11, "preface": "bbb"})
        asked_second = host.read_request()
        self.assertEqual((asked_first["tab_id"], asked_second["tab_id"]), (10, 11))
        host.send({"verb": "reply", "request_id": asked_second["request_id"], "ok": True, "window_id": 2, "focused": True, "preface_set": True})
        host.send({"verb": "reply", "request_id": asked_first["request_id"], "ok": True, "window_id": 1, "focused": False, "preface_set": True})
        self.assertEqual(first.result()["window_id"], 1)
        self.assertEqual(second.result()["window_id"], 2)

    def test_the_port_closing_while_tab_requests_wait_fails_them_all_at_once(self):
        host = self.start()
        clients = [Client(self.socket_path, request) for request in ({"verb": "activate", "tab_id": 10}, {"verb": "tabs"}, {"verb": "close", "tab_id": 11}, {"verb": "run", "command": "tab.next", "tab_id": 12})]
        for _ in clients:
            host.read_request()
        started = time.monotonic()
        host.close_stdin()
        for client in clients:
            self.assertEqual(client.result(), {"ok": False, "message": "the extension disconnected"})
        self.assertLess(time.monotonic() - started, 5)
        self.assertEqual(host.wait(), 0)

    def test_run_with_a_tab_id_forwards_it(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "run", "command": "tab.next", "tab_id": 42})
        request = host.read_request()
        self.assertEqual(request, {"verb": "run", "request_id": request["request_id"], "command": "tab.next", "tab_id": 42})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": False, "message": "no such tab", "url": "https://x"})
        self.assertEqual(client.result(), {"ok": False, "message": "no such tab"})


class CaptureTest(BridgeTestCase):
    def listed(self, host, tabs):
        request = host.read_request()
        self.assertEqual(request["verb"], "tabs")
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "tabs": tabs})

    def test_capture_asks_for_the_listed_tab_and_saves_the_image_by_address(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "capture", "tab_ids": [11]})
        self.listed(host, [MAIL, MUSIC])
        request = host.read_request()
        self.assertEqual(request, {"verb": "capture", "request_id": request["request_id"], "tab_id": 11})
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": True, "tab_id": 11, "url": MUSIC["url"], "data_url": JPEG})
        path = thumbnail_file(self.cache_home, MUSIC["url"])
        reply = client.result()
        self.assertEqual(reply["results"], [{"tab_id": 11, "ok": True, "thumbnail": path, "thumbnail_at": reply["results"][0]["thumbnail_at"]}])
        self.assertGreater(reply["results"][0]["thumbnail_at"], 0)
        with open(path, "rb") as image:
            self.assertTrue(image.read().startswith(b"\xff\xd8"))
        self.assertEqual(oct(os.stat(os.path.dirname(path)).st_mode & 0o777), "0o700")
        # The next tab list names the saved image.
        listing = Client(self.socket_path, {"verb": "tabs"})
        self.listed(host, [MUSIC])
        self.assertEqual(listing.result()["tabs"][0]["thumbnail"], path)

    def test_capture_without_ids_takes_every_loaded_tab_and_skips_unloaded_ones(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "capture"})
        self.listed(host, [MAIL, dict(MUSIC, discarded=True)])
        request = host.read_request()
        self.assertEqual(request["tab_id"], 10)
        host.send({"verb": "reply", "request_id": request["request_id"], "ok": False, "message": "the tab is not loaded"})
        self.assertEqual(client.result()["results"], [{"tab_id": 10, "ok": False, "thumbnail": "", "thumbnail_at": 0, "error": "the tab is not loaded"}])

    def test_an_id_the_extension_did_not_list_is_never_captured_and_no_image_is_written(self):
        host = self.start()
        # The private tab 20 is asked for by id. A buggy extension even lists it flagged, and the host still drops it.
        client = Client(self.socket_path, {"verb": "capture", "tab_ids": [20, 999]})
        self.listed(host, [MAIL, dict(MAIL, tab_id=20, url="https://secret.example/", incognito=True)])
        reply = client.result()
        self.assertEqual([(result["tab_id"], result["ok"], result["error"]) for result in reply["results"]], [(20, False, "no such tab"), (999, False, "no such tab")])
        with self.assertRaises(AssertionError):
            host.read_request(timeout=0.3)
        self.assertFalse(os.path.exists(os.path.join(self.cache_home, "desertfox")))

    def test_a_reply_that_is_not_a_jpeg_saves_nothing(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "capture", "tab_ids": [10]})
        self.listed(host, [MAIL])
        host.send({"verb": "reply", "request_id": host.read_request()["request_id"], "ok": True, "tab_id": 10, "url": MAIL["url"], "data_url": "data:text/html,x"})
        reply = client.result()
        self.assertEqual(reply["results"][0]["ok"], False)
        self.assertFalse(os.path.exists(thumbnail_file(self.cache_home, MAIL["url"])))

    def test_an_old_image_of_a_closed_tab_is_pruned_and_one_of_an_open_tab_stays(self):
        # The host prunes at start too, so it starts first and the old images appear after.
        host = self.start()
        old_path = thumbnail_file(self.cache_home, "https://closed.example/")
        kept_path = thumbnail_file(self.cache_home, MAIL["url"])
        os.makedirs(os.path.dirname(old_path))
        for path in (old_path, kept_path):
            with open(path, "wb") as image:
                image.write(b"\xff\xd8")
            os.utime(path, (1, 1))
        client = Client(self.socket_path, {"verb": "capture", "tab_ids": []})
        self.listed(host, [MAIL])
        self.assertEqual(client.result(), {"ok": True, "results": []})
        self.assertFalse(os.path.exists(old_path))
        self.assertTrue(os.path.exists(kept_path))

    def test_the_port_closing_between_captures_fails_the_waiting_client(self):
        host = self.start()
        client = Client(self.socket_path, {"verb": "capture", "tab_ids": [10, 11]})
        self.listed(host, [MAIL, MUSIC])
        host.read_request()
        host.close_stdin()
        results = client.result()["results"]
        self.assertEqual([result["ok"] for result in results], [False, False])
        self.assertEqual(host.wait(), 0)


class ThumbnailCleanupTest(BridgeTestCase):
    def seed(self, url, age_s):
        path = thumbnail_file(self.cache_home, url)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as image:
            image.write(b"\xff\xd8")
        stamp = time.time() - age_s
        os.utime(path, (stamp, stamp))
        return path

    def test_the_host_prunes_old_images_at_start_and_keeps_recent_ones(self):
        old = self.seed("https://old.example/", 8 * 24 * 3600)
        recent = self.seed("https://recent.example/", 3600)
        self.start()
        self.wait_path_gone(old)
        self.assertTrue(os.path.exists(recent))

    def test_only_the_newest_images_up_to_the_cap_stay(self):
        module = load_host("desertfox-bridge")
        module.MAX_THUMBNAILS = 3
        old_cache = os.environ.get("XDG_CACHE_HOME")
        os.environ["XDG_CACHE_HOME"] = self.cache_home
        self.addCleanup(lambda: os.environ.pop("XDG_CACHE_HOME") if old_cache is None else os.environ.__setitem__("XDG_CACHE_HOME", old_cache))
        paths = [self.seed("https://site%d.example/" % number, 1000 - number * 10) for number in range(6)]
        module.prune_thumbnails([])
        self.assertEqual([os.path.exists(path) for path in paths], [False, False, False, True, True, True])

    def test_an_answer_that_sharing_is_off_deletes_the_thumbnails_and_the_client_sees_no_extra_field(self):
        host = self.start()
        for request in ({"verb": "tabs"}, {"verb": "capture"}):
            kept = self.seed("https://kept.example/", 60)
            client = Client(self.socket_path, request)
            host.send({"verb": "reply", "request_id": host.read_request()["request_id"], **OFF, "sharing": "off"})
            self.assertEqual(client.result(), OFF)
            self.assertFalse(os.path.exists(kept))
            self.assertFalse(os.path.exists(os.path.dirname(kept)))


if __name__ == "__main__":
    unittest.main()
