// The text of the Practice lessons, in page order. Each lesson teaches the fastest key for one task on any website: a goal, the steps to do on the page, and the checks the page ticks off.
// A step that leaves the page names the way back before the key that leaves.
// Every key comes from the compiled keymap through `sentence`, so a rebind shows the reader's own key.
// The key test (`test/key/p40_help_practice.mjs`) drives each lesson with the keys its steps name and waits for these checks.

import type { CommandMeta } from "../shared/command.ts";
import type { CompiledKeymap } from "../shared/prefix_tree.ts";
import type { Inline } from "./blocks.ts";
import { sentence } from "./quick_start.ts";

// The watch page the video lesson opens: Rick Astley, Never Gonna Give You Up.
export const PRACTICE_VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

type LessonSource = { slug: string; title: string; goal: string; steps: string[]; notes?: string[]; checks: Record<string, string> };

// `{name}` is a key and `[text]` is text to type, as in `sentence`.
const LESSONS = [
  {
    slug: "scroll",
    title: "1. Scroll",
    goal: "Move through any page without the mouse.",
    steps: [
      "Press {down} a few times to scroll down, and {up} to scroll up.",
      "Press {half_page} to move half a page down, and {half_page_up} to move half a page up.",
      "Press {bottom} to jump to the end of the page. Then press {top} to come back to the start.",
      "The strip below is wider than the page. Press {right} to move it right and {left} to move it left.",
      "A number before a key repeats it. Type [5], then press {down}.",
    ],
    checks: { down: "scrolled down", end: "reached the end of the page", top: "came back to the start", strip: "moved the wide strip" },
  },
  {
    slug: "which-key",
    title: "2. See every key",
    goal: "Find any key without leaving the page.",
    steps: [
      "Press {whichkey}. A panel lists the first key of every command.",
      "Press [z] while the panel is open. It now lists the zoom keys. Find \"Zoom in\" and press its key.",
      "Find the key that resets the zoom the same way, and press it.",
      "{escape} closes the panel. It also returns to normal mode from anywhere, so press it when a key does nothing.",
    ],
    notes: ["A key that starts a longer sequence opens the same panel after a short wait. Press [g] and wait to see it.", "The badge in the corner of the page names the mode."],
    checks: { zoomed: "zoomed in", reset: "reset the zoom" },
  },
  {
    slug: "headings",
    title: "3. Jump between headings",
    goal: "Move through a long page, such as an article or a manual, by its headings.",
    steps: [
      "Press {next_heading} to jump to the next heading, and {previous_heading} to jump to the one before.",
      "Press {headings}. A list of every heading on the page opens. Type [grab] to narrow the list, and press Enter to jump to the heading that is left.",
      "Press {headings} again, type [jump] and press Enter.",
    ],
    checks: { heading: "jumped to the next heading", listed: "picked a heading from the list" },
  },
  {
    slug: "hints",
    title: "4. Pick anything with hints",
    goal: "Press a button, open a section or tick a box with a few keys.",
    steps: [
      "Press {hint}. Letters appear on everything you can press. Type the letters on \"Ring the bell\".",
      "Press {hint} and type the letters on \"Show more\".",
      "Press {hint} and type the letters on \"Lights on\".",
    ],
    notes: ["{escape} cancels the hints.", "On a crowded page, press {hint}, then {hint_text}, then type part of the text to narrow the labels. Enter picks."],
    checks: { bell: "rang the bell", section: "opened the section", lights: "turned the lights on" },
  },
  {
    slug: "form",
    title: "5. Fill in a form",
    goal: "Type in a form and move through it without picking each box.",
    steps: [
      "Press {focus_input}. The first text box takes the keys and the badge says INSERT. Type a name.",
      "Press Tab and type an email address. Press Tab and type a note.",
      "Press Tab again. It lands on the checkbox, and the badge returns to NORMAL by itself. Press Space to tick the box.",
      "Press {next_field} to move to the dropdown, and the Down arrow to change it.",
      "Press {next_field} to move to Send, and Enter to press it.",
    ],
    notes: ["{previous_field} moves back one control.", "{escape} leaves a text box."],
    checks: { typed: "typed in all three boxes", ticked: "ticked the box", chosen: "changed the dropdown", sent: "sent the form" },
  },
  {
    slug: "inputs",
    title: "6. Go straight to one control",
    goal: "Reach a radio button, a dropdown or a checkbox anywhere on the page with one letter.",
    steps: [
      "Press {hint_inputs}. Only the inputs get letters. Type the letter on \"Bravo\". It is chosen at once.",
      "Press the Down arrow to move the choice to \"Charlie\".",
      "Press {hint_inputs} and the letter on the dropdown. Press the Down arrow until it shows Oasis.",
      "Press {hint_inputs_rapid}. The letters stay after each pick. Type the letters on \"Sun\", \"Moon\" and \"Stars\", one after the other, then press {escape}.",
      "Press {hint_buttons}. Only the buttons get letters. Type the letter on \"Done\".",
    ],
    notes: ["Press [;] and wait. The panel lists every kind of hint."],
    checks: { bravo: "chose Bravo", charlie: "moved to Charlie", oasis: "set the dropdown to Oasis", rapid: "ticked all three boxes", done: "pressed Done" },
  },
  {
    slug: "slider",
    title: "7. Grab and drop",
    goal: "Drag anything a mouse can drag. There are two ways. Grab and move: you pick a thing, then move it with keys. Grab and drop: you pick a thing, then pick the place it goes to from letters on the page.",
    steps: [
      "Grab and move is {grab_move}. [;] starts a hint key, [G] means grab and move, and [g] puts letters only on the things that can be dragged. Press {grab_move} and type the letter on the slider. The badge says GRAB.",
      "Press {grab_right} until the slider reads 7. {grab_left} moves it back. Press {grab_drop} to drop it there.",
      "Grab and drop is {grab_drop_on}. [;] starts a hint key, the first [g] means grab and drop, and the second [g] puts letters only on the things that can be dragged. Press {grab_drop_on} and type the letter on the card \"Fox\".",
      "New letters appear on every place the card can go. Type the letters on the box \"Den\". The card drops there.",
    ],
    notes: ["In grab mode, {grab_keys} lists the keys and {escape} puts the thing back where it was.", "{hint_inputs} and a letter only focuses a slider. The arrow keys move it then."],
    checks: { seven: "set the slider to 7", den: "dropped the Fox in the Den" },
  },
  {
    slug: "find",
    title: "8. Find text on the page",
    goal: "Jump to a word.",
    steps: ["Press {find}, type [fox] and press Enter.", "Press {next} to jump to the next match, and {previous} to the one before."],
    notes: ["{find_back} searches backward."],
    checks: { found: "found a match", stepped: "moved to another match" },
  },
  {
    slug: "copy",
    title: "9. Copy text",
    goal: "Copy a paragraph, or one exact sentence, without the mouse.",
    steps: [
      "Press {hint_copy_text} and type the letters on the second paragraph below. Its text is copied.",
      "Press {focus_input} to enter the paste box, and press Ctrl+V. Press {escape} to leave the box.",
      "For one sentence, press {visual_at_text} and type the letters on the first paragraph. Press {sentence_object} to select its first sentence, and {yank} to copy it.",
      "Press {escape} to return to normal mode. Then press {focus_input} and Ctrl+V again.",
    ],
    notes: ["In visual mode, {caret_word} extends the selection by a word and {swap} moves to its other end.", "{caret_at_text} and a letter places a caret without selecting."],
    checks: { paragraph: "pasted the second paragraph", sentence: "pasted one sentence" },
  },
  {
    slug: "command-line",
    title: "10. The command line",
    goal: "Run any command by name, and look up every key.",
    steps: [
      "Press {cmdline}. Type [set theme catppuccin] and press Enter. Tab completes each word. The page changes colors.",
      "Press {cmdline}, type [unset theme] and press Enter to drop that change.",
      "{back} goes back one page, so it brings you back here. Press {cmdline}, type [help commands] and press Enter. The Commands page lists every command and its keys. Then press {back}.",
    ],
    notes: ["{help} opens the help from any page.", "On the command line, Ctrl+H opens the help for the command you are typing."],
    checks: { themed: "changed the theme", restored: "dropped the change", returned: "came back from the Commands page" },
  },
  {
    slug: "tabs",
    title: "11. Tabs",
    goal: "Open pages in the background and jump between tabs.",
    steps: [
      "Press {hint_background} and type the letters on \"Settings\". It opens in a new tab behind this one. Do the same for \"Commands\".",
      "{tab_close} closes the tab you are on, and that brings you back here. Press {tab_switch} and type [settings]. A list of your tabs narrows as you type. Press the Down arrow until the Settings row is highlighted, then Enter. You are on the Settings tab. Now press {tab_close}.",
      "A tab can also close from the list. Press {tab_switch} and type [comm]. Press the Down arrow until the Commands row is highlighted, then {list_close} to close that tab, and {escape}.",
    ],
    notes: ["{tab_alternate} returns to the tab you used last, without closing one.", "{tab_next} and {tab_previous} move to the next and previous tab.", "{find_anything} also searches bookmarks and history. {tab_switch} lists tabs only."],
    checks: { opened: "opened two tabs in the background", returned: "left this tab and came back", closed: "closed the other tab from the list" },
  },
  {
    slug: "video",
    title: "12. Video",
    goal: "Drive a video player with the keyboard.",
    steps: [
      "{back} goes back one page, so it brings you back here from the video. Read all the steps first, because this text is gone on YouTube.",
      "Press {hint} and type the letters on the video link below.",
      "On YouTube, press {media_enter}. The badge says MEDIA and a panel lists the keys.",
      "Press {media_play} to play or pause. {media_forward} and {media_backward} seek. {media_louder} and {media_quieter} change the volume. {media_faster} speeds up and {media_speed_reset} resets the speed. {media_mute} mutes. {media_fullscreen} fills the screen.",
      "Press {escape} to leave media mode, then {back}.",
    ],
    notes: ["If the video does not start, press {hint} and type the letters on its play button.", "In media mode, {media_keys} shows the key list again."],
    checks: { returned: "came back from the video" },
  },
  {
    slug: "marks",
    title: "13. Come back to a place",
    goal: "Leave a spot on a long page and return to it.",
    steps: [
      "Press {mark}, then [a]. This place is now mark a.",
      "Press {bottom} to go to the end of the page. Then press {mark_jump} and [a] to return.",
      "Press {top} to go to the start. Then press {jump_back} to return to where that jump began.",
    ],
    checks: { marked: "went to the end and came back here", jumped: "went to the start and came back here" },
  },
  {
    slug: "ignore",
    title: "14. Let the page have the keys",
    goal: "Use a page that has its own keyboard shortcuts.",
    steps: [
      "The box below counts every j the page receives. Press [j]. The page scrolls and the count stays 0, because DesertFox takes the key.",
      "Press {pass_next}, then [j]. That one key goes to the page.",
      "Press {ignore}. The badge says IGNORE and every key goes to the page. Press [j] three times. Press {ignore} again to take the keys back.",
    ],
    notes: ["{insert} also hands the keys to the page, until {escape}."],
    checks: { passed: "the page received one j", ignored: "the page received four" },
  },
] as const satisfies readonly LessonSource[];

