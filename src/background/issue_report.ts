import { REPO } from "../shared/native_host.ts";

// GitHub refuses a new-issue URL much past 8 KB, and the body is percent-encoded, so the report stays well under that.
export const MAX_WARNINGS = 10;
export const MAX_WARNINGS_BYTES = 2048;

export type IssueFacts = {
  version: string;
  channel: string;
  firefox: string;
  os: string;
  warnings: string[];
  // The config folder as the host names it. It is an absolute path, so it never goes into the report.
  config_dir: string;
};

const CONFIG_DIR_PLACEHOLDER = "<config dir>";

export type IssueReport = { title: string; body: string };

// Warnings word-for-word, minus the config folder path, at most MAX_WARNINGS and MAX_WARNINGS_BYTES of them (the count of the cut ones is stated).
export function warning_lines(warnings: string[], config_dir: string): { lines: string[]; cut: number } {
  const folder = config_dir.replace(/\/+$/, "");
  // Only an absolute path longer than "/" is a folder to hide. A label such as "import" is no path, and "/" would split every character.
  const scrub = (text: string) => (folder.startsWith("/") ? text.split(folder).join(CONFIG_DIR_PLACEHOLDER) : text);
  const lines: string[] = [];
  let bytes = 0;
  for (const warning of warnings.slice(0, MAX_WARNINGS)) {
    const line = scrub(warning).replace(/\s*\n\s*/g, " ");
    bytes += new TextEncoder().encode(line).length;
    if (bytes > MAX_WARNINGS_BYTES) break;
    lines.push(line);
  }
  return { lines, cut: warnings.length - lines.length };
}

// The warning text reaches GitHub only through the clipboard report, which the user reads before pasting.
// A query string loads on GitHub's servers before any review, so the form URL carries the count and no text.
export type ReportKind = "form" | "copy";

export function issue_report(facts: IssueFacts, kind: ReportKind): IssueReport {
  const { lines, cut } = warning_lines(facts.warnings, facts.config_dir);
  const count = facts.warnings.length;
  let warnings_section = "Config warnings: none";
  if (count > 0 && kind === "form") warnings_section = `Config warnings: ${count} (run \`issue --copy\` to include their text)`;
  if (count > 0 && kind === "copy") warnings_section = [`Config warnings (${count}):`, ...lines.map((line) => `- ${line}`), ...(cut > 0 ? [`(${cut} more not shown)`] : [])].join("\n");
  const body = [
    "**What happened**",
    "",
    "",
    "**What I expected**",
    "",
    "",
    "**Environment**",
    `- DesertFox: ${facts.version} (${facts.channel})`,
    `- Firefox: ${facts.firefox}`,
    `- OS: ${facts.os}`,
    "",
    warnings_section,
  ].join("\n");
  return { title: "", body };
}

export const BLANK_ISSUE_URL = `https://github.com/${REPO}/issues/new`;

export function issue_url(report: IssueReport): string {
  return `${BLANK_ISSUE_URL}?title=${encodeURIComponent(report.title)}&body=${encodeURIComponent(report.body)}`;
}
