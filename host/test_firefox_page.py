import json
import os
import signal
import sys
import tempfile
import time
import unittest
from unittest import mock

from host_under_test import load_host

host = load_host()

# A stand-in for the Firefox remote client. It records what it got and then acts as STUB_MODE says.
STUB_BODY = r'''
import json, os, subprocess, sys, time
mode = os.environ.get("STUB_MODE", "ok")
fds = {}
for name in os.listdir("/proc/self/fd"):
    try:
        fds[name] = os.readlink(f"/proc/self/fd/{name}")
    except OSError:
        pass
record = {"argv": sys.argv, "env": dict(os.environ), "fds": fds, "pgid": os.getpgid(0), "sid": os.getsid(0), "pid": os.getpid()}
with open(os.environ["STUB_OUT"], "w") as file:
    json.dump(record, file)
if mode == "fail":
    sys.stderr.write("first line\nError: cannot reach the running Firefox\n")
    sys.exit(3)
if mode in ("hang", "orphan"):
    # A grandchild that keeps stderr open, as a second Firefox started by a failed hand-off does.
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], stderr=sys.stderr)
    with open(os.environ["STUB_OUT"] + ".grandchild", "w") as file:
        file.write(str(child.pid))
    if mode == "hang":
        time.sleep(60)
'''


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:
        with open(f"/proc/{pid}/stat") as file:
            return file.read().rsplit(")", 1)[1].split()[0] != "Z"
    except OSError:
        return False


class FirefoxPageCase(unittest.TestCase):
    PARENT_PID = 4242

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = self.tmp.name
        self.bin_dir = os.path.join(root, "lib", "firefox")
        os.makedirs(self.bin_dir)
        self.exe = os.path.join(self.bin_dir, "firefox")
        with open(self.exe, "w") as file:
            file.write(f"#!{sys.executable}\n{STUB_BODY}")
        os.chmod(self.exe, 0o755)
        self.profile = os.path.join(root, "profile")
        os.makedirs(self.profile)
        open(os.path.join(self.profile, ".parentlock"), "w").close()
        self.proc_root = os.path.join(root, "proc")
        self.proc_dir = os.path.join(self.proc_root, str(self.PARENT_PID))
        os.makedirs(os.path.join(self.proc_dir, "fd"))
        self.set_exe(self.exe)
        self.hold_open(3, os.path.join(self.profile, "places.sqlite"))
        self.hold_open(4, os.path.join(self.profile, ".parentlock"))
        self.out = os.path.join(root, "stub_out.json")
        self.environ = {
            "PATH": os.environ.get("PATH", "/usr/bin"),
            "STUB_OUT": self.out,
            "WAYLAND_DISPLAY": "wayland-1",
            "DISPLAY": ":0",
            "DBUS_SESSION_BUS_ADDRESS": "unix:path=/run/user/1000/bus",
            "XDG_RUNTIME_DIR": "/run/user/1000",
            "MOZ_CRASHREPORTER_EVENTS_DIRECTORY": os.path.join(self.profile, "crashes", "events"),
            "MOZ_CRASHREPORTER_RESTART_ARG_0": "/usr/lib/firefox/firefox",
            "XRE_PROFILE_PATH": "",
            "MOZ_LAUNCHED_CHILD": "",
            "MOZ_APP_SILENT_START": "",
            "MOZ_NO_REMOTE": "1",
            "MOZ_NEW_INSTANCE": "1",
        }
        self.grandchildren = []
        self.addCleanup(self.reap_grandchildren)

    def reap_grandchildren(self):
        for pid in self.grandchildren:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass

    def set_exe(self, target):
        link = os.path.join(self.proc_dir, "exe")
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(target, link)

    def hold_open(self, fd, target):
        link = os.path.join(self.proc_dir, "fd", str(fd))
        if os.path.lexists(link):
            os.remove(link)
        os.symlink(target, link)

    def open_page(self, page="settings", **extra):
        return host.open_firefox_page({"cmd": "open_firefox_page", "page": page, **extra}, parent_pid=self.PARENT_PID, proc_root=self.proc_root, environ=self.environ)

    def refusal(self, page="settings", **extra):
        with self.assertRaises(host.HostError) as caught:
            self.open_page(page, **extra)
        return str(caught.exception)

    def stub_record(self):
        with open(self.out) as file:
            return json.load(file)


