import io
import json
import os
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

from host_under_test import HOST_PATH, load_host

host = load_host()


def frame(message):
    data = json.dumps(message).encode()
    return struct.pack("=I", len(data)) + data


def unframe(raw):
    length = struct.unpack("=I", raw[:4])[0]
    assert len(raw) == 4 + length, "reply carries bytes beyond its length"
    return json.loads(raw[4:])


def run_in_process(request_bytes):
    out = io.BytesIO()
    code = host.serve(host.Channel(io.BytesIO(request_bytes), out))
    return code, out.getvalue()


class ConfigDirCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = os.path.join(self.tmp.name, "desertfox")
        os.makedirs(self.config)
        patcher = mock.patch.dict(os.environ, {"DESERTFOX_CONFIG_DIR": self.config})
        patcher.start()
        self.addCleanup(patcher.stop)

    def put(self, relative, text):
        path = os.path.join(self.config, relative)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            file.write(text)
        return path


class FramingTest(ConfigDirCase):
    def test_reply_is_length_prefixed_native_endian_json(self):
        code, raw = run_in_process(frame({"cmd": "read_config"}))
        self.assertEqual(code, 0)
        self.assertEqual(struct.unpack("=I", raw[:4])[0], len(raw) - 4)
        self.assertTrue(unframe(raw)["ok"])

    def test_closed_stdin_gets_no_reply(self):
        code, raw = run_in_process(b"")
        self.assertEqual((code, raw), (1, b""))

    def test_truncated_request_is_an_error_reply(self):
        _, raw = run_in_process(struct.pack("=I", 50) + b"{}")
        reply = unframe(raw)
        self.assertFalse(reply["ok"])
        self.assertIn("ended before", reply["error"])

    def test_invalid_json_and_non_object_and_unknown_cmd_are_errors(self):
        for body, needle in ((b"nope", "not valid JSON"), (b"[1]", "JSON object"), (b'{"cmd":"rm"}', "unknown cmd")):
            _, raw = run_in_process(struct.pack("=I", len(body)) + body)
            reply = unframe(raw)
            self.assertFalse(reply["ok"], body)
            self.assertIn(needle, reply["error"])

    def test_oversized_request_is_refused_without_reading_it(self):
        _, raw = run_in_process(struct.pack("=I", host.MAX_REQUEST_BYTES + 1))
        self.assertIn("over the", unframe(raw)["error"])

    def test_script_runs_as_a_one_shot_process(self):
        self.put("settings.toml", "a = 1\n")
        env = dict(os.environ, DESERTFOX_CONFIG_DIR=self.config)
        done = subprocess.run([sys.executable, HOST_PATH], input=frame({"cmd": "read_config"}), capture_output=True, env=env, timeout=20)
        self.assertEqual(done.returncode, 0)
        self.assertEqual(unframe(done.stdout)["files"], {"settings.toml": "a = 1\n"})
        self.assertEqual(done.stderr, b"")


