import json
import os
import stat
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from unittest import mock

from host_under_test import load_host
from test_bridge import LIVENESS_S
from test_host import ConfigDirCase

host = load_host()
REAL_FILESYSTEM_TYPE_OF = host.filesystem_type_of


class EditorCase(ConfigDirCase):
    def setUp(self):
        super().setUp()
        self.cache = os.path.join(self.tmp.name, "cache")
        self.runtime = os.path.join(self.tmp.name, "run")
        os.makedirs(self.runtime, mode=0o700)
        patcher = mock.patch.dict(os.environ, {"XDG_CACHE_HOME": self.cache, "XDG_RUNTIME_DIR": self.runtime})
        patcher.start()
        self.addCleanup(patcher.stop)
        # The temporary folder may sit on a disk, so the default says the runtime folder is memory-backed.
        patcher = mock.patch.object(host, "filesystem_type_of", return_value="tmpfs")
        patcher.start()
        self.addCleanup(patcher.stop)
        self.stubs = os.path.join(self.tmp.name, "stubs")
        os.makedirs(self.stubs)
        for patch in (mock.patch.object(host, "COLLECT_POLL_S", 0.02),):
            patch.start()
            self.addCleanup(patch.stop)
        self.children = []
        # The host drops its Popen on purpose (the editor outlives the one-shot host). Keeping the objects here
        # lets reap wait on them, so their finalizers have no running child to warn about.
        self.popens = []
        popens = self.popens

        class RecordingPopen(subprocess.Popen):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, **kwargs)
                popens.append(self)

        patch = mock.patch.object(host.subprocess, "Popen", RecordingPopen)
        patch.start()
        self.addCleanup(patch.stop)
        self.addCleanup(self.reap)

    def reap(self):
        for pid in self.children:
            try:
                os.kill(pid, 9)
            except OSError:
                pass
            try:
                os.waitpid(pid, 0)
            except OSError:
                pass
        for popen in self.popens:
            popen.kill()
            popen.wait()

    def stub(self, body):
        """An editor script (python) that gets the scratch file path as its last argument."""
        path = os.path.join(self.stubs, "editor.py")
        with open(path, "w") as file:
            file.write("import sys, time, os\npath = sys.argv[-1]\n" + textwrap.dedent(body))
        return path

    def configure(self, script, insert_argv=None):
        argv = [sys.executable, script, "{file}"]
        text = "argv = " + json.dumps(argv) + "\n"
        if insert_argv is not None:
            text += "insert_argv = " + json.dumps(insert_argv) + "\n"
        self.put("editor.toml", text)

    def start(self, **fields):
        reply = host.handle({"cmd": "editor_start", "text": "hello\n", **fields})
        self.assertRegex(reply["job"], r"^[0-9a-f]{32}$")
        self.children.append(self.job_record(reply["job"])["pid"])
        return reply["job"]

    def job_record(self, job):
        with open(os.path.join(host.editor_dirs()[0], f"job-{job}.json")) as file:
            return json.load(file)

    def collect(self, job, wait_s=5):
        return host.editor_collect({"cmd": "editor_collect", "job": job}, wait_s=wait_s)

    def editor_files(self):
        return sorted(os.listdir(host.editor_dirs()[0]))

    def without_runtime_dir(self):
        patcher = mock.patch.dict(os.environ)
        patcher.start()
        self.addCleanup(patcher.stop)
        del os.environ["XDG_RUNTIME_DIR"]

    def age(self, path, days=2):
        long_ago = time.time() - days * host.STALE_JOB_S
        os.utime(path, (long_ago, long_ago), follow_symlinks=False)

    def legacy_dir(self):
        path = os.path.join(self.cache, "desertfox", "editor")
        os.makedirs(path, mode=0o700, exist_ok=True)
        return path

    def plant(self, directory, name, days=2, content="old text"):
        path = os.path.join(directory, name)
        with open(path, "w") as file:
            file.write(content)
        self.age(path, days)
        return path

    def assertRefused(self, request, fragment):
        with self.assertRaises(host.HostError) as caught:
            host.handle(request)
        self.assertIn(fragment, str(caught.exception))


