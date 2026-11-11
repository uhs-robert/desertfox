"""Runs install.sh against a temporary HOME with a stubbed curl. Nothing touches the real home folder or the network."""
import hashlib
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest

from host_under_test import HOST_DIR, HOST_PATH

BRIDGE_PATH = os.path.join(HOST_DIR, "desertfox-bridge")
CLI_PATH = os.path.join(HOST_DIR, "desertfox")

INSTALL = os.path.join(HOST_DIR, "install.sh")
RELEASE_BASE = "https://github.com/uhs-robert/desertfox/releases/download/v0.1.5"
MAIN_BASE = "https://raw.githubusercontent.com/uhs-robert/desertfox/main/host"

# The stub answers each URL from a route file ("url<TAB>path" per line), logs every URL, and fails like `curl -f` for the rest.
CURL_STUB = """#!/bin/sh
url=""; out=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
echo "$url" >> "$STUB_LOG"
path=$(awk -F'\\t' -v u="$url" '$1 == u { print $2 }' "$STUB_ROUTES")
[ -n "$path" ] || exit 22
cp "$path" "$out"
"""

TOOLS = ["sh", "mktemp", "head", "grep", "cp", "chmod", "mv", "rm", "mkdir", "awk", "cat", "env", "dirname", "tr", "sed", "ln"]


def real_tool(name):
    path = shutil.which(name)
    if path is None:
        raise unittest.SkipTest(f"{name} not found")
    return path


class InstallCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = self.tmp.name
        self.home = os.path.join(root, "home")
        self.bin = os.path.join(root, "bin")
        self.served = os.path.join(root, "served")
        for directory in (self.home, self.bin, self.served):
            os.makedirs(directory)
        self.log = os.path.join(root, "curl.log")
        self.routes = os.path.join(root, "routes")
        open(self.log, "w").close()
        open(self.routes, "w").close()
        for name in TOOLS:
            os.symlink(real_tool(name), os.path.join(self.bin, name))
        os.symlink(real_tool("python3"), os.path.join(self.bin, "python3"))
        self.write_stub("curl", CURL_STUB)
        with open(HOST_PATH, "rb") as file:
            self.host_bytes = file.read()
        with open(BRIDGE_PATH, "rb") as file:
            self.bridge_bytes = file.read()
        with open(CLI_PATH, "rb") as file:
            self.cli_bytes = file.read()

    def write_stub(self, name, text):
        path = os.path.join(self.bin, name)
        if os.path.lexists(path):
            os.unlink(path)
        with open(path, "w") as file:
            file.write(text)
        os.chmod(path, 0o755)

    def serve(self, url, content):
        path = os.path.join(self.served, hashlib.sha256(url.encode()).hexdigest())
        with open(path, "wb") as file:
            file.write(content)
        # A second serve of the same URL replaces the first.
        with open(self.routes) as file:
            kept = [line for line in file if not line.startswith(f"{url}\t")]
        with open(self.routes, "w") as file:
            file.writelines(kept)
            file.write(f"{url}\t{path}\n")

    def serve_release(self, host_bytes=None, checksum=None):
        host_bytes = self.host_bytes if host_bytes is None else host_bytes
        self.serve(f"{RELEASE_BASE}/desertfox-host", host_bytes)
        digest = hashlib.sha256(self.host_bytes).hexdigest() if checksum is None else checksum
        self.serve(f"{RELEASE_BASE}/desertfox-host.sha256", f"{digest}  desertfox-host\n".encode())
        self.serve(f"{RELEASE_BASE}/desertfox-bridge", self.bridge_bytes)
        self.serve(f"{RELEASE_BASE}/desertfox-bridge.sha256", f"{hashlib.sha256(self.bridge_bytes).hexdigest()}  desertfox-bridge\n".encode())
        self.serve(f"{RELEASE_BASE}/desertfox", self.cli_bytes)
        self.serve(f"{RELEASE_BASE}/desertfox.sha256", f"{hashlib.sha256(self.cli_bytes).hexdigest()}  desertfox\n".encode())

    def serve_main(self, bridge_bytes=None):
        self.serve(f"{MAIN_BASE}/desertfox-host", self.host_bytes)
        self.serve(f"{MAIN_BASE}/desertfox-bridge", self.bridge_bytes if bridge_bytes is None else bridge_bytes)
        self.serve(f"{MAIN_BASE}/desertfox", self.cli_bytes)

    def run_install(self, *args):
        env = {"PATH": self.bin, "HOME": self.home, "STUB_LOG": self.log, "STUB_ROUTES": self.routes, "TMPDIR": self.tmp.name}
        return subprocess.run([os.path.join(self.bin, "sh"), INSTALL, *args], env=env, capture_output=True, text=True, timeout=60)

    def curl_urls(self):
        with open(self.log) as file:
            return file.read().split()

    @property
    def host_path(self):
        return os.path.join(self.home, ".local", "share", "desertfox", "desertfox-host")

    @property
    def manifest_path(self):
        return os.path.join(self.home, ".mozilla", "native-messaging-hosts", "desertfox_host.json")

    @property
    def bridge_path(self):
        return os.path.join(self.home, ".local", "share", "desertfox", "desertfox-bridge")

    @property
    def bridge_manifest_path(self):
        return os.path.join(self.home, ".mozilla", "native-messaging-hosts", "desertfox_bridge.json")

    def home_files(self):
        found = []
        for base, _, names in os.walk(self.home):
            found.extend(os.path.join(base, name) for name in names)
        return found

    def assert_nothing_installed(self):
        self.assertEqual(self.home_files(), [])


