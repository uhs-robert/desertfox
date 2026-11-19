import hashlib
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

    def test_a_fifo_is_refused_without_blocking_with_an_error_naming_it(self):
        os.mkfifo(os.path.join(self.config, "style.css"))
        reply = self.read()
        self.assertFalse(reply["ok"])
        self.assertIn("style.css", reply["error"])
        self.assertIn("not a regular file", reply["error"])

    def test_a_fifo_in_a_known_folder_is_refused_too(self):
        os.makedirs(os.path.join(self.config, "snippets"))
        os.mkfifo(os.path.join(self.config, "snippets", "a.js"))
        reply = self.read()
        self.assertFalse(reply["ok"])
        self.assertIn("a.js", reply["error"])

    def test_a_file_over_one_mib_is_refused_and_one_of_exactly_one_mib_is_read(self):
        exact = self.put("settings.toml", "a" * host.MAX_CONFIG_FILE_BYTES)
        self.assertEqual(len(host.read_text(exact)), host.MAX_CONFIG_FILE_BYTES)
        self.put("style.css", "a" * (host.MAX_CONFIG_FILE_BYTES + 1))
        reply = self.read()
        self.assertFalse(reply["ok"])
        self.assertIn("style.css", reply["error"])
        self.assertIn("larger than 1 MiB", reply["error"])

    def test_a_link_follows_to_a_regular_file_but_a_link_to_a_big_file_is_refused(self):
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        with open(os.path.join(outside, "small"), "w", encoding="utf-8") as file:
            file.write("a = 1\n")
        with open(os.path.join(outside, "big"), "wb") as file:
            file.write(b"x" * (host.MAX_CONFIG_FILE_BYTES + 1))
        os.symlink(os.path.join(outside, "small"), os.path.join(self.config, "settings.toml"))
        self.assertEqual(self.read()["files"], {"settings.toml": "a = 1\n"})
        os.symlink(os.path.join(outside, "big"), os.path.join(self.config, "style.css"))
        self.assertFalse(self.read()["ok"])

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


