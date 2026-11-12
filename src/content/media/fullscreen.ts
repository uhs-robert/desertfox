// Fullscreen for the media key `F`. A site player has its own fullscreen button, and clicking it gives the layout the site made for fullscreen. Without one, the player box goes fullscreen. A second request that steps inward fails: Firefox 160 spends the key press's activation on the first request, even in the same task.

import { player_box } from "../player_box.ts";

const FULLSCREEN_LABEL = /full[\s_-]?screen/i;
const ANSWER_WAIT_MS = 300;

const labelled = (element: Element): boolean => [element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("class")].some((text) => FULLSCREEN_LABEL.test(text ?? ""));

// The innermost match, since a wrapper whose class names fullscreen holds the button itself. A match inside a control, such as an icon, stands for that control. An SVG has no `click`.
// A control outside the box, such as a link that wraps the whole player, is no fullscreen button, so the box goes fullscreen instead.
function fullscreen_button(box: Element): HTMLElement | undefined {
  const found = Array.from(box.querySelectorAll("*")).filter(labelled);
  const match = found.find((element) => !found.some((other) => other !== element && element.contains(other)));
  const control = match?.closest("button, a, [role=button]") ?? match;
  return control && box.contains(control) && typeof (control as HTMLElement).click === "function" ? (control as HTMLElement) : undefined;
}

const ANSWERS = ["fullscreenchange", "fullscreenerror"];

// Resolves when a fullscreen change or error arrives, else after the wait.
const fullscreen_answer = () =>
  new Promise<void>((resolve) => {
    const finish = () => {
      for (const type of ANSWERS) document.removeEventListener(type, finish);
      resolve();
    };
    for (const type of ANSWERS) document.addEventListener(type, finish);
    setTimeout(finish, ANSWER_WAIT_MS);
  });

export async function enter_fullscreen(video: Element): Promise<void> {
  const box = player_box(video);
  const button = fullscreen_button(box);
  if (button) {
    // The key press's activation lasts through this synchronous click, so the site's own handler may request fullscreen.
    const answer = fullscreen_answer();
    try {
      button.click();
    } catch {
      // A site control that throws on click leaves the box request below.
    }
    await answer;
  }
  if (document.fullscreenElement) return;
  try {
    await box.requestFullscreen();
  } catch (error) {
    // The click's own request may land while this one is refused.
    if (!document.fullscreenElement) throw error;
  }
}

// `exitFullscreen` leaves one level, and a nested request stacks levels.
export async function leave_fullscreen(): Promise<void> {
  while (document.fullscreenElement) await document.exitFullscreen();
}
