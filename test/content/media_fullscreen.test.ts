import assert from "node:assert/strict";
import { test } from "node:test";
import { enter_fullscreen, leave_fullscreen } from "../../src/content/media/fullscreen.ts";

type Fake = Record<string, any>;
const screen = { width: 1920, height: 1080 };
const small = { width: 1402, height: 516 };

// A video inside nested boxes of one size, like a site player. `fills_in` names the element whose fullscreen makes the video fill the screen.
function setup(fills_in: string, button?: { class_name: string; in_box: string }) {
  const requests: string[] = [];
  const stack: Fake[] = [];
  const doc: Fake = { addEventListener: () => undefined, removeEventListener: () => undefined, body: { id: "body", parentElement: null, parentNode: null }, documentElement: { id: "root" }, get fullscreenElement() { return stack.at(-1) ?? null; } };
  doc.body.ownerDocument = doc;
  const make = (id: string, parent: Fake | null): Fake => ({
    id,
    ownerDocument: doc,
    parentElement: parent,
    parentNode: parent,
    children: [] as Fake[],
    getBoundingClientRect: () => small,
    getAttribute: (name: string) => (name === "class" ? "" : null),
    closest: () => null,
    contains(other: Fake) { for (let up = other; up; up = up.parentElement) if (up === this) return true; return false; },
    querySelectorAll() { return this.children.flatMap((child: Fake) => [child, ...child.querySelectorAll()]); },
    async requestFullscreen() { requests.push(id); stack.push(this); },
  });
  const bg = make("bg", doc.body);
  const html5 = make("html5", bg);
  const player = make("player", html5);
  const video = make("video", player);
  bg.children.push(html5);
  html5.children.push(player);
  player.children.push(video);
  video.getBoundingClientRect = () => (stack.some((element) => element.id === fills_in) ? screen : small);
  if (button) {
    const found = button.in_box === "html5" ? html5 : bg;
    const click = make("button", found);
    click.getAttribute = (name: string) => (name === "class" ? button.class_name : null);
    click.click = () => stack.push(player);
    found.children.push(click);
  }
  Object.assign(globalThis, { document: Object.assign(doc, { exitFullscreen: async () => void stack.pop() }), innerWidth: screen.width, innerHeight: screen.height });
  return { video, requests, stack, html5 };
}

test("a fullscreen button inside the player box is clicked, and nothing else is requested", async () => {
  const { video, requests, stack } = setup("player", { class_name: "btn fullscreen-toggle", in_box: "html5" });
  await enter_fullscreen(video as unknown as Element);
  assert.deepEqual(requests, []);
  assert.equal(stack.at(-1)?.id, "player");
});

test("a match that is an svg icon inside a button clicks the button", async () => {
  const { video, requests, stack, html5 } = setup("player");
  const control = Object.assign(Object.create(null), { id: "control", parentElement: html5, click: () => stack.push(html5), getAttribute: () => "" });
  const icon: Fake = { id: "icon", ownerDocument: html5.ownerDocument, parentElement: control, getBoundingClientRect: () => small, getAttribute: (name: string) => (name === "class" ? "fullscreen-icon" : null), contains: () => false, closest: () => control, querySelectorAll: () => [] };
  html5.children.push(icon);
  await enter_fullscreen(video as unknown as Element);
  assert.deepEqual(requests, []);
  assert.equal(stack.at(-1)?.id, "html5");
});

test("an icon inside a link that wraps the player box is not clicked, and the box goes fullscreen", async () => {
  const { video, requests, stack, html5 } = setup("player");
  const clicks: string[] = [];
  const link = Object.assign(Object.create(null), { id: "link", parentElement: null, click: () => clicks.push("link"), getAttribute: () => "" });
  const icon: Fake = { id: "icon", ownerDocument: html5.ownerDocument, parentElement: html5, getBoundingClientRect: () => small, getAttribute: (name: string) => (name === "class" ? "fullscreen-icon" : null), contains: () => false, closest: () => link, querySelectorAll: () => [] };
  html5.children.push(icon);
  await enter_fullscreen(video as unknown as Element);
  assert.deepEqual(clicks, []);
  assert.equal(requests.length, 1);
  assert.equal(stack.at(-1)?.id, requests[0]);
});

test("a click that throws falls back to the box request", async () => {
  const { video, requests } = setup("bg", { class_name: "fullscreen-toggle", in_box: "html5" });
  const button = (video as Fake).parentElement.parentElement.children.at(-1);
  button.click = () => {
    throw new Error("site handler");
  };
  await enter_fullscreen(video as unknown as Element);
  assert.deepEqual(requests, ["bg"]);
});

test("a fullscreen that starts anyway hides a refused fallback request", async () => {
  const { video, stack } = setup("bg");
  const box = (video as Fake).parentElement.parentElement.parentElement;
  box.requestFullscreen = async () => {
    stack.push(box);
    throw new TypeError("denied");
  };
  await enter_fullscreen(video as unknown as Element);
  assert.equal(stack.length, 1);
});

test("with no button the box goes fullscreen and nothing else is requested", async () => {
  const { video, requests } = setup("bg");
  await enter_fullscreen(video as unknown as Element);
  assert.deepEqual(requests, ["bg"]);
});

test("leaving exits every nested level", async () => {
  const { video, stack } = setup("html5");
  await enter_fullscreen(video as unknown as Element);
  stack.push(video);
  assert.equal(stack.length, 2);
  await leave_fullscreen();
  assert.equal(stack.length, 0);
});