def sha(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class WriteSettingsTest(ConfigDirCase):
    def write(self, text, base, **extra):
        _, raw = run_in_process(frame({"cmd": "write_settings", "text": text, "base_sha256": base, **extra}))
        return unframe(raw)

    def entries(self):
        """The folder without the lock file, which stays between writes and which read_config skips."""
        return sorted(name for name in os.listdir(self.config) if name != host.CONFIG_WRITE_LOCK_NAME)

    def read_settings(self, path=None):
        with open(path or os.path.join(self.config, "settings.toml"), "rb") as file:
            return file.read()

    def test_replaces_the_file_the_extension_read_and_answers_the_new_digest(self):
        old = "# mine\r\ntheme = \"a\" # keep\r\n"
        self.put("settings.toml", old)
        new = old.replace('"a"', '"b"')
        reply = self.write(new, sha(old))
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(reply["sha256"], sha(new))
        self.assertEqual(self.read_settings(), new.encode("utf-8"))
        self.assertEqual(self.entries(), ["settings.toml"])

    def test_refuses_a_hand_edit_since_the_read_and_leaves_it(self):
        self.put("settings.toml", "theme = \"hand\"\n")
        reply = self.write("theme = \"b\"\n", sha("theme = \"a\"\n"))
        self.assertFalse(reply["ok"])
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read_settings(), b"theme = \"hand\"\n")
        self.assertEqual(self.entries(), ["settings.toml"])

    def test_a_null_base_creates_the_file_and_refuses_when_one_appeared(self):
        self.assertTrue(self.write("theme = \"b\"\n", None)["ok"])
        self.assertEqual(self.read_settings(), b"theme = \"b\"\n")
        reply = self.write("theme = \"c\"\n", None)
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read_settings(), b"theme = \"b\"\n")

    def test_an_edit_that_lands_while_the_new_text_is_written_is_kept(self):
        path = self.put("settings.toml", "a = 1\n")
        real_chmod = os.chmod

        def edit_then_chmod(target, mode):
            real_chmod(target, mode)
            if os.path.basename(target).startswith(".settings-"):
                with open(path, "w", encoding="utf-8") as file:
                    file.write("a = 2\n")

        with mock.patch.object(host.os, "chmod", side_effect=edit_then_chmod):
            reply = self.write("a = 3\n", sha("a = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read_settings(), b"a = 2\n")
        self.assertEqual(self.entries(), ["settings.toml"])

    def test_a_failed_write_leaves_the_file_whole_and_no_temporary(self):
        self.put("settings.toml", "a = 1\n")
        with mock.patch.object(host.os, "replace", side_effect=OSError(28, "No space left on device")):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertFalse(reply["ok"])
        self.assertIn("No space left", reply["error"])
        self.assertEqual(self.read_settings(), b"a = 1\n")
        self.assertEqual(self.entries(), ["settings.toml"])

    def test_a_link_stays_a_link_and_its_target_keeps_its_mode(self):
        dotfiles = os.path.join(self.tmp.name, "dotfiles")
        os.makedirs(dotfiles)
        target = os.path.join(dotfiles, "settings.toml")
        with open(target, "w", encoding="utf-8") as file:
            file.write("a = 1\n")
        os.chmod(target, 0o600)
        link = os.path.join(self.config, "settings.toml")
        os.symlink(target, link)
        self.assertTrue(self.write("a = 2\n", sha("a = 1\n"))["ok"])
        self.assertTrue(os.path.islink(link))
        self.assertEqual(self.read_settings(target), b"a = 2\n")
        self.assertEqual(os.stat(target).st_mode & 0o777, 0o600)
        self.assertEqual(sorted(os.listdir(dotfiles)), ["settings.toml"])

    def test_the_digest_is_of_the_text_read_config_sends(self):
        text = "theme = \"caf\u00e9\"\n"
        self.put("settings.toml", text)
        _, raw = run_in_process(frame({"cmd": "read_config"}))
        self.assertEqual(sha(unframe(raw)["files"]["settings.toml"]), sha(text))
        self.assertTrue(self.write("theme = \"b\"\n", sha(text))["ok"])

    def test_a_missing_folder_is_refused_and_not_created(self):
        os.rmdir(self.config)
        reply = self.write("a = 1\n", None)
        self.assertFalse(reply["ok"])
        self.assertIn("does not exist", reply["error"])
        self.assertFalse(os.path.exists(self.config))

    def test_rejects_bad_fields(self):
        self.put("settings.toml", "a = 1\n")
        for request in (
            {"cmd": "write_settings", "base_sha256": None},
            {"cmd": "write_settings", "text": 3, "base_sha256": None},
            {"cmd": "write_settings", "text": "a = 2\n"},
            {"cmd": "write_settings", "text": "a = 2\n", "base_sha256": "abc"},
            {"cmd": "write_settings", "text": "a = 2\n", "base_sha256": sha("a = 1\n"), "path": "/etc/passwd"},
        ):
            _, raw = run_in_process(frame(request))
            self.assertFalse(unframe(raw)["ok"], request)
        self.assertEqual(self.read_settings(), b"a = 1\n")
        self.assertEqual(self.entries(), ["settings.toml"])

    def test_writes_no_other_file(self):
        self.put("keymap.toml", "x = 1\n")
        self.put("settings.toml", "a = 1\n")
        self.write("a = 2\n", sha("a = 1\n"))
        self.assertEqual(self.entries(), ["keymap.toml", "settings.toml"])


    def test_bytes_that_are_not_utf8_refuse_and_stay(self):
        path = os.path.join(self.config, "settings.toml")
        with open(path, "wb") as file:
            file.write(b"# caf\xe9\ntheme = \"a\"\n")
        _, raw = run_in_process(frame({"cmd": "read_config"}))
        lossy = unframe(raw)["files"]["settings.toml"]
        reply = self.write(lossy.replace('"a"', '"b"'), sha(lossy))
        self.assertFalse(reply["ok"])
        self.assertIn("not UTF-8", reply["error"])
        self.assertEqual(self.read_settings(), b"# caf\xe9\ntheme = \"a\"\n")

    def test_a_second_writer_waits_for_the_lock(self):
        import threading

        self.put("settings.toml", "a = 1\n")
        held = threading.Event()
        release = threading.Event()

        def hold():
            with host.config_write_lock(self.config):
                held.set()
                release.wait(5)

        holder = threading.Thread(target=hold)
        holder.start()
        held.wait(5)
        replies = []
        writer = threading.Thread(target=lambda: replies.append(self.write("a = 2\n", sha("a = 1\n"))))
        writer.start()
        writer.join(0.3)
        self.assertTrue(writer.is_alive(), "the write did not wait for the lock")
        self.assertEqual(self.read_settings(), b"a = 1\n")
        release.set()
        holder.join(5)
        writer.join(5)
        self.assertTrue(replies[0]["ok"], replies)
        self.assertEqual(self.read_settings(), b"a = 2\n")

    def test_an_edit_saved_into_the_file_just_before_the_rename_is_put_back(self):
        path = self.put("settings.toml", "a = 1\n")
        real_replace = os.replace
        calls = []

        def edit_then_replace(source, destination):
            if not calls and destination == path:
                # An editor that writes into the same file, after the host's last check.
                with open(path, "r+", encoding="utf-8") as file:
                    file.write("a = 9\n")
            calls.append(destination)
            return real_replace(source, destination)

        with mock.patch.object(host.os, "replace", side_effect=edit_then_replace):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read_settings(), b"a = 9\n")
        self.assertEqual(self.entries(), ["settings.toml"])

    def test_a_link_pointed_elsewhere_during_the_write_refuses(self):
        first = os.path.join(self.tmp.name, "first.toml")
        second = os.path.join(self.tmp.name, "second.toml")
        for target in (first, second):
            with open(target, "w", encoding="utf-8") as file:
                file.write("a = 1\n")
        link = os.path.join(self.config, "settings.toml")
        os.symlink(first, link)
        real_chmod = os.chmod

        def repoint_then_chmod(target, mode):
            real_chmod(target, mode)
            if os.path.basename(target).startswith(".settings-"):
                os.unlink(link)
                os.symlink(second, link)

        with mock.patch.object(host.os, "chmod", side_effect=repoint_then_chmod):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read_settings(first), b"a = 1\n")
        self.assertEqual(self.read_settings(second), b"a = 1\n")

    def test_a_file_created_during_a_first_write_stays(self):
        path = os.path.join(self.config, "settings.toml")
        real_chmod = os.chmod

        def create_then_chmod(target, mode):
            real_chmod(target, mode)
            if os.path.basename(target).startswith(".settings-") and not os.path.exists(path):
                with open(path, "w", encoding="utf-8") as file:
                    file.write("mine = 1\n")

        with mock.patch.object(host.os, "chmod", side_effect=create_then_chmod):
            reply = self.write("a = 2\n", None)
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read_settings(), b"mine = 1\n")
        self.assertEqual(self.entries(), ["settings.toml"])

    def edit_before_rename(self, path, data):
        """os.replace that first writes `data` into settings.toml, as an editor saving in place after the host's last check."""
        real_replace = os.replace
        calls = []

        def edit_then_replace(source, destination):
            if not calls and destination == path:
                with open(path, "r+b") as file:
                    file.write(data)
            calls.append(destination)
            return real_replace(source, destination)

        return mock.patch.object(host.os, "replace", side_effect=edit_then_replace)

    def test_a_racing_edit_that_cannot_be_compared_is_put_back(self):
        for data in (b"a = \xe9\n", b"#" * (host.MAX_CONFIG_FILE_BYTES + 1)):
            path = self.put("settings.toml", "a = 1\n")
            with self.edit_before_rename(path, data):
                reply = self.write("a = 2\n", sha("a = 1\n"))
            self.assertIn(host.CHANGED_ON_DISK, reply["error"])
            self.assertEqual(self.read_settings(), data)
            self.assertEqual(self.entries(), ["settings.toml"])

    def test_an_old_file_that_cannot_be_read_back_goes_back_and_refuses_as_unread_not_changed(self):
        self.put("settings.toml", "a = 1\n")
        real_open = os.open

        def failing_open(target, *args, **kwargs):
            if str(target).endswith(".old"):
                raise OSError(5, "Input/output error")
            return real_open(target, *args, **kwargs)

        with mock.patch.object(host.os, "open", side_effect=failing_open):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertFalse(reply["ok"])
        self.assertIn(host.NOT_READ_BACK, reply["error"])
        self.assertNotIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read_settings(), b"a = 1\n")
        self.assertEqual(self.entries(), ["settings.toml"])

    def test_an_old_file_whose_size_changed_is_an_edit_found_without_reading_it(self):
        path = self.put("settings.toml", "a = 1\n")
        real_open = os.open

        def no_read_back(target, *args, **kwargs):
            if str(target).endswith(".old"):
                raise AssertionError("the old file was read although its size already shows the edit")
            return real_open(target, *args, **kwargs)

        with self.edit_before_rename(path, b"#" * (2 * host.MAX_CONFIG_FILE_BYTES)), mock.patch.object(host.os, "open", side_effect=no_read_back):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(len(self.read_settings()), 2 * host.MAX_CONFIG_FILE_BYTES)
        self.assertEqual(self.entries(), ["settings.toml"])

    def test_a_racing_edit_that_cannot_be_put_back_stays_aside(self):
        path = self.put("settings.toml", "a = 1\n")
        real_replace = os.replace
        calls = []

        def edit_then_replace_once(source, destination):
            calls.append(destination)
            if len(calls) == 1:
                with open(path, "r+b") as file:
                    file.write(b"a = 9\n")
                return real_replace(source, destination)
            raise OSError(5, "Input/output error")

        with mock.patch.object(host.os, "replace", side_effect=edit_then_replace_once):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertFalse(reply["ok"])
        self.assertNotIn(host.CHANGED_ON_DISK, reply["error"])
        [aside] = [name for name in self.entries() if name.endswith(".old")]
        self.assertIn(aside, reply["error"])
        self.assertEqual(self.read_settings(os.path.join(self.config, aside)), b"a = 9\n")

    def test_a_save_renamed_over_the_new_text_is_not_overwritten_by_the_put_back(self):
        path = self.put("settings.toml", "a = 1\n")
        real_replace = os.replace
        calls = []

        def edit_replace_then_rename_save(source, destination):
            calls.append(destination)
            if len(calls) > 1:
                return real_replace(source, destination)
            # One editor writes into the old file, the host renames, and a second editor renames its save over the result.
            with open(path, "r+b") as file:
                file.write(b"a = 9\n")
            real_replace(source, destination)
            newer = os.path.join(self.config, "newer.toml")
            with open(newer, "wb") as file:
                file.write(b"a = 7\n")
            real_replace(newer, path)

        with mock.patch.object(host.os, "replace", side_effect=edit_replace_then_rename_save):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertFalse(reply["ok"])
        self.assertEqual(self.read_settings(), b"a = 7\n")
        [aside] = [name for name in self.entries() if name.endswith(".old")]
        self.assertIn(aside, reply["error"])
        self.assertEqual(self.read_settings(os.path.join(self.config, aside)), b"a = 9\n")

    def edit_replace_then(self, path, after):
        """os.replace whose first call writes an edit into the old file, renames, then runs `after`."""
        real_replace = os.replace
        calls = []

        def replace(source, destination):
            calls.append(destination)
            if len(calls) > 1:
                return real_replace(source, destination)
            with open(path, "r+b") as file:
                file.write(b"a = 9\n")
            real_replace(source, destination)
            after()

        return mock.patch.object(host.os, "replace", side_effect=replace)

    def test_an_edit_whose_file_is_removed_after_the_rename_is_put_back(self):
        path = self.put("settings.toml", "a = 1\n")
        with self.edit_replace_then(path, lambda: os.unlink(path)):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read_settings(), b"a = 9\n")
        self.assertEqual(self.entries(), ["settings.toml"])

    def test_an_edit_whose_file_cannot_be_checked_stays_aside_and_named(self):
        path = self.put("settings.toml", "a = 1\n")
        real_stat = os.stat
        failing = []

        def stat(target, *args, **kwargs):
            if failing and target == path:
                raise OSError(5, "Input/output error")
            return real_stat(target, *args, **kwargs)

        with mock.patch.object(host.os, "stat", side_effect=stat), self.edit_replace_then(path, lambda: failing.append(True)):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertFalse(reply["ok"])
        [aside] = [name for name in self.entries() if name.endswith(".old")]
        self.assertIn(aside, reply["error"])
        self.assertEqual(self.read_settings(os.path.join(self.config, aside)), b"a = 9\n")

    def test_a_folder_that_takes_no_lock_is_refused_with_a_reply(self):
        self.put("settings.toml", "a = 1\n")
        with mock.patch.object(host.fcntl, "flock", side_effect=OSError(37, "No locks available")):
            reply = self.write("a = 2\n", sha("a = 1\n"))
        self.assertFalse(reply["ok"])
        self.assertIn("cannot lock", reply["error"])
        self.assertEqual(self.read_settings(), b"a = 1\n")

    def test_a_filesystem_without_hard_links_refuses_and_writes_nothing(self):
        self.put("settings.toml", "a = 1\n")
        with mock.patch.object(host.os, "link", side_effect=OSError(1, "Operation not permitted")):
            reply = self.write("a = 2\n", sha("a = 1\n"))
            self.assertIn("no hard links", reply["error"])
            self.assertEqual(self.read_settings(), b"a = 1\n")
            self.assertEqual(self.entries(), ["settings.toml"])
            os.unlink(os.path.join(self.config, "settings.toml"))
            reply = self.write("a = 2\n", None)
            self.assertIn("no hard links", reply["error"])
            self.assertEqual(self.entries(), [])