class PageTableTest(FirefoxPageCase):
    def test_each_page_runs_the_parent_firefox_on_its_profile_and_url(self):
        for page, url in host.FIREFOX_PAGES.items():
            with self.subTest(page=page):
                self.assertEqual(self.open_page(page), {"page": page})
                self.assertEqual(self.stub_record()["argv"], [self.exe, "--profile", self.profile, url])

    def test_the_table_holds_only_about_pages(self):
        self.assertEqual(len(host.FIREFOX_PAGES), 13)
        for url in host.FIREFOX_PAGES.values():
            self.assertRegex(url, r"^about:[a-z]+(#/[a-z/-]+)?$")

    def test_an_unknown_page_is_refused_and_nothing_runs(self):
        for page in ("about:config", "--profile", "settings ", "", None, 3, ["settings"]):
            with self.subTest(page=page):
                self.assertIn("unknown Firefox page", self.refusal(page))
        self.assertFalse(os.path.exists(self.out))

    def test_an_extra_field_is_refused(self):
        self.assertIn("takes only page, not url", self.refusal(url="about:robots"))
        self.assertFalse(os.path.exists(self.out))

    def test_the_verb_is_routed_by_handle(self):
        # The test runner's parent is no Firefox, so the real /proc refuses it.
        with self.assertRaises(host.HostError) as caught:
            host.handle({"cmd": "open_firefox_page", "page": "settings"})
        self.assertIn("not started by Firefox", str(caught.exception))


class ParentTest(FirefoxPageCase):
    def test_a_parent_that_is_not_firefox_is_refused(self):
        self.set_exe("/usr/bin/bash")
        self.assertIn("not started by Firefox but by /usr/bin/bash", self.refusal())
        self.assertFalse(os.path.exists(self.out))

    def test_a_parent_named_like_firefox_with_a_prefix_is_refused(self):
        self.set_exe("/usr/bin/not-firefox")
        self.assertIn("not started by Firefox", self.refusal())

    def test_an_unreadable_parent_is_refused(self):
        os.remove(os.path.join(self.proc_dir, "exe"))
        self.assertIn("cannot read the program that started the host", self.refusal())

    def test_a_deleted_suffix_is_stripped(self):
        self.set_exe(self.exe + " (deleted)")
        self.open_page()
        self.assertEqual(self.stub_record()["argv"][0], self.exe)

    def test_a_deleted_binary_with_no_replacement_is_refused(self):
        gone = os.path.join(self.tmp.name, "gone", "firefox")
        self.set_exe(gone + " (deleted)")
        message = self.refusal()
        self.assertIn(f"the Firefox program {gone} is gone", message)
        self.assertIn("Restart Firefox", message)

    def test_the_other_firefox_program_names_are_accepted(self):
        for name in ("firefox-bin", "firefox-esr", "firefox-esr-bin"):
            with self.subTest(name=name):
                program = os.path.join(self.bin_dir, name)
                os.symlink(self.exe, program)
                self.set_exe(program)
                self.open_page()
                self.assertEqual(self.stub_record()["argv"][0], program)


class ProfileTest(FirefoxPageCase):
    def test_the_lock_alone_is_enough(self):
        del self.environ["MOZ_CRASHREPORTER_EVENTS_DIRECTORY"]
        self.open_page()
        self.assertEqual(self.stub_record()["argv"][2], self.profile)

    def test_the_crash_reporter_folder_is_the_fallback(self):
        os.remove(os.path.join(self.proc_dir, "fd", "4"))
        self.open_page()
        self.assertEqual(self.stub_record()["argv"][2], self.profile)

    def test_an_unreadable_fd_folder_falls_back_to_the_crash_reporter(self):
        os.chmod(os.path.join(self.proc_dir, "fd"), 0)
        self.addCleanup(os.chmod, os.path.join(self.proc_dir, "fd"), 0o755)
        self.open_page()
        self.assertEqual(self.stub_record()["argv"][2], self.profile)

    def test_no_source_is_refused(self):
        os.remove(os.path.join(self.proc_dir, "fd", "4"))
        del self.environ["MOZ_CRASHREPORTER_EVENTS_DIRECTORY"]
        self.assertIn("cannot find the profile", self.refusal())
        self.assertFalse(os.path.exists(self.out))

    def test_disagreeing_sources_are_refused(self):
        other = os.path.join(self.tmp.name, "other")
        os.makedirs(other)
        open(os.path.join(other, ".parentlock"), "w").close()
        self.environ["MOZ_CRASHREPORTER_EVENTS_DIRECTORY"] = os.path.join(other, "crashes", "events")
        self.assertIn("is unclear", self.refusal())
        self.assertFalse(os.path.exists(self.out))

    def test_a_relative_profile_is_refused(self):
        os.remove(os.path.join(self.proc_dir, "fd", "4"))
        self.environ["MOZ_CRASHREPORTER_EVENTS_DIRECTORY"] = "--new-instance/crashes/events"
        self.assertIn("is not absolute", self.refusal())
        self.assertFalse(os.path.exists(self.out))

    def test_a_crash_folder_of_another_shape_is_ignored(self):
        os.remove(os.path.join(self.proc_dir, "fd", "4"))
        self.environ["MOZ_CRASHREPORTER_EVENTS_DIRECTORY"] = os.path.join(self.profile, "elsewhere")
        self.assertIn("cannot find the profile", self.refusal())

    def test_a_profile_without_a_lock_file_is_refused(self):
        os.remove(os.path.join(self.profile, ".parentlock"))
        self.assertIn("holds no .parentlock", self.refusal())
        self.assertFalse(os.path.exists(self.out))