class ReleaseChannelTest(InstallCase):
    def test_version_installs_from_the_release_and_writes_the_manifest(self):
        self.serve_release()
        done = self.run_install("0.1.5")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.curl_urls(), [f"{RELEASE_BASE}/{name}" for name in ("desertfox-host", "desertfox-host.sha256", "desertfox-bridge", "desertfox-bridge.sha256", "desertfox", "desertfox.sha256")])
        with open(self.host_path, "rb") as file:
            self.assertEqual(file.read(), self.host_bytes)
        self.assertTrue(os.stat(self.host_path).st_mode & stat.S_IXUSR)
        with open(self.manifest_path) as file:
            manifest = json.load(file)
        self.assertEqual(manifest["name"], "desertfox_host")
        self.assertEqual(manifest["path"], self.host_path)
        self.assertEqual(manifest["type"], "stdio")
        self.assertEqual(manifest["allowed_extensions"], ["desertfox@uhs-robert"])

    def test_the_bridge_host_is_installed_beside_the_config_host(self):
        self.serve_release()
        self.assertEqual(self.run_install("0.1.5").returncode, 0)
        with open(self.bridge_path, "rb") as file:
            self.assertEqual(file.read(), self.bridge_bytes)
        self.assertTrue(os.stat(self.bridge_path).st_mode & stat.S_IXUSR)
        with open(self.bridge_manifest_path) as file:
            manifest = json.load(file)
        self.assertEqual(manifest["name"], "desertfox_bridge")
        self.assertEqual(manifest["path"], self.bridge_path)
        self.assertEqual(manifest["type"], "stdio")
        self.assertEqual(manifest["allowed_extensions"], ["desertfox@uhs-robert"])

    def test_the_command_line_is_installed_and_linked_into_local_bin(self):
        self.serve_release()
        self.assertEqual(self.run_install("0.1.5").returncode, 0)
        cli_path = os.path.join(self.home, ".local", "share", "desertfox", "desertfox")
        with open(cli_path, "rb") as file:
            self.assertEqual(file.read(), self.cli_bytes)
        self.assertTrue(os.stat(cli_path).st_mode & stat.S_IXUSR)
        link_path = os.path.join(self.home, ".local", "bin", "desertfox")
        self.assertEqual(os.readlink(link_path), cli_path)
        self.assertEqual(self.run_install("0.1.5").returncode, 0, "a rerun replaces the link")

    def test_a_file_already_at_the_link_path_is_left_alone(self):
        self.serve_release()
        link_path = os.path.join(self.home, ".local", "bin", "desertfox")
        os.makedirs(os.path.dirname(link_path))
        with open(link_path, "w") as file:
            file.write("mine")
        done = self.run_install("0.1.5")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("Left %s alone" % link_path, done.stdout)
        with open(link_path) as file:
            self.assertEqual(file.read(), "mine")

    def test_a_bad_command_line_checksum_installs_nothing(self):
        self.serve_release()
        self.serve(f"{RELEASE_BASE}/desertfox.sha256", ("0" * 64 + "  desertfox\n").encode())
        done = self.run_install("0.1.5")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("checksum mismatch for desertfox ", done.stderr)
        self.assert_nothing_installed()

    def test_a_bad_bridge_checksum_installs_neither_host(self):
        self.serve_release()
        self.serve(f"{RELEASE_BASE}/desertfox-bridge.sha256", ("0" * 64 + "  desertfox-bridge\n").encode())
        done = self.run_install("0.1.5")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("checksum mismatch for desertfox-bridge", done.stderr)
        self.assert_nothing_installed()

    def test_checksum_mismatch_refuses_and_installs_nothing(self):
        self.serve_release(checksum="0" * 64)
        done = self.run_install("0.1.5")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("checksum mismatch", done.stderr)
        self.assert_nothing_installed()

    def test_tampered_host_with_the_real_checksum_file_is_refused(self):
        self.serve_release(host_bytes=self.host_bytes + b"\nimport os\n")
        done = self.run_install("0.1.5")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("checksum mismatch", done.stderr)
        self.assert_nothing_installed()

    def test_mismatch_leaves_an_earlier_install_untouched(self):
        self.serve_release()
        self.assertEqual(self.run_install("0.1.5").returncode, 0)
        self.serve_release(checksum="f" * 64)
        self.assertNotEqual(self.run_install("0.1.5").returncode, 0)
        with open(self.host_path, "rb") as file:
            self.assertEqual(file.read(), self.host_bytes)

    def test_empty_checksum_file_refuses(self):
        self.serve(f"{RELEASE_BASE}/desertfox-host", self.host_bytes)
        self.serve(f"{RELEASE_BASE}/desertfox-host.sha256", b"")
        done = self.run_install("0.1.5")
        self.assertNotEqual(done.returncode, 0)
        self.assert_nothing_installed()

    def test_missing_release_asset_reports_the_url(self):
        done = self.run_install("0.1.5")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(f"{RELEASE_BASE}/desertfox-host", done.stderr)
        self.assert_nothing_installed()

    def test_rerun_is_idempotent(self):
        self.serve_release()
        self.assertEqual(self.run_install("0.1.5").returncode, 0)
        self.assertEqual(self.run_install("0.1.5").returncode, 0)
        self.assertEqual(len(self.home_files()), 6)


