"""Drives `just release` in a throwaway repo with a bare remote and stubbed gh, web-ext and npm build, so no key, network or real release is involved. Every stub and the remote append to one call log, which gives the order of the public steps. A missing tool fails the test, because a skipped release test would hide a broken release."""
import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest

from host_under_test import HOST_DIR

REPO = os.path.abspath(os.path.join(HOST_DIR, ".."))
NOTES = "# Next release\n\nA **short** intro.\n\n- A fix\n\n## \U0001F4E6 Install\n\nRun the command.\n"
RESET_NOTES = "# Next release\n\n"
GIT_ENV = {
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_SYSTEM": os.devnull,
    "GIT_AUTHOR_NAME": "t",
    "GIT_AUTHOR_EMAIL": "t@e",
    "GIT_COMMITTER_NAME": "t",
    "GIT_COMMITTER_EMAIL": "t@e",
}
GH_STUB = """#!/bin/sh
echo "gh $*" >> "$CALL_LOG"
exit 0
"""
# Records what the listed submit would send: the notes of the metadata file and the state of RELEASE.md at that moment.
WEB_EXT_STUB = """#!/bin/sh
echo "web-ext $*" >> "$CALL_LOG"
if [ "$1" = "sign" ]; then
  prev=""
  for arg in "$@"; do
    if [ "$prev" = "--amo-metadata" ]; then jq -r '.version.release_notes["en-US"]' "$arg" > "$CALL_LOG.submitted_notes"; fi
    prev="$arg"
  done
  cp "$RELEASE_NOTES_FILE" "$CALL_LOG.release_md_at_submit"
  [ -n "${WEB_EXT_FAIL:-}" ] && exit 1
fi
exit 0
"""
PRE_RECEIVE = """#!/bin/sh
echo "git push" >> "%s"
"""


def write_executable(path, text):
    with open(path, "w") as handle:
        handle.write(text)
    os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)


