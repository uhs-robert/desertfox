"""Checks the listed release flow of the justfile without a key, a network or a real GitHub release. The order is read from `just --show release`. The submit runs as a dry run in a throwaway git copy of the repository."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from host_under_test import HOST_DIR

REPO = os.path.abspath(os.path.join(HOST_DIR, ".."))
NOTES = "# DesertFox 1.0.1\n\nA **short** intro.\n\n- A fix\n\n## Install\n\nRun the command.\n"


def just(*args, cwd=REPO, env=None):
    return subprocess.run(["just", *args], cwd=cwd, env=env, capture_output=True, text=True)


class ReleaseFlowCase(unittest.TestCase):
    def setUp(self):
        for tool in ("just", "jq", "git", "node"):
            if shutil.which(tool) is None:
                self.skipTest(f"{tool} not found")

    def test_release_publishes_the_hosts_before_the_listed_submit_and_signs_nothing_unlisted(self):
        body = just("--show", "release").stdout
        # The first line that runs each step, not the recovery text that names it.
        position = lambda step: body.index(f"\n    {step}") if f"\n    {step}" in body else body.index(f"\n    WEB_EXT_API_KEY=\"$amo_key\" WEB_EXT_API_SECRET=\"$amo_secret\" {step}")
        self.assertLess(position("just release_commit_push"), position("just release_publish"))
        self.assertLess(position("just release_publish"), position("just release_submit_listed"))
        self.assertLess(position("just release_submit_listed"), body.index("just release_notes_reset", position("just release_submit_listed") + 1), "RELEASE.md is reset only after the submit")
        for forbidden in ("sign_only", "release_install"):
            self.assertNotIn(forbidden, body)

    def test_sign_listed_and_release_share_one_submit_recipe(self):
        self.assertIn("just release_submit_listed", just("--show", "sign_listed").stdout)

    def test_submit_refuses_a_four_number_version(self):
        done = just("release_submit_listed", "1.0.2.1")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("three-number", done.stderr)


class DryRunSubmitCase(unittest.TestCase):
    def setUp(self):
        for tool in ("just", "jq", "git", "node"):
            if shutil.which(tool) is None:
                self.skipTest(f"{tool} not found")
        if not os.path.isdir(os.path.join(REPO, "node_modules")):
            self.skipTest("node_modules missing")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.copy = os.path.join(self.tmp.name, "repo")
        os.makedirs(self.copy)
        tracked = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=REPO, capture_output=True, text=True, check=True).stdout.split("\0")
        for name in filter(None, tracked):
            if os.path.isfile(os.path.join(REPO, name)):
                os.makedirs(os.path.join(self.copy, os.path.dirname(name)), exist_ok=True)
                shutil.copy2(os.path.join(REPO, name), os.path.join(self.copy, name))
        os.symlink(os.path.join(REPO, "node_modules"), os.path.join(self.copy, "node_modules"))
        git = ["git", "-c", "user.name=t", "-c", "user.email=t@t"]
        subprocess.run(["git", "init", "-q", "-b", "release"], cwd=self.copy, check=True)
        subprocess.run(["git", "add", "-A"], cwd=self.copy, check=True)
        subprocess.run([*git, "commit", "-q", "-m", "x"], cwd=self.copy, check=True)
        self.notes = os.path.join(self.tmp.name, "notes.md")
        with open(self.notes, "w") as handle:
            handle.write(NOTES)

    def test_the_notes_go_into_a_temporary_copy_and_the_committed_file_stays(self):
        with open(os.path.join(self.copy, "amo/metadata.json")) as handle:
            before = handle.read()
        with open(os.path.join(self.copy, "src/manifest.json")) as handle:
            version = json.load(handle)["version"]
        env = dict(os.environ, RELEASE_DRY_RUN="1", RELEASE_ASSETS_DIR=os.path.join(self.tmp.name, "assets"), TMPDIR=self.tmp.name)
        env.pop("WEB_EXT_API_KEY", None)
        done = just("release_submit_listed", version, self.notes, cwd=self.copy, env=env)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertIn("A short intro.\n\n- A fix", done.stdout)
        self.assertNotIn("Run the command", done.stdout)
        self.assertNotIn("**", done.stdout)
        with open(os.path.join(self.copy, "amo/metadata.json")) as handle:
            self.assertEqual(handle.read(), before)
        leftovers = [name for name in os.listdir(self.tmp.name) if name.startswith("tmp")]
        self.assertEqual(leftovers, [], "the temporary metadata file is deleted")


if __name__ == "__main__":
    unittest.main()