class MainChannelTest(InstallCase):
    def test_main_fetches_from_the_main_branch_with_no_checksum(self):
        self.serve_main()
        done = self.run_install("main")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.curl_urls(), [f"{MAIN_BASE}/{name}" for name in ("desertfox-host", "desertfox-bridge", "desertfox")])
        self.assertTrue(os.path.isfile(self.manifest_path))
        self.assertTrue(os.path.isfile(self.bridge_manifest_path))

    def test_channel_flag_overrides_a_version(self):
        self.serve_main()
        done = self.run_install("0.1.5", "--channel", "main")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(self.curl_urls(), [f"{MAIN_BASE}/{name}" for name in ("desertfox-host", "desertfox-bridge", "desertfox")])

    def test_a_page_that_is_not_the_host_is_refused(self):
        self.serve_main(bridge_bytes=b"<html>404</html>\n")
        done = self.run_install("main")
        self.assertNotEqual(done.returncode, 0)
        self.assert_nothing_installed()


class DataFolderTest(InstallCase):
    def run_with_xdg(self, value):
        self.serve_main()
        env = {"PATH": self.bin, "HOME": self.home, "STUB_LOG": self.log, "STUB_ROUTES": self.routes, "TMPDIR": self.tmp.name, "XDG_DATA_HOME": value}
        return subprocess.run([os.path.join(self.bin, "sh"), INSTALL, "main"], env=env, capture_output=True, text=True, timeout=60)

    def test_relative_xdg_data_home_is_ignored(self):
        done = self.run_with_xdg("relative/data")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue(os.path.isfile(self.host_path))
        self.assertFalse(os.path.exists(os.path.join(self.home, "relative")))

    def test_absolute_xdg_data_home_is_used(self):
        data_home = os.path.join(self.tmp.name, "xdg_data")
        done = self.run_with_xdg(data_home)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertTrue(os.path.isfile(os.path.join(data_home, "desertfox", "desertfox-host")))
        with open(self.manifest_path) as file:
            self.assertEqual(json.load(file)["path"], os.path.join(data_home, "desertfox", "desertfox-host"))