class ConfigTest(EditorCase):
    def test_missing_config_is_a_clear_refusal_and_writes_nothing(self):
        self.assertRefused({"cmd": "editor_start", "text": "x"}, "no editor is set up")
        self.assertFalse(os.path.exists(os.path.join(self.cache, "desertfox")))

    def test_broken_configs_name_the_file_and_the_problem(self):
        for text, fragment in [
            ("argv = [", "expected a quoted string"),
            ("argv = nope", "expected name"),
            ('argv = ["a"]\n', "{file}"),
            ('argv = ["{file}"]\n', "first element"),
            ('argv = []\n', "argv must be"),
            ('argv = ["a", "{file}"]\nshell = ["x"]\n', "unknown key shell"),
            ('argv = ["a", "{file}"]\nargv = ["b"]\n', "set twice"),
        ]:
            self.put("editor.toml", text)
            self.assertRefused({"cmd": "editor_start", "text": "x"}, fragment)
        self.assertRefused({"cmd": "editor_start", "text": "x"}, "editor.toml is broken")

    def test_parser_takes_comments_literal_strings_and_escapes(self):
        parsed = host.read_toml_strings('# top\nargv = [\n  "a b", # why\n  \'c\\d\', "e\\"f",\n]\ninsert_argv = []\n')
        self.assertEqual(parsed, {"argv": ["a b", "c\\d", 'e"f'], "insert_argv": []})

    def test_a_program_that_does_not_exist_is_a_refusal_and_leaves_no_file(self):
        self.put("editor.toml", 'argv = ["/nonexistent/editor", "{file}"]\n')
        self.assertRefused({"cmd": "editor_start", "text": "x"}, "cannot start")
        self.assertEqual(self.editor_files(), [])

    def test_editor_config_is_not_in_read_config(self):
        self.put("editor.toml", 'argv = ["secret", "{file}"]\n')
        self.put("settings.toml", "a = 1\n")
        self.assertEqual(list(host.handle({"cmd": "read_config"})["files"]), ["settings.toml"])


class StartTest(EditorCase):
    def test_validates_request_before_writing(self):
        self.configure(self.stub("pass\n"))
        for request, fragment in [
            ({"cmd": "editor_start"}, "string field text"),
            ({"cmd": "editor_start", "text": 5}, "string field text"),
            ({"cmd": "editor_start", "text": "x", "ext": "../x"}, "extension"),
            ({"cmd": "editor_start", "text": "x", "ext": "a" * 11}, "extension"),
            ({"cmd": "editor_start", "text": "x", "ext": 3}, "extension"),
            ({"cmd": "editor_start", "text": "x", "insert": "yes"}, "boolean"),
            ({"cmd": "editor_start", "text": "x", "argv": ["sh"]}, "not argv"),
            ({"cmd": "editor_start", "text": "\ud800"}, "unicode"),
        ]:
            self.assertRefused(request, fragment)
        self.assertFalse(os.path.exists(os.path.join(self.cache, "desertfox")))

    def test_text_over_the_cap_is_refused_before_writing_and_at_the_cap_passes(self):
        self.configure(self.stub("pass\n"))
        self.assertRefused({"cmd": "editor_start", "text": "x" * (host.MAX_EDITOR_TEXT_BYTES + 1)}, "over the")
        self.assertFalse(os.path.exists(os.path.join(self.cache, "desertfox")))
        self.start(text="x" * host.MAX_EDITOR_TEXT_BYTES)

    def test_scratch_file_is_private_and_named_with_the_extension(self):
        self.configure(self.stub("time.sleep(30)\n"))
        job = self.start(ext="md")
        directory = os.path.join(self.runtime, "desertfox", "editor")
        self.assertEqual(directory, host.editor_dirs()[0])
        scratch = [name for name in self.editor_files() if name.startswith("doc-")]
        self.assertEqual(len(scratch), 1)
        self.assertTrue(scratch[0].endswith(".md"))
        self.assertEqual(stat.S_IMODE(os.stat(directory).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(directory)).st_mode), 0o700)
        self.assertFalse(os.path.exists(os.path.join(self.cache, "desertfox")))
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(directory, scratch[0])).st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.join(directory, f"job-{job}.json")).st_mode), 0o600)
        with open(os.path.join(directory, scratch[0])) as file:
            self.assertEqual(file.read(), "hello\n")

    def test_insert_argv_goes_before_the_file_slot_only_when_insert_is_set(self):
        argv, insert_argv = ["term", "-e", "nvim", "{file}"], ["+normal! G", "+startinsert!"]
        self.assertEqual(host.editor_command(argv, insert_argv, "/s/f", True), ["term", "-e", "nvim", "+normal! G", "+startinsert!", "/s/f"])
        self.assertEqual(host.editor_command(argv, insert_argv, "/s/f", False), ["term", "-e", "nvim", "/s/f"])
        self.assertEqual(host.editor_command(["e", "--file={file}"], ["-i"], "/s/f", True), ["e", "-i", "--file=/s/f"])

    def test_page_text_is_one_argument_never_a_command(self):
        marker = os.path.join(self.tmp.name, "pwned")
        self.configure(self.stub("pass\n"))
        job = self.start(text=f"$(touch {marker}); `touch {marker}`", ext="txt")
        self.collect(job)
        self.assertFalse(os.path.exists(marker))

    def test_passes_the_insert_argv_to_the_editor(self):
        out = os.path.join(self.tmp.name, "argv.json")
        self.configure(self.stub(f"json.dump(sys.argv[1:], open({out!r}, 'w'))\n".replace("json.dump", "__import__('json').dump")), ["--insert"])
        job = self.start(insert=True)
        self.collect(job)
        with open(out) as file:
            self.assertEqual(json.load(file)[0], "--insert")


