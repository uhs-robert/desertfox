// Fullscreen for the media key `F`. A site player has its own fullscreen button, and clicking it gives the layout the site made for fullscreen. Without one, the player box goes fullscreen. A second request that steps inward fails: Firefox 160 spends the key press's activation on the first request, even in the same task.

import { player_box } from "../player_box.ts";

const FULLSCREEN_LABEL = /full[\s_-]?screen/i;
const ENTER_WAIT_MS = 300;

const labelled = (element: Element): boolean => [element.getAttribute("aria-label"), element.getAttribute("title"), element.getAttribute("class")].some((text) => FULLSCREEN_LABEL.test(text ?? ""));

// The innermost match, since a wrapper whose class names fullscreen holds the button itself.
function fullscreen_button(box: Element): HTMLElement | undefined {
  const found = Array.from(box.querySelectorAll("*")).filter(labelled);
  return found.find((element) => !found.some((other) => other !== element && element.contains(other))) as HTMLElement | undefined;
}

const settled = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function enter_fullscreen(video: Element): Promise<void> {
  const box = player_box(video);
  // The key press's activation lasts through this synchronous click, so the site's own handler may request fullscreen.
  fullscreen_button(box)?.click();
  await settled(ENTER_WAIT_MS);
  if (!document.fullscreenElement) await box.requestFullscreen();
}

// `exitFullscreen` leaves one level, and a nested request stacks levels.
export async function leave_fullscreen(): Promise<void> {
  while (document.fullscreenElement) await document.exitFullscreen();
}
