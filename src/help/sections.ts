// The section model: which sections each help page lists, the slugs they get, and the ids and hashes that name them.

import type { Block } from "./blocks.ts";
import type { HelpModel } from "./model.ts";
import { group_title } from "./model.ts";
import { GROUPS } from "./settings_model.ts";
import type { PageId } from "../shared/page/help_route.ts";
import { el } from "./dom.ts";

export const GUIDE_SUBSECTION_LEVEL = 3;
const YOUR_ENGINES = "Your engines";

// The toolbar popup links to `#section=settings/site-rules`, the id of this section's heading. The heading and the box are drawn at render, so the route lands on it at once. `main.ts` fills the box through `mount_settings`.
export const SITE_RULES_SLUG = "site-rules";

export const section_anchor = (page: PageId, slug: string): string => `${page}-${slug}`;

export type Section = { title: string; slug: string };

// Slugs are unique within a page, because they become element ids and route values. A repeat or a title with no letters gets a number.
export function sections_from_titles(titles: string[]): Section[] {
  const seen = new Set<string>();
  return titles.map((title) => {
    const base = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";
    let slug = base;
    for (let count = 2; seen.has(slug); count += 1) slug = `${base}-${count}`;
    seen.add(slug);
    return { title, slug };
  });
}

export const KEYS_SECTION = "Keys";
export const ENGINES_SECTION = "Search engines";
export const ALIASES_SECTION = "Aliases";
export const QUICKMARKS_SECTION = "Quickmarks";
export const SITE_RULES_SECTION = "Your site rules";
export const ADVANCED_FILES_SECTION = "Advanced: settings files";
export const ADVANCED_BACKUP_SECTION = "Advanced: back up and restore";
export const ADVANCED_FILES_EDITOR_SECTION = "Advanced: edit files";
// The setting groups come first, then the forms, then the collapsed Advanced block.
const SETTINGS_SECTION_TITLES = [...GROUPS.map((group) => group.title), SITE_RULES_SECTION, KEYS_SECTION, ENGINES_SECTION, ALIASES_SECTION, QUICKMARKS_SECTION, ADVANCED_FILES_SECTION, ADVANCED_BACKUP_SECTION, ADVANCED_FILES_EDITOR_SECTION];
// The title says "Your site rules", but the id stays `settings-site-rules` for the popup link.
const settings_sections = sections_from_titles(SETTINGS_SECTION_TITLES).map((section) => (section.title === SITE_RULES_SECTION ? { ...section, slug: SITE_RULES_SLUG } : section));
export const STYLING_SECTIONS = sections_from_titles(["Variables", "Classes"]);

// The sections a page lists in the sidebar. Only Search Engines reads the guide.
export function page_sections(page: PageId, source: HelpModel | Block[], guide: Block[] = []): Section[] {
  const quick_start = Array.isArray(source) ? source : source.quick_start;
  switch (page) {
    case "home": return [];
    case "settings": return settings_sections;
    case "quick-start": return sections_from_titles(quick_start.flatMap((block) => (block.kind === "heading" && block.level === 2 ? [block.text] : [])));
    // The slug comes from the id part, so a link to a group keeps working. Only the shown title is plain.
    case "commands": return Array.isArray(source) ? [] : sections_from_titles(source.groups.map((group) => group.name)).map((section, index) => ({ ...section, title: group_title(source.groups[index]!.name) }));
    case "search-engines": return sections_from_titles([...guide.flatMap((block) => (block.kind === "heading" && block.level === GUIDE_SUBSECTION_LEVEL ? [block.text] : [])), YOUR_ENGINES]);
    // Practice lists no sections: the lessons are read in order, and each link would be one more hint label on a page that teaches hints.
    case "practice": return [];
    case "styling": return STYLING_SECTIONS;
    case "site-rules": return [];
  }
}

export function section_heading(page: PageId, section: Section, level = 2): HTMLElement {
  const heading = el(`h${level}`, undefined, section.title);
  heading.id = section_anchor(page, section.slug);
  heading.tabIndex = -1;
  return heading;
}

export const section_hash = (page: PageId, slug: string): string => `#section=${page}/${encodeURIComponent(slug)}`;

export const settings_section = (title: string): Section => settings_sections[SETTINGS_SECTION_TITLES.indexOf(title)]!;