class CollectTest(EditorCase):
    def test_saved_and_exited_returns_text_stripped_and_removes_every_file(self):
        self.configure(self.stub("open(path, 'w').write('edited\\n\\n')\n"))
        job = self.start()
        reply = self.collect(job)
        self.assertEqual(reply, {"done": True, "changed": True, "text": "edited"})
        self.assertEqual(self.editor_files(), [])

    def test_exit_without_saving_returns_no_text_and_still_cleans_up(self):
        self.configure(self.stub("pass\n"))
        job = self.start()
        self.assertEqual(self.collect(job), {"done": True, "changed": False})
        self.assertEqual(self.editor_files(), [])

    def test_pending_while_the_editor_runs_then_done(self):
        gate = os.path.join(self.tmp.name, "gate")
        self.configure(self.stub(f"while not os.path.exists({gate!r}): time.sleep(0.02)\nopen(path, 'w').write('late')\n"))
        job = self.start()
        self.assertEqual(self.collect(job, wait_s=0.2), {"pending": True})
        self.assertEqual(len(self.editor_files()), 2)
        with open(gate, "w"):
            pass
        self.assertEqual(self.collect(job), {"done": True, "changed": True, "text": "late"})

    def test_a_save_in_an_editor_that_stays_open_stays_pending(self):
        self.configure(self.stub("open(path, 'w').write('saved')\ntime.sleep(30)\n"))
        job = self.start()
        self.assertEqual(self.collect(job, wait_s=0.5), {"pending": True})
        self.assertEqual(len(self.editor_files()), 2)

    def test_a_rename_and_write_save_is_pending_while_the_name_is_missing_then_collected(self):
        gate = os.path.join(self.tmp.name, "gate")
        self.configure(self.stub(
            f"os.rename(path, path + '~')\nwhile not os.path.exists({gate!r}): time.sleep(0.02)\n"
            "open(path, 'w').write('renamed')\n"))
        job = self.start()
        time.sleep(0.2)
        self.assertEqual(self.collect(job, wait_s=0.3), {"pending": True})
        with open(gate, "w"):
            pass
        self.assertEqual(self.collect(job), {"done": True, "changed": True, "text": "renamed"})
        self.assertEqual([n for n in self.editor_files() if n.startswith("job-")], [])

    def test_a_reused_pid_is_not_the_editor(self):
        own = os.getpid()
        ticks = host.process_start_ticks(own)
        self.assertTrue(host.editor_is_running(own, ticks))
        self.assertFalse(host.editor_is_running(own, str(int(ticks) + 1)))
        self.assertFalse(host.editor_is_running(own, None))

    def test_a_killed_collectors_claimed_job_is_swept(self):
        self.configure(self.stub("pass\n"))
        job = self.start()
        time.sleep(0.2)
        job_path, record, scratch = host.read_job(host.editor_dirs()[0], job)
        claimed = host.claim_job(job_path)
        long_ago = time.time() - 2 * host.STALE_JOB_S
        os.utime(claimed, (long_ago, long_ago))
        self.start()
        self.assertFalse(os.path.exists(claimed))
        self.assertFalse(os.path.exists(scratch))

    def test_a_job_file_failure_kills_the_new_editor_and_removes_the_scratch(self):
        pid_file = os.path.join(self.tmp.name, "pid")
        self.configure(self.stub(f"open({pid_file!r}, 'w').write(str(os.getpid()))\ntime.sleep(30)\n"))
        real_open = os.open

        def failing_open(path, *args, **kwargs):
            if os.path.basename(path).startswith("job-"):
                deadline = time.monotonic() + LIVENESS_S
                while not os.path.exists(pid_file) and time.monotonic() < deadline:
                    time.sleep(0.02)
                raise OSError(28, "No space left on device")
            return real_open(path, *args, **kwargs)

        with mock.patch.object(host.os, "open", failing_open):
            self.assertRefused({"cmd": "editor_start", "text": "x"}, "cannot write")
        self.assertEqual(self.editor_files(), [])
        with open(pid_file) as file:
            editor_pid = int(file.read())
        with self.assertRaises(ProcessLookupError):
            os.kill(editor_pid, 0)

    def test_an_argv_python_cannot_spawn_is_a_refusal_and_leaves_no_file(self):
        self.put("editor.toml", 'argv = ["ed\\u0000itor", "{file}"]\n')
        self.assertRefused({"cmd": "editor_start", "text": "x"}, "cannot start")
        self.assertEqual(self.editor_files(), [])

    def test_a_write_in_progress_is_never_read(self):
        # The editor truncates, pauses, then writes. A reader that took the first change would return an empty text.
        self.configure(self.stub("f = open(path, 'w')\nf.write('par')\nf.flush()\ntime.sleep(0.08)\nf.write('tial')\nf.close()\n"))
        job = self.start()
        self.assertEqual(self.collect(job), {"done": True, "changed": True, "text": "partial"})

    def test_a_collect_of_a_finished_job_is_refused(self):
        self.configure(self.stub("pass\n"))
        job = self.start()
        self.collect(job)
        with self.assertRaises(host.HostError) as caught:
            self.collect(job)
        self.assertIn("unknown editor job", str(caught.exception))

    def test_only_one_of_two_collectors_gets_the_job(self):
        self.configure(self.stub("open(path, 'w').write('x')\n"))
        job = self.start()
        directory = host.editor_dirs()[0]
        job_path, record, scratch = host.read_job(directory, job)
        first = host.claim_job(job_path)
        with self.assertRaises(host.HostError):
            host.claim_job(job_path)
        host.collect_result(record, scratch, first)
        self.assertEqual(self.editor_files(), [])

    def test_forged_job_ids_are_refused(self):
        self.configure(self.stub("pass\n"))
        for forged in ["../../etc/passwd", "a" * 32, "0" * 31, None, 7, "../" + "0" * 32, ""]:
            self.assertRefused({"cmd": "editor_collect", "job": forged}, "unknown editor job")
        self.assertRefused({"cmd": "editor_collect", "job": "0" * 32, "path": "/x"}, "not path")

    def test_a_job_file_cannot_point_outside_the_editor_folder(self):
        self.configure(self.stub("time.sleep(30)\n"))
        job = self.start()
        directory = host.editor_dirs()[0]
        victim = os.path.join(self.tmp.name, "victim")
        with open(victim, "w") as file:
            file.write("keep")
        record = self.job_record(job)
        record["scratch"] = "../../../victim"
        with open(os.path.join(directory, f"job-{job}.json"), "w") as file:
            json.dump(record, file)
        job_path, _, scratch = host.read_job(directory, job)
        self.assertEqual(os.path.dirname(scratch), directory)
        self.assertTrue(os.path.exists(victim))

    def test_an_edit_over_the_cap_is_refused_and_the_files_are_still_removed(self):
        self.configure(self.stub(f"open(path, 'w').write('x' * {host.MAX_EDITOR_TEXT_BYTES + 1})\n"))
        job = self.start()
        with self.assertRaises(host.HostError) as caught:
            self.collect(job)
        self.assertIn("dropped", str(caught.exception))
        self.assertEqual(self.editor_files(), [])

    def test_survives_the_starting_process(self):
        # The one-shot host that ran editor_start is gone. Run it as a real process and collect from this one.
        import subprocess
        gate = os.path.join(self.tmp.name, "gate")
        self.configure(self.stub(f"while not os.path.exists({gate!r}): time.sleep(0.02)\nopen(path, 'w').write('later')\n"))
        from test_host import frame, unframe
        from host_under_test import HOST_PATH
        run = subprocess.run([sys.executable, HOST_PATH], input=frame({"cmd": "editor_start", "text": "t"}), capture_output=True, timeout=LIVENESS_S)
        job = unframe(run.stdout)["job"]
        self.children.append(self.job_record(job)["pid"])
        self.assertEqual(self.collect(job, wait_s=0.2), {"pending": True})
        with open(gate, "w"):
            pass
        self.assertEqual(self.collect(job), {"done": True, "changed": True, "text": "later"})

    def test_stale_jobs_of_a_dead_editor_are_swept_at_the_next_start(self):
        self.configure(self.stub("pass\n"))
        old = self.start()
        directory = host.editor_dirs()[0]
        time.sleep(0.2)
        long_ago = time.time() - 2 * host.STALE_JOB_S
        os.utime(os.path.join(directory, f"job-{old}.json"), (long_ago, long_ago))
        fresh = self.start()
        names = self.editor_files()
        self.assertNotIn(f"job-{old}.json", names)
        self.assertIn(f"job-{fresh}.json", names)
        self.assertEqual(len([n for n in names if n.startswith("doc-")]), 1)


