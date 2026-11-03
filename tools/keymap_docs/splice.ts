// Marker splice and cell escaping for the generated block of a Markdown file.

export const BEGIN_MARKER = "<!-- BEGIN generated -->";
export const END_MARKER = "<!-- END generated -->";

// Replaces the text between the two markers, which must each appear exactly once and in order.
export function splice(doc: string, block: string): string {
  const begin = doc.split(BEGIN_MARKER).length - 1;
  const end = doc.split(END_MARKER).length - 1;
  if (begin !== 1 || end !== 1) throw new Error(`expected exactly one "${BEGIN_MARKER}" and one "${END_MARKER}", found ${begin} and ${end}`);
  const begin_at = doc.indexOf(BEGIN_MARKER);
  const end_at = doc.indexOf(END_MARKER);
  if (end_at < begin_at) throw new Error(`"${END_MARKER}" comes before "${BEGIN_MARKER}"`);
  return `${doc.slice(0, begin_at + BEGIN_MARKER.length)}\n\n${block.trim()}\n\n${doc.slice(end_at)}`;
}

// Text for one table cell: one line, with the pipe escaped.
export function cell(text: string): string {
  return text.replace(/\s+/g, " ").trim().replaceAll("|", "\\|");
}

// A code span that survives backticks inside the text.
export function code(text: string): string {
  const longest_run = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest_run + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}
