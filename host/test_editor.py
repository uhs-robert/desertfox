import json
import os
import stat
import sys
import tempfile
import textwrap
import time
import unittest
from unittest import mock

from host_under_test import load_host
from test_host import ConfigDirCase

host = load_host()


class EditorCase(ConfigDirCase):
    def setUp(self):
        super().setUp()
        self.cache = os.path.join(self.tmp.name, "cache")
        patcher = mock.patch.dict(os.environ, {"XDG_CACHE_HOME": self.cache})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.stubs = os.path.join(self.tmp.name, "stubs")
        os.makedirs(self.stubs)
        for patch in (mock.patch.object(host, "COLLECT_POLL_S", 0.02),):
            patch.start()
            self.addCleanup(patch.stop)
        self.children = []
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
        with open(os.path.join(host.editor_dir(), f"job-{job}.json")) as file:
            return json.load(file)

    def collect(self, job, wait_s=5):
        return host.editor_collect({"cmd": "editor_collect", "job": job}, wait_s=wait_s)

    def editor_files(self):
        return sorted(os.listdir(os.path.join(self.cache, "desertfox", "editor")))

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
        directory = os.path.join(self.cache, "desertfox", "editor")
        scratch = [name for name in self.editor_files() if name.startswith("doc-")]
        self.assertEqual(len(scratch), 1)
        self.assertTrue(scratch[0].endswith(".md"))
        self.assertEqual(stat.S_IMODE(os.stat(directory).st_mode), 0o700)
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
        job_path, record, scratch = host.read_job(host.editor_dir(), job)
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
                raise OSError(28, "No space left on device")
            return real_open(path, *args, **kwargs)

        with mock.patch.object(host.os, "open", failing_open):
            self.assertRefused({"cmd": "editor_start", "text": "x"}, "cannot write")
        self.assertEqual(self.editor_files(), [])

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
        directory = host.editor_dir()
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
        directory = host.editor_dir()
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
        run = subprocess.run([sys.executable, HOST_PATH], input=frame({"cmd": "editor_start", "text": "t"}), capture_output=True, timeout=10)
        job = unframe(run.stdout)["job"]
        self.children.append(self.job_record(job)["pid"])
        self.assertEqual(self.collect(job, wait_s=0.2), {"pending": True})
        with open(gate, "w"):
            pass
        self.assertEqual(self.collect(job), {"done": True, "changed": True, "text": "later"})

    def test_stale_jobs_of_a_dead_editor_are_swept_at_the_next_start(self):
        self.configure(self.stub("pass\n"))
        old = self.start()
        directory = host.editor_dir()
        time.sleep(0.2)
        long_ago = time.time() - 2 * host.STALE_JOB_S
        os.utime(os.path.join(directory, f"job-{old}.json"), (long_ago, long_ago))
        fresh = self.start()
        names = self.editor_files()
        self.assertNotIn(f"job-{old}.json", names)
        self.assertIn(f"job-{fresh}.json", names)
        self.assertEqual(len([n for n in names if n.startswith("doc-")]), 1)


if __name__ == "__main__":
    unittest.main()
