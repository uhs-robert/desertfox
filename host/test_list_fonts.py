import os
import stat
import sys
import tempfile
import unittest

from host_under_test import load_host

host = load_host()


class ListFontsTest(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.record = os.path.join(self.folder.name, "argv.txt")

    def stub(self, body):
        """A stand-in for fc-list: writes its argv to a file, then runs `body` (Python)."""
        path = os.path.join(self.folder.name, "fc-list")
        with open(path, "w") as file:
            file.write(f"#!{sys.executable}\nimport sys\nopen({self.record!r}, 'w').write(repr(sys.argv[1:]))\n{body}\n")
        os.chmod(path, os.stat(path).st_mode | stat.S_IXUSR)
        return path

    def run_verb(self, body, request=None):
        return host.list_fonts(request or {"cmd": "list_fonts"}, command=self.stub(body))

    def test_names_come_back_sorted_and_without_duplicates(self):
        reply = self.run_verb("sys.stdout.write('Noto Sans\\nCantarell\\nNoto Sans\\n\\nDejaVu  Sans \\n')")
        self.assertEqual(reply, {"fonts": ["Cantarell", "DejaVu Sans", "Noto Sans"]})

    def test_fc_list_gets_a_fixed_argv_and_no_shell(self):
        self.run_verb("pass")
        with open(self.record) as file:
            self.assertEqual(file.read(), repr(["--format", "%{family[0]}\n"]))

    def test_names_the_extension_parser_would_refuse_are_dropped(self):
        refused = ['Bad"Quote', "Back\\slash", "Open{Brace", "Semi;colon", "Angle<Tag", "Two,Names", "Has/*comment", "My var(x)", "URL url(x)", "Loud !important", "Control\x07Char", "x" * 201]
        lines = "\\n".join(repr(name)[1:-1] for name in refused)
        reply = self.run_verb(f"sys.stdout.write('Good Font\\n{lines}\\n' + 'x' * 200 + '\\n')")
        self.assertEqual(reply, {"fonts": sorted(["Good Font", "x" * 200])})

    def test_the_list_is_cut_to_the_cap(self):
        reply = self.run_verb("sys.stdout.write(''.join(f'Font {n:05d}\\n' for n in range(2500)))")
        self.assertEqual(len(reply["fonts"]), host.MAX_FONT_NAMES)
        self.assertEqual(reply["fonts"][0], "Font 00000")
        self.assertEqual(reply["fonts"][-1], f"Font {host.MAX_FONT_NAMES - 1:05d}")

    def test_a_failing_fc_list_is_refused(self):
        with self.assertRaises(host.HostError) as caught:
            self.run_verb("sys.exit(3)")
        self.assertIn("exit 3", str(caught.exception))

    def test_a_missing_fc_list_is_refused(self):
        with self.assertRaises(host.HostError) as caught:
            host.list_fonts({"cmd": "list_fonts"}, command=os.path.join(self.folder.name, "absent"))
        self.assertIn("cannot start", str(caught.exception))

    def test_a_hung_fc_list_is_killed_at_the_timeout(self):
        original = host.FC_LIST_TIMEOUT_S
        host.FC_LIST_TIMEOUT_S = 0.5
        self.addCleanup(setattr, host, "FC_LIST_TIMEOUT_S", original)
        with self.assertRaises(host.HostError) as caught:
            self.run_verb("import time\ntime.sleep(60)")
        self.assertIn("did not finish", str(caught.exception))

    def test_a_field_in_the_request_is_refused(self):
        with self.assertRaises(host.HostError) as caught:
            self.run_verb("pass", {"cmd": "list_fonts", "args": "-v"})
        self.assertIn("takes only", str(caught.exception))

    def test_the_verb_is_routed_by_handle(self):
        original = host.FC_LIST_COMMAND
        host.FC_LIST_COMMAND = self.stub("sys.stdout.write('Cantarell\\n')")
        self.addCleanup(setattr, host, "FC_LIST_COMMAND", original)
        self.assertEqual(host.handle({"cmd": "list_fonts"}), {"fonts": ["Cantarell"]})


if __name__ == "__main__":
    unittest.main()