class ReadConfigTest(ConfigDirCase):
    def read(self):
        _, raw = run_in_process(frame({"cmd": "read_config"}))
        return unframe(raw)

    def test_returns_raw_text_by_relative_path(self):
        self.put("settings.toml", "x = 'é'\n")
        self.put("keymap.d/10-a.toml", "k = 1\n")
        self.put("snippets/a.js", "// a\n")
        self.put("themes/dark.toml", "t = 1\n")
        self.put("style.css", "body{}\n")
        reply = self.read()
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["config_dir"], self.config)
        self.assertEqual(
            reply["files"],
            {"settings.toml": "x = 'é'\n", "keymap.d/10-a.toml": "k = 1\n", "snippets/a.js": "// a\n", "themes/dark.toml": "t = 1\n", "style.css": "body{}\n"},
        )

    def test_matches_the_tool_reader_for_unknown_entries_and_hidden_files(self):
        self.put("README.md", "secret text")
        self.put(".hidden", "x")
        self.put("other/inner.txt", "x")
        self.put("snippets/.swp", "x")
        os.makedirs(os.path.join(self.config, "themes", "sub"))
        self.assertEqual(self.read()["files"], {"README.md": "", "other/": "", "themes/sub/": ""})

    def test_autoconfig_is_not_part_of_the_file_set(self):
        self.put("autoconfig.toml", "saved = 1\n")
        self.put("settings.toml", "a = 1\n")
        self.assertEqual(list(self.read()["files"]), ["settings.toml"])

    def test_missing_folder_is_an_empty_file_set(self):
        os.rmdir(self.config)
        reply = self.read()
        self.assertTrue(reply["ok"])
        self.assertEqual((reply["config_dir_exists"], reply["files"]), (False, {}))

    def test_invalid_utf8_is_replaced_not_fatal(self):
        with open(os.path.join(self.config, "style.css"), "wb") as file:
            file.write(b"a\xffb")
        self.assertEqual(self.read()["files"]["style.css"], "a�b")

    def test_a_fifo_is_skipped_without_blocking_and_reported_as_an_entry_naming_it(self):
        os.mkfifo(os.path.join(self.config, "style.css"))
        os.makedirs(os.path.join(self.config, "snippets"))
        os.mkfifo(os.path.join(self.config, "snippets", "a.js"))
        self.put("settings.toml", "a = 1\n")
        reply = self.read()
        self.assertTrue(reply["ok"])
        self.assertEqual(reply["files"], {"settings.toml": "a = 1\n", "style.css/": "", "snippets/a.js/": ""})

    def test_a_file_over_one_mib_is_skipped_and_one_of_exactly_one_mib_is_read(self):
        exact = self.put("settings.toml", "a" * host.MAX_CONFIG_FILE_BYTES)
        over = self.put("style.css", "a" * (host.MAX_CONFIG_FILE_BYTES + 1))
        self.assertEqual(len(host.read_text(exact)), host.MAX_CONFIG_FILE_BYTES)
        self.assertIsNone(host.read_text(over))
        self.assertEqual(host.read_files(self.config), {"settings.toml": "a" * host.MAX_CONFIG_FILE_BYTES, "style.css/": ""})

    def test_a_link_follows_to_a_regular_file_but_a_link_to_a_big_file_is_skipped(self):
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        with open(os.path.join(outside, "small"), "w", encoding="utf-8") as file:
            file.write("a = 1\n")
        with open(os.path.join(outside, "big"), "wb") as file:
            file.write(b"x" * (host.MAX_CONFIG_FILE_BYTES + 1))
        os.symlink(os.path.join(outside, "small"), os.path.join(self.config, "settings.toml"))
        os.symlink(os.path.join(outside, "big"), os.path.join(self.config, "style.css"))
        self.assertEqual(self.read()["files"], {"settings.toml": "a = 1\n", "style.css/": ""})

    def test_unreadable_file_is_an_error_naming_it(self):
        path = self.put("settings.toml", "a = 1\n")
        os.chmod(path, 0)
        self.addCleanup(os.chmod, path, 0o644)
        if os.access(path, os.R_OK):
            self.skipTest("running as a user that ignores file modes")
        reply = self.read()
        self.assertFalse(reply["ok"])
        self.assertIn("settings.toml", reply["error"])

    def test_reply_above_the_cap_is_a_clear_error_and_below_it_passes(self):
        # Each file is under the per-file cap, so only the sum crosses the reply cap.
        half = host.MAX_REPLY_BYTES // 2 + 10
        self.put("snippets/a.js", "x" * half)
        self.put("snippets/b.js", "x" * half)
        reply = self.read()
        self.assertFalse(reply["ok"])
        self.assertIn("over Firefox's", reply["error"])
        self.assertIn(str(host.MAX_REPLY_BYTES), reply["error"])
        self.put("snippets/b.js", "x" * (host.MAX_REPLY_BYTES // 2 - 2000))
        self.assertTrue(self.read()["ok"])

    def test_reading_writes_nothing(self):
        self.put("settings.toml", "a = 1\n")
        before = sorted(os.listdir(self.config))
        self.read()
        self.assertEqual(sorted(os.listdir(self.config)), before)


class WriteAutoconfigTest(ConfigDirCase):
    def write(self, text):
        _, raw = run_in_process(frame({"cmd": "write_autoconfig", "toml": text}))
        return unframe(raw)

    def test_writes_header_and_text(self):
        reply = self.write('[settings]\nx = 1\n')
        self.assertTrue(reply["ok"])
        path = os.path.join(self.config, "autoconfig.toml")
        self.assertEqual(reply["path"], path)
        with open(path, encoding="utf-8") as file:
            self.assertEqual(file.read(), host.AUTOCONFIG_HEADER + "[settings]\nx = 1\n")

    def test_creates_a_missing_folder(self):
        os.rmdir(self.config)
        self.assertTrue(self.write("a = 1\n")["ok"])
        self.assertTrue(os.path.isfile(os.path.join(self.config, "autoconfig.toml")))

    def test_touches_no_other_file_and_leaves_no_temporary(self):
        mine = self.put("settings.toml", "mine = 1\n")
        self.write("a = 1\n")
        self.write("a = 2\n")
        self.assertEqual(sorted(os.listdir(self.config)), ["autoconfig.toml", "settings.toml"])
        with open(mine, encoding="utf-8") as file:
            self.assertEqual(file.read(), "mine = 1\n")

    def test_failed_write_keeps_the_old_file_whole(self):
        self.write("old = 1\n")
        path = os.path.join(self.config, "autoconfig.toml")
        with mock.patch.object(host.os, "replace", side_effect=OSError(28, "No space left on device")):
            reply = self.write("new = 2\n")
        self.assertFalse(reply["ok"])
        self.assertIn("No space left", reply["error"])
        with open(path, encoding="utf-8") as file:
            self.assertEqual(file.read(), host.AUTOCONFIG_HEADER + "old = 1\n")
        self.assertEqual(sorted(os.listdir(self.config)), ["autoconfig.toml"])

    def test_rejects_a_missing_or_non_string_toml(self):
        for request in ({"cmd": "write_autoconfig"}, {"cmd": "write_autoconfig", "toml": 3}):
            _, raw = run_in_process(frame(request))
            self.assertFalse(unframe(raw)["ok"])
        self.assertEqual(os.listdir(self.config), [])


if __name__ == "__main__":
    unittest.main()