class LaunchTest(FirefoxPageCase):
    def test_the_environment_drops_the_parent_variables_and_keeps_display_and_bus(self):
        self.open_page()
        env = self.stub_record()["env"]
        for name in ("MOZ_CRASHREPORTER_EVENTS_DIRECTORY", "MOZ_CRASHREPORTER_RESTART_ARG_0", "XRE_PROFILE_PATH", "MOZ_LAUNCHED_CHILD", "MOZ_APP_SILENT_START", "MOZ_NO_REMOTE", "MOZ_NEW_INSTANCE"):
            self.assertNotIn(name, env)
        for name in ("WAYLAND_DISPLAY", "DISPLAY", "DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"):
            self.assertEqual(env[name], self.environ[name])

    def test_the_child_gets_no_pipe_of_the_host_and_a_session_of_its_own(self):
        # Inheritable pipes stand in for the native messaging pipes on fds the host holds.
        read_end, write_end = os.pipe()
        os.set_inheritable(read_end, True)
        os.set_inheritable(write_end, True)
        self.addCleanup(os.close, read_end)
        self.addCleanup(os.close, write_end)
        self.open_page()
        record = self.stub_record()
        self.assertEqual(record["fds"]["0"], "/dev/null")
        self.assertEqual(record["fds"]["1"], "/dev/null")
        self.assertFalse([target for target in record["fds"].values() if target.startswith("pipe:")], record["fds"])
        self.assertEqual(record["sid"], record["pid"])
        self.assertEqual(record["pgid"], record["pid"])

    def test_a_nonzero_exit_refuses_with_the_last_stderr_line(self):
        self.environ["STUB_MODE"] = "fail"
        message = self.refusal()
        self.assertIn("exit 3", message)
        self.assertIn("Error: cannot reach the running Firefox", message)
        self.assertNotIn("first line", message)

    def test_a_timeout_kills_the_process_group_and_refuses(self):
        self.environ["STUB_MODE"] = "hang"
        with mock.patch.object(host, "FIREFOX_REMOTE_TIMEOUT_S", 0.8):
            started = time.monotonic()
            message = self.refusal()
            took = time.monotonic() - started
        self.assertIn("Firefox did not take the request", message)
        self.assertLess(took, 5)
        with open(self.out + ".grandchild") as file:
            grandchild = int(file.read())
        self.grandchildren.append(grandchild)
        stub = self.stub_record()["pid"]
        deadline = time.monotonic() + 3
        while (alive(grandchild) or alive(stub)) and time.monotonic() < deadline:
            time.sleep(0.05)
        self.assertFalse(alive(stub))
        self.assertFalse(alive(grandchild))

    def test_a_grandchild_that_keeps_stderr_open_does_not_hold_the_host(self):
        self.environ["STUB_MODE"] = "orphan"
        started = time.monotonic()
        self.assertEqual(self.open_page(), {"page": "settings"})
        self.assertLess(time.monotonic() - started, 5)
        with open(self.out + ".grandchild") as file:
            self.grandchildren.append(int(file.read()))

    def test_a_program_that_is_not_executable_is_refused_before_the_launch(self):
        os.chmod(self.exe, 0o644)
        self.assertIn("is gone", self.refusal())

    def test_a_launch_that_fails_is_refused_with_the_reason(self):
        # An executable that the kernel cannot run passes the access check and fails in Popen.
        with open(self.exe, "w") as file:
            file.write("#!/nonexistent/interpreter\n")
        message = self.refusal()
        self.assertIn(f"cannot start {self.exe}", message)
        self.assertIn("No such file or directory", message)


if __name__ == "__main__":
    unittest.main()