class RuntimeDirTest(EditorCase):
    def used_dir(self):
        self.configure(self.stub("pass\n"))
        self.start()
        return host.editor_dirs()[0]

    def test_unset_and_relative_runtime_dirs_fall_back_to_the_cache(self):
        self.without_runtime_dir()
        self.assertEqual(self.used_dir(), os.path.join(self.cache, "desertfox", "editor"))
        os.environ["XDG_RUNTIME_DIR"] = "relative/run"
        self.assertEqual(host.editor_dirs()[0], os.path.join(self.cache, "desertfox", "editor"))

    def test_a_group_or_other_writable_runtime_parent_is_rejected(self):
        for mode in (0o770, 0o707, 0o777):
            os.chmod(self.runtime, mode)
            self.assertIsNone(host.runtime_editor_dir(create=True))
        self.assertFalse(os.path.exists(os.path.join(self.runtime, "desertfox")))
        os.chmod(self.runtime, 0o755)
        self.assertIsNotNone(host.runtime_editor_dir(create=True))

    def test_a_symlinked_runtime_parent_is_rejected(self):
        real = os.path.join(self.tmp.name, "real")
        os.makedirs(real, mode=0o700)
        link = os.path.join(self.tmp.name, "link")
        os.symlink(real, link)
        os.environ["XDG_RUNTIME_DIR"] = link
        self.assertIsNone(host.runtime_editor_dir(create=True))
        self.assertEqual(os.listdir(real), [])

    def test_a_runtime_parent_of_another_user_is_rejected(self):
        with mock.patch.object(host.os, "getuid", return_value=os.getuid() + 1):
            self.assertIsNone(host.runtime_editor_dir(create=True))
        self.assertEqual(os.listdir(self.runtime), [])

    def test_a_symlinked_or_foreign_subfolder_is_rejected(self):
        elsewhere = os.path.join(self.tmp.name, "elsewhere")
        os.makedirs(elsewhere, mode=0o700)
        os.symlink(elsewhere, os.path.join(self.runtime, "desertfox"))
        self.assertIsNone(host.runtime_editor_dir(create=True))
        os.unlink(os.path.join(self.runtime, "desertfox"))
        os.makedirs(os.path.join(self.runtime, "desertfox"), mode=0o700)
        os.symlink(elsewhere, os.path.join(self.runtime, "desertfox", "editor"))
        self.assertIsNone(host.runtime_editor_dir(create=True))
        self.assertEqual(os.listdir(elsewhere), [])

    def test_subfolders_with_open_modes_are_tightened_to_0700(self):
        for path in (os.path.join(self.runtime, "desertfox"), os.path.join(self.runtime, "desertfox", "editor")):
            os.makedirs(path, mode=0o755, exist_ok=True)
            os.chmod(path, 0o755)
        self.assertIsNone(host.runtime_editor_dir())
        directory = host.runtime_editor_dir(create=True)
        self.assertEqual(stat.S_IMODE(os.stat(directory).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(directory)).st_mode), 0o700)

    def test_an_unusable_runtime_dir_runs_the_editor_from_the_cache(self):
        os.chmod(self.runtime, 0o777)
        self.assertEqual(self.used_dir(), os.path.join(self.cache, "desertfox", "editor"))

    def test_collect_finds_the_job_in_the_runtime_dir(self):
        self.configure(self.stub("open(path, 'w').write('edited')\n"))
        self.assertEqual(self.collect(self.start()), {"done": True, "changed": True, "text": "edited"})
        self.assertEqual(self.editor_files(), [])


