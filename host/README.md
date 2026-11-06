# host

The native-messaging host for the config files, and the script that installs it. Linux only. Design: `docs/design.md`, Native host.

- `desertfox-host`: Python 3.9+, stdlib only. Firefox starts it for one request and it exits after one reply: a 4-byte native-endian length, then UTF-8 JSON. Verbs: `read_config` and `write_autoconfig`. Its only write is `autoconfig.toml` in the config folder. `DESERTFOX_CONFIG_DIR` replaces the folder, for tests. The file set `read_config` returns mirrors `tools/build-config/source_files.ts`, minus `autoconfig.toml`.
- `install.sh`: `install.sh <version|main> [--channel main]`. A version fetches the host from that GitHub release and refuses to install on a checksum mismatch. `main` fetches from the main branch with no checksum. It writes the host to `~/.local/share/desertfox/` and the manifest to `~/.mozilla/native-messaging-hosts/desertfox_host.json`, and stops with an error without python3 3.9 or newer.
- `test_host.py`, `test_install.py`, `host_under_test.py`: run them with `just host-test`. The install tests use a temporary HOME and a stubbed `curl`, and never touch the real home folder or the network. `test_install.py` also runs `just release_publish` against a stubbed `gh`.
