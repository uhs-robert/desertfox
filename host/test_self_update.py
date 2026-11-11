"""Tests of the config host's `self_update` verb. Every download goes through an injected fetch, so nothing touches the
network, and every install lives under a temporary HOME."""
import email.message
import fcntl
import hashlib
import io
import json
import os
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request
from unittest import mock

from host_under_test import HOST_DIR, load_host

host = load_host()

OLD = "0.1.22"
NEW = "0.1.23"
SCRIPTS = ("desertfox-bridge", "desertfox-host", "desertfox")


def repo_bytes(name):
    with open(os.path.join(HOST_DIR, name), "rb") as file:
        return file.read()


def stamped(name, version):
    """The script as `just release_stamp` ships it."""
    data = repo_bytes(name)
    if name == "desertfox":
        return data
    placeholder = b'RELEASE_VERSION = "dev"\n'
    assert data.count(placeholder) == 1, name
    return data.replace(placeholder, f'RELEASE_VERSION = "{version}"\n'.encode())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def release_url(version, name):
    return f"https://github.com/uhs-robert/desertfox/releases/download/v{version}/{name}"


class FakeRelease:
    """Serves release files by URL and records each fetch. A missing URL fails like a download that cannot connect."""

    def __init__(self):
        self.files = {}
        self.fetched = []

    def publish(self, version, scripts):
        for name, data in scripts.items():
            self.files[release_url(version, name)] = data
            self.files[release_url(version, name) + ".sha256"] = f"{digest(data)}  {name}\n".encode()

    def __call__(self, url):
        self.fetched.append(url)
        if url not in self.files:
            raise host.UpdateError(f"could not download {url}: offline")
        return self.files[url]