export type LessonSlug = (typeof LESSONS)[number]["slug"];

export type PracticeLesson = { slug: LessonSlug; title: string; goal: Inline[]; steps: Inline[][]; notes: Inline[][]; checks: { name: string; text: string }[] };

const INTRO = "Welcome! These lessons will teach you the basic keys needed for web browsing.";
const OUTRO = "That is the end of the lessons. Keep learning as you browse. On any page, {whichkey} lists every key. {cmdline} opens the command line with a list of every command. Type to narrow the list, and press Tab to complete a name.";

export const practice_intro = (compiled: CompiledKeymap | undefined, commands: CommandMeta[] = []): Inline[] => sentence(compiled, commands, INTRO);
export const practice_outro = (compiled: CompiledKeymap | undefined, commands: CommandMeta[] = []): Inline[] => sentence(compiled, commands, OUTRO);

export function practice_lessons(compiled: CompiledKeymap | undefined, commands: CommandMeta[] = []): PracticeLesson[] {
  const say = (template: string) => sentence(compiled, commands, template);
  return LESSONS.map((lesson: LessonSource) => ({
    slug: lesson.slug as LessonSlug,
    title: lesson.title,
    goal: say(lesson.goal),
    steps: lesson.steps.map(say),
    notes: (lesson.notes ?? []).map(say),
    checks: Object.entries(lesson.checks).map(([name, text]) => ({ name, text })),
  }));
}

// The id of a check line, which the key test and the demo script read. `data-done` on it turns "true" when the page saw the step.
export const practice_check_id = (slug: LessonSlug, name: string): string => `practice-check-${slug}-${name}`;
