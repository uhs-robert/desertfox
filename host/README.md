# host

The native-messaging host for the config files, and the script that installs it. Linux only. Design: `docs/design.md`, Native host.

- `desertfox-host`: Python 3.9+, stdlib only. Firefox starts it for one request and it exits after one reply: a 4-byte native-endian length, then UTF-8 JSON. Verbs: `read_config` and `write_autoconfig`. Its only write is `autoconfig.toml` in the config folder. `DESERTFOX_CONFIG_DIR` replaces the folder, for tests. The file set `read_config` returns mirrors `tools/build-config/source_files.ts`, minus `autoconfig.toml`.
- `install.sh`: `install.sh <version|main> [--channel main]`. A version fetches the host from that GitHub release and refuses to install on a checksum mismatch. `main` fetches from the main branch with no checksum. The script is one function called on its last line, so a cut-off download runs nothing. It writes the host to `$XDG_DATA_HOME/desertfox/` (a relative value is ignored, default `~/.local/share`) and the manifest to `~/.mozilla/native-messaging-hosts/desertfox_host.json`, and stops with an error without python3 3.9 or newer.
- `test_host.py`, `test_install.py`, `host_under_test.py`: run them with `just host-test`. The install tests use a temporary HOME and a stubbed `curl`, and never touch the real home folder or the network. `test_install.py` also runs `just release_publish` against a stubbed `gh`, and `just release_commit_push` against a local bare remote. `just release` commits and pushes the bump first, so the release tag targets that commit.

## Display host

- `desertfox-display-host`: Python 3.9+, stdlib only, native name `desertfox_display_host`. Unlike the config host it stays alive on a `connectNative` port while the extension has `ui = quickshell`. It says `{"ready": true, "host_version": 1}` once at start, and the extension trusts the port only after that. It takes three verbs and writes one snapshot, `$XDG_RUNTIME_DIR/desertfox/state.json`: `version`, `seq`, `host` (`pid`, `start`), `firefox`, `mode`, `whichkey` (null when no panel shows). Writes go to a temp file in the same folder and are renamed. A newer host (later `start`) owns the file: an older one that is still alive stops writing, `seq` continues from the file, and a host deletes the file on exit only when it still names its own `pid` and `start`. The shell reader treats a dead or reused pid as no state. A malformed or oversized message is skipped.
- No installer yet. Install by hand, with the extension already installed and the native messaging permission granted (`:native.install` page):
  1. `install -D -m 755 host/desertfox-display-host ~/.local/share/desertfox/desertfox-display-host`
  2. Write `~/.mozilla/native-messaging-hosts/desertfox_display_host.json`: `{"name": "desertfox_display_host", "description": "DesertFox display host", "path": "<home>/.local/share/desertfox/desertfox-display-host", "type": "stdio", "allowed_extensions": ["desertfox@uhs-robert"]}`. Use the absolute path, not `~`.
  3. Set `ui = "quickshell"` in `settings.toml` (or `:set ui quickshell`), then reload the config. The extension connects within a second. With no host it keeps the in-page UI and retries with a growing pause, up to 60 s.
  4. Check `$XDG_RUNTIME_DIR/desertfox/state.json` after a key press in Firefox.
- `test_display_host.py`: real processes with a temporary `XDG_RUNTIME_DIR`. Run with `just host-test`.