MOUNTINFO = r"""22 1 8:2 / / rw,relatime shared:1 - ext4 /dev/sda2 rw
30 22 0:25 / /run rw,nosuid shared:5 - tmpfs tmpfs rw
31 30 0:30 / /run/user/1000 rw,nosuid shared:6 - tmpfs tmpfs rw
32 22 0:31 / /mnt/my\040disk rw shared:7 - ext4 /dev/sdb1 rw
33 22 0:32 / /srv rw shared:8 - ramfs none rw
"""


class MemoryBackedTest(EditorCase):
    def test_the_filesystem_type_is_that_of_the_longest_mount_point(self):
        kind = lambda path: REAL_FILESYSTEM_TYPE_OF(path, MOUNTINFO)
        self.assertEqual(kind("/run/user/1000/desertfox/editor"), "tmpfs")
        self.assertEqual(kind("/run/user/1001/x"), "tmpfs")
        self.assertEqual(kind("/run/user/1000"), "tmpfs")
        self.assertEqual(kind("/home/me/run"), "ext4")
        self.assertEqual(kind("/mnt/my disk/run"), "ext4")
        self.assertEqual(kind("/runner"), "ext4")
        self.assertEqual(kind("/srv/x"), "ramfs")

    def test_only_tmpfs_and_ramfs_count_as_memory(self):
        for kind, expected in (("tmpfs", True), ("ramfs", True), ("ext4", False), ("overlay", False), (None, False)):
            with mock.patch.object(host, "filesystem_type_of", return_value=kind):
                self.assertEqual(host.is_memory_backed("/x"), expected, kind)

    def test_a_runtime_folder_on_a_disk_serves_normal_edits_and_refuses_private_ones(self):
        self.configure(self.stub("pass\n"))
        with mock.patch.object(host, "filesystem_type_of", return_value="ext4"):
            self.start()
            self.assertEqual(host.editor_dirs()[0], os.path.join(self.runtime, "desertfox", "editor"))
            before = self.editor_files()
            self.assertRefused({"cmd": "editor_start", "text": "x", "private": True}, "private windows")
            self.assertEqual(self.editor_files(), before)
            self.assertFalse(os.path.exists(os.path.join(self.cache, "desertfox")))

    def test_a_job_started_on_the_fallback_is_collected_after_the_runtime_folder_works(self):
        self.configure(self.stub("time.sleep(0.5)\nopen(path, 'w').write('edited')\n"))
        os.chmod(self.runtime, 0o777)
        first = self.start()
        self.assertEqual(os.path.dirname(host.find_job(first)[0]), os.path.join(self.cache, "desertfox", "editor"))
        os.chmod(self.runtime, 0o700)
        self.start()
        self.assertEqual(self.collect(first), {"done": True, "changed": True, "text": "edited"})


