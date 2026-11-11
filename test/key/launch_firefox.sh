#!/usr/bin/env bash
# Runs inside the nested session. Usage: launch_firefox.sh <run_dir> <profile_dir> <debug_port> [gdb]
# With `gdb` as the fourth argument (the stall capture, see stall_capture.mjs) Firefox runs as a child of gdb, which dumps every thread when the capture sends SIGINT.
set -euo pipefail
run_dir=$1 profile_dir=$2 debug_port=$3 mode=${4:-plain}
echo "$HOME" > "$run_dir/session_home"
# The native host reads the config through this link, so a case can point it at another folder.
export DESERTFOX_CONFIG_DIR="$run_dir/active_config"
if [ "$mode" = gdb ]; then
  exec gdb -q -nx -batch -iex 'set debuginfod enabled off' -ex 'set startup-with-shell off' -ex 'set pagination off' \
    -ex 'set print thread-events off' -ex 'set print inferior-events off' -ex 'handle all nostop noprint pass' -ex 'handle SIGINT stop print nopass' \
    -ex run -ex 'info sharedlibrary' -ex 'info threads' -ex 'thread apply all bt 60' -ex kill \
    --args /usr/lib/firefox/firefox -no-remote -profile "$profile_dir" -start-debugger-server "$debug_port" about:blank > "$run_dir/gdb.log" 2>&1
fi
exec firefox -no-remote -profile "$profile_dir" -start-debugger-server "$debug_port" about:blank