class UpdateCase(unittest.TestCase):
    """An install of OLD under a temporary HOME, and a release of NEW."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="dfu")
        self.addCleanup(self.tmp.cleanup)
        root = self.tmp.name
        self.home = os.path.join(root, "home")
        self.runtime = os.path.join(root, "run")
        self.data_dir = os.path.join(self.home, ".local", "share", "desertfox")
        self.manifest_dir = os.path.join(self.home, ".mozilla", "native-messaging-hosts")
        os.makedirs(self.data_dir)
        os.makedirs(self.manifest_dir)
        os.makedirs(self.runtime, mode=0o700)
        self.paths = {name: os.path.join(self.data_dir, name) for name in SCRIPTS}
        self.manifests = [os.path.join(self.manifest_dir, f"{name}.json") for name in ("desertfox_bridge", "desertfox_host")]
        for name in SCRIPTS:
            self.write(self.paths[name], stamped(name, OLD), 0o755)
        for name, script in (("desertfox_bridge", "desertfox-bridge"), ("desertfox_host", "desertfox-host")):
            self.write(os.path.join(self.manifest_dir, f"{name}.json"), json.dumps({"name": name, "path": self.paths[script]}).encode(), 0o644)
        env = mock.patch.dict(os.environ, {"HOME": self.home, "XDG_RUNTIME_DIR": self.runtime})
        env.start()
        self.addCleanup(env.stop)
        self.new_scripts = {name: stamped(name, NEW) for name in SCRIPTS}
        self.release = FakeRelease()
        self.release.publish(NEW, self.new_scripts)

    def write(self, path, data, mode):
        with open(path, "wb") as file:
            file.write(data)
        os.chmod(path, mode)

    def read(self, path):
        with open(path, "rb") as file:
            return file.read()

    def request(self, version=NEW, **fields):
        hashes = {name: digest(data) for name, data in self.new_scripts.items()}
        return {"cmd": "self_update", "version": version, "sha256": hashes, **fields}

    def update(self, request=None, current=OLD):
        return host.self_update(request or self.request(), fetch=self.release, host_file=self.paths["desertfox-host"], current=current)

    def snapshot(self):
        """Every file under HOME by path, with its bytes, mode and inode. A rename gives a new inode even for equal bytes."""
        found = {}
        for base, _, names in os.walk(self.home):
            for name in names:
                path = os.path.join(base, name)
                info = os.lstat(path)
                found[path] = (self.read(path), stat.S_IMODE(info.st_mode), info.st_ino)
        return found

    def assert_refused(self, needle, request=None, current=OLD):
        before = self.snapshot()
        with self.assertRaises(host.UpdateError) as caught:
            self.update(request, current)
        self.assertIn(needle, str(caught.exception))
        self.assertEqual(self.snapshot(), before, "a refused update writes nothing")
        return caught.exception


class VersionTest(unittest.TestCase):
    def test_versions_sort_in_release_order(self):
        ordered = ["0.1.9", "0.1.10", "0.2.0-beta.1", "0.2.0-beta.2", "0.2.0-beta.10", "0.2.0", "1.0.0"]
        keys = [host.parse_version(text) for text in ordered]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(len(set(keys)), len(keys))
        self.assertEqual(host.parse_version("1.2.3"), host.parse_version("1.2.3"))

    def test_malformed_versions_parse_to_none(self):
        for text in ("", "1.2", "1.2.3.4", "v1.2.3", "1.2.3-beta", "1.2.3-rc.1", "1.2.3-beta.1.2", "1.2.3\n", " 1.2.3", "1.2.x",
                     "１.2.3", "1.2.3/../x", "1.2.3?a=b", "1234567.0.0", "main", "dev", None, 123, ["1.2.3"]):
            self.assertIsNone(host.parse_version(text), repr(text))


class RequestShapeTest(UpdateCase):
    def test_a_url_channel_or_path_field_is_refused_before_any_download(self):
        for field, value in (("url", "https://example.com/desertfox-host"), ("channel", "main"), ("path", "/tmp/x"), ("base_url", "https://example.com")):
            self.assert_refused("takes only version and sha256", self.request(**{field: value}))
        self.assertEqual(self.release.fetched, [])

    def test_a_malformed_version_is_refused_before_any_download(self):
        for version in ("1.2", "0.1.23/../../evil", "0.1.23?x", "https://example.com", None, 23):
            self.assert_refused("needs a version like", self.request(version=version))
        self.assertEqual(self.release.fetched, [])

    def test_hashes_must_name_exactly_the_three_scripts_in_lowercase_hex(self):
        good = self.request()["sha256"]
        for hashes in ({}, {**good, "install.sh": "0" * 64}, {k: v for k, v in good.items() if k != "desertfox"}, None, "x"):
            self.assert_refused("needs sha256 with exactly", self.request(sha256=hashes))
        for bad in ("0" * 63, "A" * 64, "g" * 64, 5):
            self.assert_refused("64 lowercase hex", self.request(sha256={**good, "desertfox-host": bad}))
        self.assertEqual(self.release.fetched, [])

    def test_the_verb_reaches_the_updater_through_handle(self):
        with self.assertRaises(host.UpdateError):
            host.handle({"cmd": "self_update", "version": NEW, "url": "https://example.com"})


class DowngradeTest(UpdateCase):
    def test_an_older_version_is_refused(self):
        self.release.publish("0.1.21", {name: stamped(name, "0.1.21") for name in SCRIPTS})
        self.assert_refused("refused to downgrade the host from 0.1.22 to 0.1.21", self.request(version="0.1.21"))
        self.assertEqual(self.release.fetched, [])

    def test_a_beta_of_the_running_version_is_older(self):
        self.assert_refused("refused to downgrade", self.request(version="0.1.22-beta.4"))

    def test_a_development_host_never_updates(self):
        self.assert_refused("development install", current="dev")

    def test_a_newer_host_on_disk_wins(self):
        # Another profile updated the files after this process started.
        self.write(self.paths["desertfox-host"], stamped("desertfox-host", "0.1.24"), 0o755)
        self.assert_refused("refused to downgrade the host from 0.1.24 to 0.1.23")
        self.assertEqual(self.release.fetched, [])

    def test_the_installed_files_already_matching_is_a_no_op(self):
        for name in SCRIPTS:
            self.write(self.paths[name], self.new_scripts[name], 0o755)
        before = self.snapshot()
        self.assertEqual(self.update(current=NEW), {"updated": False, "version": NEW, "replaced": []})
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.release.fetched, [])


class UpdateTest(UpdateCase):
    def test_an_update_replaces_exactly_the_five_paths(self):
        before = self.snapshot()
        result = self.update()
        after = self.snapshot()
        five = [self.paths["desertfox-bridge"], self.paths["desertfox-host"], self.paths["desertfox"], *self.manifests]
        self.assertEqual(result, {"updated": True, "version": NEW, "replaced": five})
        self.assertEqual(set(after), set(before), "no file is added or left behind, no .new among them")
        self.assertEqual(sorted(path for path in after if after[path] != before[path]), sorted(five))
        for name in SCRIPTS:
            self.assertEqual(after[self.paths[name]][:2], (self.new_scripts[name], 0o755))

    def test_manifests_match_what_install_sh_writes(self):
        self.update()
        with open(self.manifests[1]) as file:
            manifest = json.load(file)
        self.assertEqual(manifest, {
            "name": "desertfox_host", "description": "DesertFox config files and saved edits", "path": self.paths["desertfox-host"],
            "type": "stdio", "allowed_extensions": ["desertfox@uhs-robert"],
        })
        self.assertEqual(stat.S_IMODE(os.stat(self.manifests[1]).st_mode), 0o644)

    def test_every_url_comes_from_the_release_template(self):
        self.update()
        expected = [release_url(NEW, name) + suffix for name in SCRIPTS for suffix in ("", ".sha256")]
        self.assertEqual(self.release.fetched, expected)

    def test_a_beta_version_fetches_its_own_release(self):
        beta = "0.1.23-beta.2"
        self.new_scripts = {name: stamped(name, beta) for name in SCRIPTS}
        self.release.publish(beta, self.new_scripts)
        self.assertTrue(self.update(self.request(version=beta))["updated"])
        self.assertTrue(all(url.startswith(release_url(beta, "")) for url in self.release.fetched))


class VerifyTest(UpdateCase):
    def test_a_download_that_does_not_match_the_release_sha256_writes_nothing(self):
        self.release.files[release_url(NEW, "desertfox") + ".sha256"] = ("0" * 64 + "  desertfox\n").encode()
        self.assert_refused("does not match the release .sha256")

    def test_a_partial_download_writes_nothing(self):
        self.release.files[release_url(NEW, "desertfox-host")] = self.new_scripts["desertfox-host"][:1000]
        self.assert_refused("checksum mismatch for desertfox-host")

    def test_a_replaced_release_that_matches_its_own_sha256_fails_the_extension_hash(self):
        # A hijacked release can rewrite both the file and its .sha256, but not the signed extension.
        evil = {**self.new_scripts, "desertfox-bridge": self.new_scripts["desertfox-bridge"] + b"\nimport os\n"}
        self.release.publish(NEW, evil)
        self.assert_refused("does not match the hash the extension carries")

    def test_a_malformed_sha256_file_writes_nothing(self):
        for text in (b"", b"zz  desertfox-host\n", f"{digest(self.new_scripts['desertfox-host'])}  other\n".encode()):
            self.release.files[release_url(NEW, "desertfox-host") + ".sha256"] = text
            self.assert_refused("checksum file of desertfox-host is malformed")

    def test_a_file_that_is_not_a_host_script_writes_nothing(self):
        page = b"<html>not found</html>\n"
        self.new_scripts["desertfox"] = page
        self.release.publish(NEW, self.new_scripts)
        self.assert_refused("the downloaded desertfox is not a host script")

    def test_a_host_stamped_with_another_version_writes_nothing(self):
        self.new_scripts["desertfox-host"] = stamped("desertfox-host", "0.1.99")
        self.release.publish(NEW, self.new_scripts)
        self.assert_refused("says version '0.1.99', not 0.1.23")

    def test_offline_writes_nothing(self):
        self.release.files.clear()
        self.assert_refused("offline")

    def test_a_download_failing_on_the_last_file_writes_nothing(self):
        del self.release.files[release_url(NEW, "desertfox") + ".sha256"]
        self.assert_refused("offline")


class LockTest(UpdateCase):
    def test_a_second_updater_gets_update_running(self):
        lock_path = os.path.join(self.runtime, "desertfox", "update.lock")
        os.makedirs(os.path.dirname(lock_path), mode=0o700)
        holder = os.open(lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        self.addCleanup(os.close, holder)
        fcntl.flock(holder, fcntl.LOCK_EX)
        self.assert_refused("update running")
        self.assertEqual(self.release.fetched, [])

    def test_the_lock_is_released_after_an_update_and_after_a_failure(self):
        self.release.files.clear()
        with self.assertRaises(host.UpdateError):
            self.update()
        self.release.publish(NEW, self.new_scripts)
        self.assertTrue(self.update()["updated"])
        os.close(host.take_update_lock())

    def test_no_runtime_dir_refuses(self):
        with mock.patch.dict(os.environ, {"XDG_RUNTIME_DIR": "relative"}):
            self.assert_refused("XDG_RUNTIME_DIR")


class ReplaceTest(UpdateCase):
    def test_a_failed_write_of_a_staged_file_replaces_nothing(self):
        real = host.write_new_file
        calls = []

        def fail_on_fourth(path, data, mode):
            calls.append(path)
            if len(calls) == 4:
                raise OSError(28, "No space left on device", path + ".new")
            return real(path, data, mode)

        with mock.patch.object(host, "write_new_file", fail_on_fourth):
            error = self.assert_refused("Nothing was replaced")
        self.assertIn("No space left", str(error))

    def test_a_failed_rename_leaves_the_old_file_and_names_what_changed(self):
        real = os.replace
        calls = []

        def fail_on_second(source, target):
            calls.append(target)
            if len(calls) == 2:
                raise OSError(5, "Input/output error")
            return real(source, target)

        with mock.patch.object(host.os, "replace", fail_on_second):
            with self.assertRaises(host.UpdateError) as caught:
                self.update()
        message = str(caught.exception)
        self.assertIn(f"cannot replace {self.paths['desertfox-host']}", message)
        self.assertIn(f"Replaced before the failure: {self.paths['desertfox-bridge']}", message)
        self.assertEqual(self.read(self.paths["desertfox-host"]), stamped("desertfox-host", OLD))
        self.assertEqual(self.read(self.paths["desertfox"]), stamped("desertfox", OLD))
        leftovers = [name for base in (self.data_dir, self.manifest_dir) for name in os.listdir(base) if name.endswith(".new")]
        self.assertEqual(leftovers, [])

    def test_a_half_done_update_is_finished_by_the_next_one(self):
        self.write(self.paths["desertfox-bridge"], self.new_scripts["desertfox-bridge"], 0o755)
        self.assertTrue(self.update()["updated"])
        self.assertEqual(self.read(self.paths["desertfox"]), self.new_scripts["desertfox"])

    def test_a_stale_new_file_or_link_is_replaced_not_followed(self):
        target = os.path.join(self.tmp.name, "outside")
        self.write(target, b"keep", 0o644)
        os.symlink(target, self.paths["desertfox-host"] + ".new")
        self.update()
        self.assertEqual(self.read(target), b"keep")
        self.assertEqual(self.read(self.paths["desertfox-host"]), self.new_scripts["desertfox-host"])


class RunningBridgeTest(UpdateCase):
    def test_a_running_bridge_keeps_working_after_its_file_is_replaced(self):
        env = dict(os.environ, XDG_RUNTIME_DIR=self.runtime, XDG_CACHE_HOME=os.path.join(self.tmp.name, "cache"))
        bridge = subprocess.Popen([sys.executable, self.paths["desertfox-bridge"]], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
        self.addCleanup(lambda: (bridge.kill(), bridge.wait(), bridge.stdin.close(), bridge.stdout.close()))
        length = int.from_bytes(bridge.stdout.read(4), sys.byteorder)
        self.assertEqual(json.loads(bridge.stdout.read(length))["release_version"], OLD)
        self.assertTrue(self.update()["updated"])
        self.assertEqual(self.read(self.paths["desertfox-bridge"]), self.new_scripts["desertfox-bridge"])
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(5)
            client.connect(os.path.join(self.runtime, "desertfox", "bridge.sock"))
            client.sendall(b'{"verb": "ping"}\n')
            self.assertEqual(json.loads(client.makefile().readline()), {"ok": True})
        self.assertIsNone(bridge.poll())


class FetchTest(unittest.TestCase):
    """The real fetch, with the opener faked so no request leaves the machine."""

    def fake_response(self, chunks, final_url="https://objects.example/x"):
        response = mock.MagicMock()
        response.__enter__.return_value = response
        response.geturl.return_value = final_url
        response.read.side_effect = list(chunks) + [b""]
        opener = mock.MagicMock()
        opener.open.return_value = response
        return mock.patch.object(host, "https_opener", return_value=opener)

    def test_a_url_that_is_not_https_is_refused(self):
        for url in ("http://github.com/x", "file:///etc/passwd", "ftp://x/y", "data:,x"):
            with self.assertRaises(host.UpdateError):
                host.fetch_release_file(url)

    def test_the_opener_has_no_handler_for_other_schemes(self):
        for url in ("http://127.0.0.1:9/x", "file:///etc/hostname", "data:,x"):
            with self.assertRaises(urllib.error.URLError):
                host.https_opener().open(url, timeout=1)

    def test_a_redirect_to_http_is_refused(self):
        handler = host.HttpsOnlyRedirects()
        request = urllib.request.Request("https://github.com/x")
        with self.assertRaises(host.UpdateError) as caught:
            handler.redirect_request(request, io.BytesIO(), 302, "Found", email.message.Message(), "http://objects.example/x")
        self.assertIn("not https", str(caught.exception))

    def test_redirects_stop_after_the_cap(self):
        handler = host.HttpsOnlyRedirects()
        handler.parent = mock.MagicMock()
        request = urllib.request.Request("https://github.com/x")
        request.redirect_dict = {f"https://hop.example/{index}": 1 for index in range(host.UPDATE_MAX_REDIRECTS)}
        headers = email.message.Message()
        headers["location"] = "https://hop.example/next"
        with self.assertRaises(urllib.error.HTTPError) as caught:
            handler.http_error_302(request, io.BytesIO(), 302, "Found", headers)
        caught.exception.close()
        handler.parent.open.assert_not_called()

    def test_a_final_url_that_is_not_https_is_refused(self):
        with self.fake_response([b"#!"], final_url="http://objects.example/x"):
            with self.assertRaises(host.UpdateError):
                host.fetch_release_file("https://github.com/x")

    def test_a_file_over_the_size_cap_is_refused(self):
        with self.fake_response([b"x" * (64 * 1024)] * 17):
            with self.assertRaises(host.UpdateError) as caught:
                host.fetch_release_file("https://github.com/x")
        self.assertIn("byte limit", str(caught.exception))

    def test_a_file_at_the_size_cap_is_accepted(self):
        with self.fake_response([b"x" * (64 * 1024)] * 16):
            self.assertEqual(len(host.fetch_release_file("https://github.com/x")), host.UPDATE_MAX_FILE_BYTES)

    def test_a_slow_drip_stops_at_the_deadline(self):
        clock = iter([0, 5, 10, 15, 25])
        with self.fake_response([b"x"] * 10), mock.patch.object(host.time, "monotonic", lambda: next(clock)):
            with self.assertRaises(host.UpdateError) as caught:
                host.fetch_release_file("https://github.com/x")
        self.assertIn("timed out", str(caught.exception))

    def test_the_timeout_is_passed_to_the_connection(self):
        with self.fake_response([b"ok"]):
            host.fetch_release_file("https://github.com/x")
            host.https_opener.return_value.open.assert_called_once_with("https://github.com/x", timeout=host.UPDATE_TIMEOUT_S)

    def test_network_errors_become_update_errors(self):
        opener = mock.MagicMock()
        opener.open.side_effect = urllib.error.URLError("no route")
        with mock.patch.object(host, "https_opener", return_value=opener):
            with self.assertRaises(host.UpdateError) as caught:
                host.fetch_release_file("https://github.com/x")
        self.assertIn("no route", str(caught.exception))


class SourceTest(unittest.TestCase):
    def test_the_repo_hosts_carry_the_dev_placeholder(self):
        for name in ("desertfox-host", "desertfox-bridge"):
            self.assertEqual(repo_bytes(name).count(b'\nRELEASE_VERSION = "dev"\n'), 1, name)
        self.assertEqual(host.RELEASE_VERSION, "dev")

    def test_the_updater_runs_no_shell_or_subprocess(self):
        source = repo_bytes("desertfox-host").decode()
        for needle in ("subprocess", "os.system", "os.popen", "os.exec", "shell=", "eval(", "exec("):
            self.assertNotIn(needle, source)

    def test_every_reply_carries_the_release_version(self):
        for request in ({"cmd": "read_config"}, {"cmd": "nope"}):
            data = json.dumps(request).encode()
            out = io.BytesIO()
            host.serve(host.Channel(io.BytesIO(len(data).to_bytes(4, sys.byteorder) + data), out))
            self.assertEqual(json.loads(out.getvalue()[4:])["release_version"], "dev")


# Runs the installed host file as Firefox would find it, so its paths come from where it sits and from HOME.
DRIVER = """
import hashlib, importlib.machinery, importlib.util, json, os, sys
loader = importlib.machinery.SourceFileLoader("installed_host", sys.argv[1])
spec = importlib.util.spec_from_loader("installed_host", loader)
module = importlib.util.module_from_spec(spec)
loader.exec_module(module)
served = sys.argv[2]
def fetch(url):
    path = os.path.join(served, hashlib.sha256(url.encode()).hexdigest())
    if not os.path.exists(path):
        raise module.UpdateError("offline")
    with open(path, "rb") as file:
        return file.read()
print(json.dumps(module.self_update(json.loads(sys.argv[3]), fetch=fetch)))
"""


class TemporaryHomeTest(UpdateCase):
    def test_the_installed_host_writes_only_the_five_paths_under_home(self):
        served = os.path.join(self.tmp.name, "served")
        os.makedirs(served)
        for url, data in self.release.files.items():
            self.write(os.path.join(served, digest(url.encode())), data, 0o644)
        driver = os.path.join(self.tmp.name, "driver.py")
        self.write(driver, DRIVER.encode(), 0o644)
        before = self.snapshot()
        env = {"PATH": os.environ.get("PATH", ""), "HOME": self.home, "XDG_RUNTIME_DIR": self.runtime}
        done = subprocess.run([sys.executable, "-I", "-B", driver, self.paths["desertfox-host"], served, json.dumps(self.request())], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue(json.loads(done.stdout)["updated"])
        after = self.snapshot()
        self.assertEqual(set(after), set(before))
        changed = sorted(path for path in after if after[path] != before[path])
        self.assertEqual(changed, sorted([*self.paths.values(), *self.manifests]))


if __name__ == "__main__":
    unittest.main()
