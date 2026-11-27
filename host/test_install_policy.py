"""Runs tools/install_policy.sh with --dry-run against a temporary policy file. Nothing touches /etc, sudo or the network."""
import json
import os
import shutil
import subprocess
import tempfile
import unittest

from host_under_test import HOST_DIR

SCRIPT = os.path.join(HOST_DIR, "..", "tools", "install_policy.sh")
BETA_URL = "https://github.com/uhs-robert/desertfox/releases/download/v0.1.24.1/desertfox-0.1.24.1.xpi"
OTHER_ENTRY = {"installation_mode": "force_installed", "install_url": "https://example.test/other.xpi"}


class InstallPolicyCase(unittest.TestCase):
    def setUp(self):
        if shutil.which("jq") is None:
            self.skipTest("jq not found")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.policies = os.path.join(self.tmp.name, "policies.json")
        with open(self.policies, "w") as handle:
            json.dump({"policies": {"DisableTelemetry": True, "ExtensionSettings": {"other@x": OTHER_ENTRY}}}, handle)
        self.artifacts = os.path.join(self.tmp.name, "web-ext-artifacts")
        os.makedirs(self.artifacts)

    def dry_run(self, *args):
        env = dict(os.environ, DESERTFOX_POLICIES_FILE=self.policies)
        result = subprocess.run(["bash", SCRIPT, "--dry-run", *args], cwd=self.tmp.name, env=env, capture_output=True, text=True)
        return result

    def settings(self, *args):
        result = self.dry_run(*args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)["policies"]

    def test_beta_pins_the_https_url_and_keeps_other_entries(self):
        policies = self.settings("beta", BETA_URL)
        entries = policies["ExtensionSettings"]
        self.assertEqual(entries["desertfox@uhs-robert"], {"installation_mode": "normal_installed", "install_url": BETA_URL})
        self.assertEqual(entries["oasis" "fox@uhs-robert"], {"installation_mode": "blocked"})
        self.assertEqual(entries["other@x"], OTHER_ENTRY)
        self.assertIs(policies["DisableTelemetry"], True)

    def test_beta_defaults_to_the_fixed_channel_asset(self):
        entry = self.settings("beta")["ExtensionSettings"]["desertfox@uhs-robert"]
        self.assertEqual(entry["install_url"], "https://github.com/uhs-robert/desertfox/releases/download/beta-channel/desertfox-beta.xpi")

    def test_workflow_uploads_a_file_named_like_the_default_url(self):
        workflow = os.path.join(HOST_DIR, "..", ".github", "workflows", "beta.yml")
        with open(workflow) as handle:
            text = handle.read()
        self.assertIn("fixed-asset/desertfox-beta.xpi", text)
        self.assertIn('cp "$(ls web-ext-artifacts/*.xpi)" fixed-asset/desertfox-beta.xpi', text)
        self.assertNotIn("xpi)#", text)

    def test_beta_needs_no_local_xpi(self):
        self.assertEqual(self.dry_run("beta", BETA_URL).returncode, 0)

    def test_beta_refuses_a_non_https_url(self):
        result = self.dry_run("beta", "file:///tmp/x.xpi")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("https", result.stderr)

    def test_stable_pins_the_local_xpi_and_replaces_a_beta_pin(self):
        open(os.path.join(self.artifacts, "desertfox-0.1.24.xpi"), "w").close()
        with open(self.policies, "w") as handle:
            json.dump({"policies": {"ExtensionSettings": {"desertfox@uhs-robert": {"installation_mode": "normal_installed", "install_url": BETA_URL}}}}, handle)
        entry = self.settings()["ExtensionSettings"]["desertfox@uhs-robert"]
        self.assertEqual(entry["install_url"], "file:///usr/local/share/desertfox/desertfox@uhs-robert.xpi")

    def test_stable_needs_exactly_one_xpi(self):
        self.assertNotEqual(self.dry_run("stable").returncode, 0)


if __name__ == "__main__":
    unittest.main()