class WriteConfigFileTest(ConfigDirCase):
    def write(self, kind, name, text, base, **extra):
        request = {"cmd": "write_config_file", "kind": kind, "text": text, "base_sha256": base, **extra}
        if name is not None:
            request["name"] = name
        _, raw = run_in_process(frame(request))
        return unframe(raw)

    def tree(self):
        """Every path under the config folder but the lock file, folders with a trailing slash."""
        found = []
        for root, folders, files in os.walk(self.config):
            relative = os.path.relpath(root, self.config)
            found += [os.path.normpath(os.path.join(relative, name)) + "/" for name in folders]
            found += [os.path.normpath(os.path.join(relative, name)) for name in files if name != host.CONFIG_WRITE_LOCK_NAME]
        return sorted(found)

    def read(self, relative):
        with open(os.path.join(self.config, relative), "rb") as file:
            return file.read()

    def test_a_new_theme_creates_the_themes_folder_and_read_config_sends_it_back(self):
        reply = self.write("theme", "nord_dark", "[colors]\n", None)
        self.assertTrue(reply["ok"], reply)
        self.assertEqual(reply["sha256"], sha("[colors]\n"))
        self.assertEqual(reply["path"], os.path.join(self.config, "themes", "nord_dark.toml"))
        self.assertEqual(self.tree(), ["themes/", "themes/nord_dark.toml"])
        _, raw = run_in_process(frame({"cmd": "read_config"}))
        self.assertEqual(unframe(raw)["files"], {"themes/nord_dark.toml": "[colors]\n"})

    def test_the_settings_kind_writes_settings_toml(self):
        self.put("settings.toml", "a = 1\n")
        self.assertTrue(self.write("settings", None, "a = 2\n", sha("a = 1\n"))["ok"])
        self.assertEqual(self.read("settings.toml"), b"a = 2\n")

    def test_a_hand_edited_or_unknown_theme_file_is_never_overwritten(self):
        self.put("themes/mine.toml", "hand = 1\n")
        for base in (sha("read = 1\n"), None):
            reply = self.write("theme", "mine", "new = 1\n", base)
            self.assertIn(host.CHANGED_ON_DISK, reply["error"], base)
        self.assertEqual(self.read("themes/mine.toml"), b"hand = 1\n")
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])

    def test_a_theme_overwrite_with_the_read_base_replaces_it(self):
        self.put("themes/mine.toml", "old = 1\n")
        self.assertTrue(self.write("theme", "mine", "new = 1\n", sha("old = 1\n"))["ok"])
        self.assertEqual(self.read("themes/mine.toml"), b"new = 1\n")
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])

    def test_a_null_text_deletes_only_with_the_base_of_the_file_on_disk(self):
        self.put("themes/mine.toml", "old = 1\n")
        reply = self.write("theme", "mine", None, sha("other = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertIn("not deleted", reply["error"])
        self.assertEqual(self.read("themes/mine.toml"), b"old = 1\n")
        reply = self.write("theme", "mine", None, None)
        self.assertFalse(reply["ok"])
        self.assertIn("needs base_sha256", reply["error"])
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])
        reply = self.write("theme", "mine", None, sha("old = 1\n"))
        self.assertTrue(reply["ok"], reply)
        self.assertTrue(reply["deleted"])
        self.assertEqual(self.tree(), ["themes/"])
        # Gone since the read: the base no longer matches anything, so the delete refuses.
        self.assertIn(host.CHANGED_ON_DISK, self.write("theme", "mine", None, sha("old = 1\n"))["error"])

    def test_a_delete_of_a_link_removes_the_link_and_keeps_its_target(self):
        dotfiles = os.path.join(self.tmp.name, "dotfiles")
        os.makedirs(dotfiles)
        target = os.path.join(dotfiles, "mine.toml")
        with open(target, "w", encoding="utf-8") as file:
            file.write("old = 1\n")
        os.makedirs(os.path.join(self.config, "themes"))
        os.symlink(target, os.path.join(self.config, "themes", "mine.toml"))
        self.assertIn(host.CHANGED_ON_DISK, self.write("theme", "mine", None, sha("other = 1\n"))["error"])
        self.assertTrue(os.path.islink(os.path.join(self.config, "themes", "mine.toml")))
        self.assertTrue(self.write("theme", "mine", None, sha("old = 1\n"))["ok"])
        self.assertEqual(self.tree(), ["themes/"])
        self.assertEqual(sorted(os.listdir(dotfiles)), ["mine.toml"])

    def linked_theme(self, text):
        """themes/mine.toml as a link to a file of `text` in a dotfiles folder. Answers the link and the target."""
        dotfiles = os.path.join(self.tmp.name, "dotfiles")
        os.makedirs(dotfiles, exist_ok=True)
        target = os.path.join(dotfiles, "mine.toml")
        with open(target, "w", encoding="utf-8") as file:
            file.write(text)
        os.makedirs(os.path.join(self.config, "themes"), exist_ok=True)
        link = os.path.join(self.config, "themes", "mine.toml")
        os.symlink(target, link)
        return link, target

    def rename_after(self, before):
        """os.rename that first runs `before`, as a save that lands after the host's check."""
        real_rename = os.rename

        def rename(source, destination):
            before(source)
            return real_rename(source, destination)

        return mock.patch.object(host.os, "rename", side_effect=rename)

    def test_a_save_renamed_over_a_link_just_before_its_delete_stays(self):
        link, target = self.linked_theme("old = 1\n")

        def save_over_link(source):
            saved = os.path.join(self.config, "themes", "saved.tmp")
            with open(saved, "w", encoding="utf-8") as file:
                file.write("new = 9\n")
            os.replace(saved, source)

        with self.rename_after(save_over_link):
            reply = self.write("theme", "mine", None, sha("old = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertFalse(os.path.islink(link))
        self.assertEqual(self.read("themes/mine.toml"), b"new = 9\n")
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])
        with open(target, "rb") as file:
            self.assertEqual(file.read(), b"old = 1\n")

    def test_a_file_saved_at_the_name_right_after_the_delete_renamed_it_stays(self):
        path = self.put("themes/mine.toml", "old = 1\n")
        real_rename = os.rename

        def rename_then_save(source, destination):
            real_rename(source, destination)
            with open(path, "w", encoding="utf-8") as file:
                file.write("newer = 7\n")

        with mock.patch.object(host.os, "rename", side_effect=rename_then_save):
            reply = self.write("theme", "mine", None, sha("old = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read("themes/mine.toml"), b"newer = 7\n")
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])

    def test_a_link_whose_target_was_edited_just_before_its_delete_goes_back_as_a_link(self):
        link, target = self.linked_theme("old = 1\n")

        def edit_target(_source):
            with open(target, "w", encoding="utf-8") as file:
                file.write("new = 9\n")

        with self.rename_after(edit_target):
            reply = self.write("theme", "mine", None, sha("old = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertTrue(os.path.islink(link))
        self.assertEqual(os.readlink(link), target)
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])

    def test_an_edit_saved_into_the_file_just_before_the_delete_is_put_back(self):
        path = self.put("themes/mine.toml", "old = 1\n")
        real_rename = os.rename

        def edit_then_rename(source, destination):
            if source == path:
                with open(path, "r+b") as file:
                    file.write(b"new = 9\n")
            return real_rename(source, destination)

        with mock.patch.object(host.os, "rename", side_effect=edit_then_rename):
            reply = self.write("theme", "mine", None, sha("old = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read("themes/mine.toml"), b"new = 9\n")
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])

    def test_a_file_saved_at_the_name_during_a_delete_stays_and_the_old_one_stays_aside(self):
        path = self.put("themes/mine.toml", "old = 1\n")
        real_rename = os.rename

        def edit_rename_then_save(source, destination):
            with open(path, "r+b") as file:
                file.write(b"new = 9\n")
            real_rename(source, destination)
            with open(path, "wb") as file:
                file.write(b"newer = 7\n")

        with mock.patch.object(host.os, "rename", side_effect=edit_rename_then_save):
            reply = self.write("theme", "mine", None, sha("old = 1\n"))
        self.assertFalse(reply["ok"])
        self.assertEqual(self.read("themes/mine.toml"), b"newer = 7\n")
        [aside] = [name for name in os.listdir(os.path.join(self.config, "themes")) if name.endswith(".old")]
        self.assertIn(aside, reply["error"])
        self.assertEqual(self.read(os.path.join("themes", aside)), b"new = 9\n")

    def test_names_that_could_leave_the_themes_folder_are_refused_and_nothing_is_written(self):
        outside = os.path.join(self.tmp.name, "outside.toml")
        for name in ("../outside", "../../outside", "a/b", "a\\b", "a.b", ".hidden", "", "-a", "_a", "Nord", "a\x00b", "a\n", "caf\u00e9", "x" * 49, 3, None, ["a"]):
            request = {"cmd": "write_config_file", "kind": "theme", "name": name, "text": "a = 1\n", "base_sha256": None}
            _, raw = run_in_process(frame(request))
            reply = unframe(raw)
            self.assertFalse(reply["ok"], name)
            self.assertIn("needs a name", reply["error"], name)
        self.assertEqual(self.tree(), [])
        self.assertFalse(os.path.exists(outside))
        self.assertTrue(self.write("theme", "x" * 48, "a = 1\n", None)["ok"])

    def test_a_kind_outside_the_table_and_a_name_for_settings_are_refused(self):
        for kind in ("keymap", "themes", "../settings", "Settings", "", None, 1):
            reply = self.write(kind, "a", "a = 1\n", None)
            self.assertFalse(reply["ok"], kind)
            self.assertIn("has no kind", reply["error"], kind)
        reply = self.write("settings", "a", "a = 1\n", None)
        self.assertIn("takes no name", reply["error"])
        _, raw = run_in_process(frame({"cmd": "write_config_file", "text": "a = 1\n", "base_sha256": None}))
        self.assertIn("has no kind", unframe(raw)["error"])
        self.assertEqual(self.tree(), [])

    def test_rejects_bad_fields_and_a_path(self):
        for request in (
            {"cmd": "write_config_file", "kind": "theme", "name": "a", "base_sha256": None},
            {"cmd": "write_config_file", "kind": "theme", "name": "a", "text": 3, "base_sha256": None},
            {"cmd": "write_config_file", "kind": "theme", "name": "a", "text": "a = 1\n"},
            {"cmd": "write_config_file", "kind": "theme", "name": "a", "text": "a = 1\n", "base_sha256": "abc"},
            {"cmd": "write_config_file", "kind": "theme", "name": "a", "text": "a = 1\n", "base_sha256": None, "path": "/tmp/x"},
        ):
            _, raw = run_in_process(frame(request))
            self.assertFalse(unframe(raw)["ok"], request)
        self.assertEqual(self.tree(), [])

    def test_a_linked_theme_stays_a_link_and_its_target_keeps_its_mode(self):
        dotfiles = os.path.join(self.tmp.name, "dotfiles")
        os.makedirs(dotfiles)
        target = os.path.join(dotfiles, "mine.toml")
        with open(target, "w", encoding="utf-8") as file:
            file.write("a = 1\n")
        os.chmod(target, 0o600)
        os.makedirs(os.path.join(self.config, "themes"))
        link = os.path.join(self.config, "themes", "mine.toml")
        os.symlink(target, link)
        self.assertTrue(self.write("theme", "mine", "a = 2\n", sha("a = 1\n"))["ok"])
        self.assertTrue(os.path.islink(link))
        with open(target, "rb") as file:
            self.assertEqual(file.read(), b"a = 2\n")
        self.assertEqual(os.stat(target).st_mode & 0o777, 0o600)
        self.assertEqual(sorted(os.listdir(dotfiles)), ["mine.toml"])

    def test_a_linked_themes_folder_is_written_through(self):
        dotfiles = os.path.join(self.tmp.name, "dotfiles-themes")
        os.makedirs(dotfiles)
        os.symlink(dotfiles, os.path.join(self.config, "themes"))
        self.assertTrue(self.write("theme", "mine", "a = 1\n", None)["ok"])
        self.assertEqual(sorted(os.listdir(dotfiles)), ["mine.toml"])

    def test_a_themes_entry_that_is_no_folder_and_a_theme_that_is_no_file_are_refused(self):
        self.put("themes", "not a folder\n")
        reply = self.write("theme", "mine", "a = 1\n", None)
        self.assertIn("is not a folder", reply["error"])
        os.unlink(os.path.join(self.config, "themes"))
        os.makedirs(os.path.join(self.config, "themes", "mine.toml"))
        reply = self.write("theme", "mine", "a = 1\n", sha("a = 1\n"))
        self.assertIn("not a regular file", reply["error"])
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml/"])

    def test_a_theme_that_is_not_utf8_or_over_1_mib_is_refused(self):
        path = os.path.join(self.config, "themes", "mine.toml")
        os.makedirs(os.path.dirname(path))
        with open(path, "wb") as file:
            file.write(b"# caf\xe9\n")
        _, raw = run_in_process(frame({"cmd": "read_config"}))
        lossy = unframe(raw)["files"]["themes/mine.toml"]
        self.assertIn("not UTF-8", self.write("theme", "mine", "a = 1\n", sha(lossy))["error"])
        self.assertIn("not UTF-8", self.write("theme", "mine", None, sha(lossy))["error"])
        self.assertEqual(self.read("themes/mine.toml"), b"# caf\xe9\n")
        reply = self.write("theme", "big", "#" * (host.MAX_CONFIG_FILE_BYTES + 1), None)
        self.assertIn("larger than 1 MiB", reply["error"])
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])

    def test_a_missing_config_folder_is_refused_and_not_created(self):
        os.rmdir(self.config)
        reply = self.write("theme", "mine", "a = 1\n", None)
        self.assertIn("does not exist", reply["error"])
        self.assertFalse(os.path.exists(self.config))

    def test_a_theme_write_waits_for_the_lock_settings_writes_take(self):
        import threading

        held = threading.Event()
        release = threading.Event()

        def hold():
            with host.config_write_lock(self.config):
                held.set()
                release.wait(5)

        holder = threading.Thread(target=hold)
        holder.start()
        held.wait(5)
        real_flock = host.fcntl.flock
        attempted = threading.Event()

        def flock(descriptor, operation):
            if threading.current_thread() is not holder:
                attempted.set()
            return real_flock(descriptor, operation)

        replies = []
        with mock.patch.object(host.fcntl, "flock", side_effect=flock):
            writer = threading.Thread(target=lambda: replies.append(self.write("theme", "mine", "a = 1\n", None)))
            writer.start()
            self.assertTrue(attempted.wait(5), "the write never asked for the lock")
            writer.join(0.3)
            self.assertTrue(writer.is_alive(), "the write did not wait for the lock")
            self.assertEqual(self.tree(), [])
            release.set()
            holder.join(5)
            writer.join(5)
        self.assertTrue(replies[0]["ok"], replies)
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])

    def test_an_edit_saved_into_a_theme_just_before_the_rename_is_put_back(self):
        path = self.put("themes/mine.toml", "a = 1\n")
        real_replace = os.replace
        calls = []

        def edit_then_replace(source, destination):
            if not calls and destination == path:
                with open(path, "r+b") as file:
                    file.write(b"a = 9\n")
            calls.append(destination)
            return real_replace(source, destination)

        with mock.patch.object(host.os, "replace", side_effect=edit_then_replace):
            reply = self.write("theme", "mine", "a = 2\n", sha("a = 1\n"))
        self.assertIn(host.CHANGED_ON_DISK, reply["error"])
        self.assertEqual(self.read("themes/mine.toml"), b"a = 9\n")
        self.assertEqual(self.tree(), ["themes/", "themes/mine.toml"])


class ThunderbirdManifestTest(unittest.TestCase):
    def test_the_desertbird_host_manifest_names_the_thunderbird_id_and_this_script(self):
        script, _, extension_id = host.MANIFESTS["desertbird_host"]
        self.assertEqual(script, "desertfox-host")
        self.assertEqual(extension_id, "desertbird@uhs-robert")
        self.assertEqual(host.THUNDERBIRD_EXTENSION_ID, extension_id)
        scripts = {"desertfox-host": "/data/desertfox-host"}
        manifest = json.loads(host.manifest_bytes("desertbird_host", scripts))
        self.assertEqual(manifest["name"], "desertbird_host")
        self.assertEqual(manifest["path"], "/data/desertfox-host")
        self.assertEqual(manifest["allowed_extensions"], ["desertbird@uhs-robert"])

    def test_no_firefox_manifest_allows_the_thunderbird_id_and_no_thunderbird_one_allows_firefox(self):
        for name, (_, _, extension_id) in host.MANIFESTS.items():
            self.assertEqual(extension_id == host.THUNDERBIRD_EXTENSION_ID, name.startswith("desertbird_"), name)


if __name__ == "__main__":
    unittest.main()