class ReleaseFlowCase(unittest.TestCase):
    def setUp(self):
        for tool in ("just", "jq", "git", "node", "npm"):
            if shutil.which(tool) is None:
                self.fail(f"{tool} is required to test the release flow and was not found on PATH")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.log = os.path.join(self.tmp.name, "calls.log")
        self.release_md = os.path.join(self.tmp.name, "RELEASE.md")
        with open(self.release_md, "w") as handle:
            handle.write(NOTES)
        self.stubs = os.path.join(self.tmp.name, "stubs")
        os.makedirs(self.stubs)
        write_executable(os.path.join(self.stubs, "gh"), GH_STUB)
        self.work = self.make_work_dir()

    def git(self, *args, cwd=None):
        return subprocess.run(["git", *args], cwd=cwd or self.work, env=dict(os.environ, **GIT_ENV), capture_output=True, text=True, check=True)

    def make_work_dir(self):
        work = os.path.join(self.tmp.name, "work")
        for folder in ("host", "tools", "amo", "src", "node_modules/web-ext", "node_modules/.bin"):
            os.makedirs(os.path.join(work, folder))
        shutil.copy(os.path.join(REPO, "justfile"), work)
        for name in ("release_stamp.mjs", "release_notes.mjs", "amo_notes.mjs", "amo_key.sh"):
            shutil.copy(os.path.join(REPO, "tools", name), os.path.join(work, "tools"))
        shutil.copy(os.path.join(REPO, "amo", "metadata.json"), os.path.join(work, "amo"))
        for name in ("desertfox-host", "desertfox-bridge", "desertfox", "install.sh"):
            shutil.copy(os.path.join(HOST_DIR, name), os.path.join(work, "host"))
        files = {
            "package.json": {"version": "1.0.1", "devDependencies": {"web-ext": "10.0.0"}, "scripts": {"build": 'mkdir -p dist && cp "$RELEASE_ASSETS_DIR/host_sha256.json" dist/ && echo \'{"version": "x"}\' > dist/manifest.json'}},
            "package-lock.json": {"version": "1.0.1", "packages": {"": {"version": "1.0.1"}}},
            "src/manifest.json": {"version": "1.0.1"},
            "node_modules/web-ext/package.json": {"version": "10.0.0"},
        }
        for name, content in files.items():
            with open(os.path.join(work, name), "w") as handle:
                json.dump(content, handle)
        write_executable(os.path.join(work, "node_modules/.bin/web-ext"), WEB_EXT_STUB)
        with open(os.path.join(work, ".gitignore"), "w") as handle:
            handle.write("node_modules/\ndist/\nrelease-assets/\nweb-ext-artifacts/\n")
        remote = os.path.join(self.tmp.name, "remote.git")
        subprocess.run(["git", "init", "-q", "--bare", remote], check=True, env=dict(os.environ, **GIT_ENV))
        write_executable(os.path.join(remote, "hooks", "pre-receive"), PRE_RECEIVE % self.log)
        self.git("init", "-q", "-b", "release", cwd=work)
        self.git("remote", "add", "origin", remote, cwd=work)
        self.git("add", "-A", cwd=work)
        self.git("commit", "-q", "--no-gpg-sign", "-m", "base", cwd=work)
        return work

    def release(self, dry_run=False, **extra):
        env = dict(os.environ, **GIT_ENV, PATH=self.stubs + os.pathsep + os.environ["PATH"], CALL_LOG=self.log, RELEASE_NOTES_FILE=self.release_md, TMPDIR=self.tmp.name)
        env.update(extra)
        env.pop("RELEASE_DRY_RUN", None)
        for name in ("WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"):
            env.pop(name, None)
        if dry_run:
            env["RELEASE_DRY_RUN"] = "1"
        else:
            env.update(WEB_EXT_API_KEY="user:1:1", WEB_EXT_API_SECRET="secret")
        return subprocess.run(["just", "release"], cwd=self.work, env=env, capture_output=True, text=True, timeout=120)

    def calls(self):
        if not os.path.exists(self.log):
            return []
        with open(self.log) as handle:
            return handle.read().splitlines()

    def read(self, path):
        with open(path) as handle:
            return handle.read()

    def test_release_pushes_then_publishes_hosts_then_submits_listed_then_resets_the_notes(self):
        done = self.release()
        self.assertEqual(done.returncode, 0, done.stderr)
        calls = self.calls()
        index = lambda prefix: next(i for i, call in enumerate(calls) if call.startswith(prefix))
        push, publish, submit = index("git push"), index("gh release create v1.0.2"), index("web-ext sign")
        self.assertLess(push, publish)
        self.assertLess(publish, submit)
        self.assertIn("--channel=listed", calls[submit])
        self.assertFalse([call for call in calls if "--channel=unlisted" in call], "a stable version is never signed unlisted")
        self.assertNotIn(".xpi", calls[publish], "the host release carries no xpi")
        self.assertEqual(self.read(self.log + ".release_md_at_submit"), NOTES, "RELEASE.md is intact when the submit runs")
        self.assertEqual(self.read(self.release_md), RESET_NOTES, "RELEASE.md is reset after the submit")

    def test_the_submit_carries_the_converted_notes_and_the_committed_metadata_stays(self):
        before = self.read(os.path.join(self.work, "amo", "metadata.json"))
        self.assertEqual(self.release().returncode, 0)
        self.assertEqual(self.read(self.log + ".submitted_notes").strip(), "A short intro.\n\n- A fix")
        self.assertEqual(self.read(os.path.join(self.work, "amo", "metadata.json")), before)
        self.assertEqual([name for name in os.listdir(self.tmp.name) if name.startswith("tmp")], [], "the temporary metadata file is deleted")

    def test_a_failed_submit_keeps_the_notes_and_names_the_recovery(self):
        done = self.release(WEB_EXT_FAIL="1")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("just sign_listed", done.stderr)
        self.assertEqual(self.read(self.release_md), NOTES)
        calls = self.calls()
        self.assertTrue(any(call.startswith("gh release create") for call in calls), "the host release was already public")

    def test_a_dry_run_pushes_publishes_and_submits_nothing_and_keeps_the_notes(self):
        done = self.release(dry_run=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        calls = self.calls()
        self.assertEqual([call for call in calls if call.startswith("git push") or call.startswith("gh release") or call.startswith("web-ext sign")], [])
        self.assertEqual(self.read(self.release_md), NOTES)
        self.assertEqual(self.git("log", "-1", "--format=%s").stdout.strip(), "chore(release): bump version to 1.0.2", "the bump is committed locally")

    def test_an_unconvertible_text_stops_everything_before_the_bump(self):
        with open(self.release_md, "w") as handle:
            handle.write("# Next release\n\n## Install\n\nOnly install text.\n")
        done = self.release()
        self.assertNotEqual(done.returncode, 0)
        self.assertEqual(self.git("log", "--format=%s").stdout.split("\n")[0], "base")
        self.assertEqual(self.calls(), [])

    def test_sign_listed_and_release_share_one_submit_recipe(self):
        shown = subprocess.run(["just", "--show", "sign_listed"], cwd=REPO, capture_output=True, text=True).stdout
        self.assertIn("just release_submit_listed", shown)

    def test_the_submit_refuses_a_four_number_version(self):
        done = subprocess.run(["just", "release_submit_listed", "1.0.2.1"], cwd=REPO, capture_output=True, text=True)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("three-number", done.stderr)


if __name__ == "__main__":
    unittest.main()