class TruncatedScriptTest(InstallCase):
    def test_a_script_cut_before_the_last_line_installs_nothing(self):
        with open(INSTALL) as file:
            lines = file.read().splitlines()
        self.assertEqual(lines[-1], 'main "$@"')
        cut = os.path.join(self.tmp.name, "cut.sh")
        with open(cut, "w") as file:
            file.write("\n".join(lines[:-1]))
        self.serve_main()
        env = {"PATH": self.bin, "HOME": self.home, "STUB_LOG": self.log, "STUB_ROUTES": self.routes, "TMPDIR": self.tmp.name}
        done = subprocess.run([os.path.join(self.bin, "sh"), cut, "main"], env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0)
        self.assertEqual(self.curl_urls(), [])
        self.assert_nothing_installed()


class ArgumentAndPythonTest(InstallCase):
    def test_bad_arguments_stop_before_any_fetch(self):
        for args in ((), ("1.2",), ("0.1.5; rm -rf",), ("--bogus", "main"), ("--channel", "beta", "0.1.5"), ("0.1.5", "0.1.6")):
            done = self.run_install(*args)
            self.assertNotEqual(done.returncode, 0, args)
        self.assertEqual(self.curl_urls(), [])
        self.assert_nothing_installed()

    def test_without_python3_it_prints_an_error_and_stops(self):
        os.unlink(os.path.join(self.bin, "python3"))
        self.serve_main()
        done = self.run_install("main")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("python3 3.9 or newer is required", done.stderr)
        self.assertEqual(self.curl_urls(), [])
        self.assert_nothing_installed()

    def test_python_3_8_is_refused(self):
        os.unlink(os.path.join(self.bin, "python3"))
        self.write_stub("python3", "#!/bin/sh\ncase \"$*\" in *'sys.version_info >='*) exit 1 ;; *) echo 3.8 ;; esac\n")
        self.serve_main()
        done = self.run_install("main")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("3.8", done.stderr)
        self.assert_nothing_installed()


GH_STUB = """#!/bin/sh
echo "$@" >> "$GH_LOG"
for arg in "$@"; do
  [ -f "$arg" ] && cp "$arg" "$GH_OUT/"
done
exit 0
"""


