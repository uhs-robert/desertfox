import { readFileSync } from "node:fs";

// Field 22 of /proc/<pid>/stat is the start time in clock ticks since boot. A recycled pid has a different one. The command name (field 2) may hold spaces and parentheses, so count fields after its closing parenthesis.
export function parse_start_ticks(stat_text: string): number | null {
  const after_name = stat_text.slice(stat_text.lastIndexOf(")") + 2).split(" ");
  const ticks = Number(after_name[19]);
  return Number.isInteger(ticks) && after_name.length > 19 ? ticks : null;
}

export function read_start_ticks(pid: number, proc_root = "/proc"): number | null {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  try {
    return parse_start_ticks(readFileSync(`${proc_root}/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

export function is_same_process(pid: number, start_ticks: number, proc_root = "/proc"): boolean {
  return start_ticks > 0 && read_start_ticks(pid, proc_root) === start_ticks;
}

// The debugger port web-ext hands to Firefox sits in its command line, NUL-separated.
export function parse_debug_port(cmdline: string): number | null {
  const words = cmdline.split("\0");
  const at = words.indexOf("-start-debugger-server");
  const port = Number(words[at + 1]);
  return at >= 0 && Number.isInteger(port) && port > 0 ? port : null;
}