class SweepTest(EditorCase):
    def test_an_orphan_scratch_swap_and_backup_older_than_a_day_go_and_younger_files_stay(self):
        self.configure(self.stub("pass\n"))
        directory = os.path.join(self.runtime, "desertfox", "editor")
        os.makedirs(directory, mode=0o700)
        for name in ("doc-1.md", ".doc-1.md.swp", "doc-1.md~"):
            self.plant(directory, name)
        self.plant(directory, "doc-2.md", days=0.5)
        self.start()
        names = self.editor_files()
        for gone in ("doc-1.md", ".doc-1.md.swp", "doc-1.md~"):
            self.assertNotIn(gone, names)
        self.assertIn("doc-2.md", names)

    def test_a_host_that_died_between_the_scratch_and_the_job_write_leaves_nothing_the_sweep_misses(self):
        self.configure(self.stub("pass\n"))
        with mock.patch.object(host.subprocess, "Popen", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                host.handle({"cmd": "editor_start", "text": "page text"})
        orphans = self.editor_files()
        self.assertEqual(len(orphans), 1)
        self.age(os.path.join(host.editor_dirs()[0], orphans[0]))
        self.start()
        self.assertNotIn(orphans[0], self.editor_files())

    def test_the_files_of_a_live_editor_survive_whatever_their_age(self):
        self.configure(self.stub("time.sleep(30)\n"))
        job = self.start(ext="md")
        directory = host.editor_dirs()[0]
        scratch = self.job_record(job)["scratch"]
        swap = self.plant(directory, f".{scratch}.swp")
        backup = self.plant(directory, f"{scratch}~")
        for name in (scratch, f"job-{job}.json"):
            self.age(os.path.join(directory, name))
        stranger = self.plant(directory, "doc-other.md")
        time.sleep(0.2)
        self.start()
        self.assertTrue(os.path.exists(swap))
        self.assertTrue(os.path.exists(backup))
        self.assertTrue(os.path.exists(os.path.join(directory, scratch)))
        self.assertTrue(os.path.exists(os.path.join(directory, f"job-{job}.json")))
        self.assertFalse(os.path.exists(stranger))

    def test_a_dead_job_with_an_old_job_file_goes_with_its_swap_file(self):
        self.configure(self.stub("pass\n"))
        job = self.start()
        time.sleep(0.3)
        directory = host.editor_dirs()[0]
        scratch = self.job_record(job)["scratch"]
        swap = self.plant(directory, f".{scratch}.swp")
        self.age(os.path.join(directory, f"job-{job}.json"))
        self.start()
        self.assertFalse(os.path.exists(swap))
        self.assertFalse(os.path.exists(os.path.join(directory, scratch)))

    def test_a_file_saved_after_the_age_listing_is_not_deleted(self):
        self.configure(self.stub("pass\n"))
        directory = os.path.join(self.runtime, "desertfox", "editor")
        os.makedirs(directory, mode=0o700)
        saved = self.plant(directory, "doc-saved.md")
        real_stat = os.stat
        calls = []

        def stat_then_save(path, *args, **kwargs):
            result = real_stat(path, *args, **kwargs)
            calls.append(path)
            if path == "doc-saved.md" and len(calls) == 1:
                os.utime(saved)
            return result

        with mock.patch.object(host.os, "stat", stat_then_save):
            host.sweep_editor_dir(directory)
        self.assertTrue(os.path.exists(saved))

    def test_a_collector_that_claims_between_the_record_read_and_the_unlink_keeps_the_saved_text(self):
        self.configure(self.stub("pass\n"))
        job = self.start()
        time.sleep(0.3)
        directory = host.editor_dirs()[0]
        job_path, record, scratch = host.read_job(directory, job)
        self.age(job_path)
        self.age(scratch)
        real_read = host.read_job_file_quietly

        def read_then_collect(directory_fd, name):
            result = real_read(directory_fd, name)
            if name == f"job-{job}.json":
                with open(scratch, "w") as file:
                    file.write("SAVED")
                host.claim_job(job_path)
            return result

        with mock.patch.object(host, "read_job_file_quietly", read_then_collect):
            host.sweep_editor_dir(directory)
        with open(scratch) as file:
            self.assertEqual(file.read(), "SAVED")
        self.assertEqual([n for n in os.listdir(directory) if n.endswith(".done")], [f"job-{job}.json.{os.getpid()}.done"])

    def test_a_claimed_job_of_a_long_run_is_not_swept_while_it_is_collected(self):
        self.configure(self.stub("pass\n"))
        job = self.start()
        time.sleep(0.3)
        directory = host.editor_dirs()[0]
        job_path, record, scratch = host.read_job(directory, job)
        self.age(job_path)
        claimed = host.claim_job(job_path)
        self.start()
        self.assertTrue(os.path.exists(claimed))
        self.assertTrue(os.path.exists(scratch))

    def test_a_symlink_is_unlinked_never_followed_and_nothing_outside_the_folder_is_touched(self):
        self.configure(self.stub("pass\n"))
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        victim = self.plant(outside, "victim.txt")
        victim_dir = os.path.join(outside, "dir")
        os.makedirs(victim_dir)
        precious = self.plant(victim_dir, "inside.txt")
        directory = os.path.join(self.runtime, "desertfox", "editor")
        os.makedirs(directory, mode=0o700)
        link = os.path.join(directory, "doc-link.md")
        os.symlink(victim, link)
        self.age(link)
        dir_link = os.path.join(directory, "doc-dirlink")
        os.symlink(victim_dir, dir_link)
        self.age(dir_link)
        subfolder = os.path.join(directory, "sub")
        os.makedirs(subfolder)
        inner = self.plant(subfolder, "old.txt")
        self.age(subfolder)
        job_link = os.path.join(directory, "job-" + "a" * 32 + ".json")
        os.symlink(victim, job_link)
        self.age(job_link)
        self.start()
        self.assertFalse(os.path.lexists(link))
        self.assertFalse(os.path.lexists(dir_link))
        self.assertFalse(os.path.lexists(job_link))
        self.assertTrue(os.path.exists(victim))
        self.assertTrue(os.path.exists(precious))
        self.assertTrue(os.path.exists(inner))

    def test_a_job_file_symlinked_to_a_fifo_does_not_block_the_sweep(self):
        self.configure(self.stub("pass\n"))
        directory = os.path.join(self.runtime, "desertfox", "editor")
        os.makedirs(directory, mode=0o700)
        fifo = os.path.join(directory, "job-" + "b" * 32 + ".json")
        os.mkfifo(fifo)
        self.age(fifo)
        self.start()
        self.assertFalse(os.path.lexists(fifo))

    def test_a_symlinked_editor_folder_is_not_swept(self):
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        victim = self.plant(outside, "doc-x")
        link = os.path.join(self.tmp.name, "linkdir")
        os.symlink(outside, link)
        host.sweep_editor_dir(link)
        self.assertTrue(os.path.exists(victim))


class LegacyTest(EditorCase):
    def test_old_files_in_the_cache_folder_go_and_the_empty_folder_is_removed(self):
        self.configure(self.stub("pass\n"))
        legacy = self.legacy_dir()
        self.plant(legacy, "doc-old.md")
        self.plant(legacy, "job-" + "c" * 32 + ".json", content="not json")
        self.start()
        self.assertFalse(os.path.exists(legacy))

    def test_a_young_legacy_file_and_the_folder_stay(self):
        self.configure(self.stub("pass\n"))
        legacy = self.legacy_dir()
        young = self.plant(legacy, "doc-young.md", days=0.1)
        self.plant(legacy, "doc-old.md")
        self.start()
        self.assertTrue(os.path.exists(young))
        self.assertFalse(os.path.exists(os.path.join(legacy, "doc-old.md")))

    def test_a_live_legacy_job_survives_whatever_its_age(self):
        self.configure(self.stub("time.sleep(30)\n"))
        self.without_runtime_dir()
        job = self.start()
        legacy = host.editor_dirs()[0]
        scratch = self.job_record(job)["scratch"]
        for name in (scratch, f"job-{job}.json"):
            self.age(os.path.join(legacy, name))
        os.environ["XDG_RUNTIME_DIR"] = self.runtime
        time.sleep(0.2)
        self.start()
        self.assertTrue(os.path.exists(os.path.join(legacy, scratch)))
        self.assertTrue(os.path.exists(os.path.join(legacy, f"job-{job}.json")))

    def test_a_symlinked_legacy_folder_is_left_alone(self):
        self.configure(self.stub("pass\n"))
        outside = os.path.join(self.tmp.name, "outside")
        os.makedirs(outside)
        victim = self.plant(outside, "doc-x")
        os.makedirs(os.path.join(self.cache, "desertfox"))
        os.symlink(outside, os.path.join(self.cache, "desertfox", "editor"))
        self.start()
        self.assertTrue(os.path.exists(victim))

    def test_the_active_cache_fallback_folder_is_not_removed_as_legacy(self):
        self.configure(self.stub("time.sleep(30)\n"))
        self.without_runtime_dir()
        self.start()
        self.assertTrue(os.path.isdir(host.editor_dirs()[0]))


class PrivateTest(EditorCase):
    def test_private_with_the_runtime_dir_works(self):
        self.configure(self.stub("pass\n"))
        self.start(private=True)

    def test_private_with_the_cache_fallback_is_refused_and_writes_nothing(self):
        self.configure(self.stub("pass\n"))
        self.without_runtime_dir()
        self.assertRefused({"cmd": "editor_start", "text": "x", "private": True}, "private windows")
        self.assertFalse(os.path.exists(os.path.join(self.cache, "desertfox")))

    def test_private_false_with_the_cache_fallback_works(self):
        self.configure(self.stub("pass\n"))
        self.without_runtime_dir()
        self.start(private=False)

    def test_private_of_the_wrong_type_is_refused(self):
        self.configure(self.stub("pass\n"))
        for value in ("yes", 1, None):
            self.assertRefused({"cmd": "editor_start", "text": "x", "private": value}, "boolean private")
        self.assertFalse(os.path.exists(os.path.join(self.runtime, "desertfox")))


if __name__ == "__main__":
    unittest.main()