class ReleaseStepTest(InstallCase):
    """`just release_publish` against a stubbed gh, then the install script against the assets it would upload."""

    def setUp(self):
        super().setUp()
        for tool in ("just", "jq", "sha256sum", "bash", "cat", "cp", "mktemp", "rm"):
            if shutil.which(tool) is None:
                self.skipTest(f"{tool} not found")
        self.gh_out = os.path.join(self.tmp.name, "gh_out")
        os.makedirs(self.gh_out)
        self.gh_log = os.path.join(self.tmp.name, "gh.log")
        self.stub_bin = os.path.join(self.tmp.name, "stub_bin")
        os.makedirs(self.stub_bin)
        gh = os.path.join(self.stub_bin, "gh")
        with open(gh, "w") as file:
            file.write(GH_STUB)
        os.chmod(gh, 0o755)

    def publish(self, **extra_env):
        env = dict(os.environ, PATH=self.stub_bin + os.pathsep + os.environ["PATH"], GH_LOG=self.gh_log, GH_OUT=self.gh_out, **extra_env)
        return subprocess.run(["just", "release_publish"], cwd=os.path.dirname(HOST_DIR), env=env, capture_output=True, text=True, timeout=60)

    def test_publish_uploads_the_hosts_the_command_line_checksums_and_script_for_the_package_version(self):
        done = self.publish()
        self.assertEqual(done.returncode, 0, done.stderr)
        with open(os.path.join(os.path.dirname(HOST_DIR), "package.json")) as file:
            version = json.load(file)["version"]
        with open(self.gh_log) as file:
            logged = file.read()
        self.assertTrue(logged.startswith(f"release create v{version} "), logged)
        self.assertEqual(sorted(os.listdir(self.gh_out)), ["desertfox", "desertfox-bridge", "desertfox-bridge.sha256", "desertfox-host", "desertfox-host.sha256", "desertfox.sha256", "install.sh"])

    def test_uploaded_assets_install_through_the_script(self):
        self.assertEqual(self.publish().returncode, 0)
        base = RELEASE_BASE
        for name in ("desertfox-host", "desertfox-host.sha256", "desertfox-bridge", "desertfox-bridge.sha256", "desertfox", "desertfox.sha256"):
            with open(os.path.join(self.gh_out, name), "rb") as file:
                self.serve(f"{base}/{name}", file.read())
        done = self.run_install("0.1.5")
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_release_targets_the_head_commit(self):
        done = self.publish()
        self.assertEqual(done.returncode, 0, done.stderr)
        head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=os.path.dirname(HOST_DIR), capture_output=True, text=True).stdout.strip()
        with open(self.gh_log) as file:
            self.assertIn(f"--target {head}", file.read())

    def test_bump_is_committed_and_pushed_before_the_tag(self):
        """Runs the commit and push step in a throwaway repo with a local bare remote."""
        repo_root = os.path.dirname(HOST_DIR)
        work = os.path.join(self.tmp.name, "work")
        remote = os.path.join(self.tmp.name, "remote.git")
        os.makedirs(os.path.join(work, "src"))
        shutil.copy(os.path.join(repo_root, "justfile"), work)
        # The user's global git config (a signing key, hooks) must not decide this test.
        git_env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@e", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@e")

        def git(*args, cwd=work):
            return subprocess.run(["git", *args], cwd=cwd, env=git_env, capture_output=True, text=True, check=True).stdout.strip()

        git("init", "-q", "--bare", remote, cwd=self.tmp.name)
        git("init", "-q", "-b", "release-branch")
        git("remote", "add", "origin", remote)
        for name, text in (("package.json", '{"version": "0.0.1"}'), ("package-lock.json", "{}"), ("src/manifest.json", "{}"), ("other.txt", "keep")):
            with open(os.path.join(work, name), "w") as file:
                file.write(text)
        git("add", "-A")
        git("commit", "-q", "-m", "base")
        with open(os.path.join(work, "package.json"), "w") as file:
            file.write('{"version": "0.0.2"}')
        with open(os.path.join(work, "other.txt"), "w") as file:
            file.write("unrelated edit")
        done = subprocess.run(["just", "release_commit_push"], cwd=work, env=git_env, capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(git("log", "-1", "--format=%s"), "chore(release): bump version to 0.0.2")
        self.assertEqual(git("rev-parse", "HEAD"), git("rev-parse", "release-branch", cwd=remote))
        self.assertEqual(git("status", "--porcelain"), "M other.txt")

    def test_failed_push_names_the_recovery_recipes_and_a_rerun_does_not_recommit(self):
        repo_root = os.path.dirname(HOST_DIR)
        work = os.path.join(self.tmp.name, "work2")
        os.makedirs(os.path.join(work, "src"))
        shutil.copy(os.path.join(repo_root, "justfile"), work)
        env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_SYSTEM=os.devnull, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@e", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@e")

        def git(*args):
            return subprocess.run(["git", *args], cwd=work, env=env, capture_output=True, text=True, check=True).stdout.strip()

        git("init", "-q", "-b", "release-branch")
        git("remote", "add", "origin", os.path.join(self.tmp.name, "missing.git"))
        for name in ("package.json", "package-lock.json", "src/manifest.json"):
            with open(os.path.join(work, name), "w") as file:
                file.write('{"version": "0.0.1"}')
        git("add", "-A")
        git("commit", "-q", "-m", "base")
        with open(os.path.join(work, "package.json"), "w") as file:
            file.write('{"version": "0.0.2"}')
        done = subprocess.run(["just", "release_commit_push"], cwd=work, env=env, capture_output=True, text=True, timeout=60)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("bump commit is local", done.stderr)
        self.assertIn("just release_publish", done.stderr)
        self.assertEqual(git("log", "-1", "--format=%s"), "chore(release): bump version to 0.0.2")
        again = subprocess.run(["just", "release_commit_push"], cwd=work, env=env, capture_output=True, text=True, timeout=60)
        self.assertIn("bump commit is local", again.stderr)
        self.assertEqual(git("rev-list", "--count", "HEAD"), "2")

    def test_dry_run_creates_nothing(self):
        done = self.publish(RELEASE_DRY_RUN="1")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("dry run: gh release create", done.stdout)
        self.assertFalse(os.path.exists(self.gh_log))


if __name__ == "__main__":
    unittest.main()
