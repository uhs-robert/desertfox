// Picking an entry by typed text and picking a bookmark folder. The handlers and the command line page share them, so `--folder=` filters a list by the rule that filing uses.

import { RuntimeRefusal } from "./command.ts";
import type { BookmarkRow, BookmarkRows } from "./messages.ts";
import { best_match, score_candidate } from "./score.ts";

export const FOLDER_PATH_SEPARATOR = " / ";

export type Pickable = { key: string; name: string; description: string; boost?: number | undefined };

// An exact key wins. Other text is a fuzzy match on name and description, and an equal tie is refused. `describe` writes an entry in the tie refusal and `hint` says what to type instead.
// `noun` names the list in the refusals ("bookmark", "folder").
export function pick_by<Entry>(entries: readonly Entry[], text: string, noun: string, parts: (entry: Entry) => Pickable, describe: (entry: Entry) => string, hint: string): Entry {
  const typed = text.trim();
  const exact = entries.find((entry) => parts(entry).key === typed);
  if (exact) return exact;
  const match = best_match(typed, entries, parts);
  if (match.found === "none") throw new RuntimeRefusal(`no ${noun} matches "${typed}"`);
  if (match.found === "tie") throw new RuntimeRefusal(`"${typed}" matches ${describe(match.first)} and ${describe(match.second)} equally, use ${hint}`);
  return match.item;
}

// An exact path wins. Other text is a fuzzy match on the path. A path two folders share is refused, because the text cannot say which one is meant.
export function pick_folder<Folder extends { path: string }>(folders: readonly Folder[], text: string): Folder {
  const typed = text.trim();
  if (folders.filter((folder) => folder.path === typed).length > 1) throw new RuntimeRefusal(`Two folders match "${typed}", rename one of them`);
  return pick_by(folders, typed, "folder", (folder) => ({ key: folder.path, name: folder.path, description: "" }), (folder) => `"${folder.path}"`, "the full path");
}

// The folder a filter means. Like `pick_folder`, except that when the best fuzzy matches are a folder and its own subfolders, the folder wins: the filter keeps the subfolders anyway, so the pick loses nothing. Filing must not use this, because there a wrong guess files into the wrong place.
export function pick_filter_folder<Folder extends { path: string }>(folders: readonly Folder[], text: string): Folder {
  const typed = text.trim();
  if (!folders.some((folder) => folder.path === typed)) {
    const hits = folders.flatMap((folder) => {
      const hit = score_candidate(typed, { name: folder.path, description: "" });
      return hit ? [{ folder, score: hit.score }] : [];
    });
    const best = Math.max(...hits.map((hit) => hit.score));
    const tied = hits.filter((hit) => hit.score === best).map((hit) => hit.folder);
    const ancestor = tied.find((candidate) => tied.every((other) => in_folder(other.path, candidate.path)));
    if (tied.length > 1 && ancestor && tied.filter((other) => other.path === ancestor.path).length === 1) return ancestor;
  }
  return pick_folder(folders, typed);
}

// The folder itself or any folder below it. Paths join titles with a separator, so a title that holds the separator can look like a subfolder: a rare slip that the filter accepts.
export const in_folder = (path: string, root_path: string): boolean => path === root_path || path.startsWith(root_path + FOLDER_PATH_SEPARATOR);

// The rows filed in `root_path` or below it. A row in several folders stays when any one of them is inside.
export const rows_in_folder = (answer: BookmarkRows, root_path: string): BookmarkRow[] =>
  answer.rows.filter((row) => row.folders.some((index) => in_folder(answer.folders[index] ?? "", root_path)));
