import assert from "node:assert/strict";
import { test } from "node:test";
import { create_surface, mount_surface } from "../../src/content/surface.ts";
import { LAYERS } from "../../src/shared/layers.ts";

type FakeHost = HTMLElement & { is_open: boolean; attached: boolean };

// Hosts in DOM order, a log of the popover calls, and a document that finds them by their layer attribute.
function fake_page(layers: number[]) {
  const calls: string[] = [];
  const hosts = layers.map((layer) => {
    const host = {
      is_open: false,
      attached: false,
      parentElement: null as unknown,
      getAttribute: () => String(layer),
      matches: () => host.is_open,
      hidePopover: () => ((host.is_open = false), calls.push(`hide ${layer}`)),
      showPopover: () => ((host.is_open = true), calls.push(`show ${layer}`)),
      dispatchEvent: (event: Event) => calls.push(`${event.type} ${layer}`),
    } as unknown as FakeHost;
    return host;
  });
  const root = {
    append: (host: { parentElement: unknown }) => (calls.push("append"), (host.parentElement = root)),
    querySelectorAll: () => hosts,
  };
  Object.assign(globalThis, {
    document: { documentElement: root },
  });
  return { calls, hosts };
}

test("mount_surface attaches the host, then shows it as a popover", () => {
  const { hosts, calls } = fake_page([LAYERS.toast]);
  mount_surface(hosts[0]!);
  assert.deepEqual(calls, ["append", `show ${LAYERS.toast}`]);
});

test("mount_surface shows open hosts of higher layers again, lowest first, after the mounted one", () => {
  const { hosts, calls } = fake_page([LAYERS.which_key, LAYERS.toast, LAYERS.hints, LAYERS.mode_badge]);
  hosts[0]!.is_open = true;
  hosts[3]!.is_open = true;
  mount_surface(hosts[2]!);
  assert.deepEqual(calls, [
    "append",
    `show ${LAYERS.hints}`,
    `hide ${LAYERS.mode_badge}`,
    `show ${LAYERS.mode_badge}`,
    `hide ${LAYERS.which_key}`,
    `show ${LAYERS.which_key}`,
    `desertfox-restacked ${LAYERS.mode_badge}`,
    `desertfox-restacked ${LAYERS.which_key}`,
  ]);
});

test("mount_surface leaves lower layers and closed hosts alone, and moves an open mounted host up", () => {
  const { hosts, calls } = fake_page([LAYERS.hints, LAYERS.toast, LAYERS.which_key]);
  hosts[0]!.is_open = true;
  hosts[1]!.is_open = true;
  mount_surface(hosts[1]!);
  assert.deepEqual(calls, ["append", `hide ${LAYERS.toast}`, `show ${LAYERS.toast}`]);
});

test("mount_surface never appends a host that is already on the page, because moving an iframe host reloads its frame", () => {
  const { hosts, calls } = fake_page([LAYERS.toast]);
  mount_surface(hosts[0]!);
  mount_surface(hosts[0]!);
  assert.deepEqual(calls, ["append", `show ${LAYERS.toast}`, `hide ${LAYERS.toast}`, `show ${LAYERS.toast}`]);
});

test("a toast mounted while the line is open shows the line again last and tells only the line", () => {
  const { hosts, calls } = fake_page([LAYERS.command_line, LAYERS.which_key, LAYERS.toast]);
  hosts[0]!.is_open = true;
  hosts[1]!.is_open = true;
  mount_surface(hosts[2]!);
  assert.deepEqual(calls, [
    "append",
    `show ${LAYERS.toast}`,
    `hide ${LAYERS.which_key}`,
    `show ${LAYERS.which_key}`,
    `hide ${LAYERS.command_line}`,
    `show ${LAYERS.command_line}`,
    `desertfox-restacked ${LAYERS.which_key}`,
    `desertfox-restacked ${LAYERS.command_line}`,
  ]);
});

test("hints mounted while the line is open end below it and the line hears the restack once", () => {
  const { hosts, calls } = fake_page([LAYERS.command_line, LAYERS.hints]);
  hosts[0]!.is_open = true;
  mount_surface(hosts[1]!);
  assert.equal(calls.at(-2), `show ${LAYERS.command_line}`);
  assert.deepEqual(calls.filter((call) => call.startsWith("desertfox-restacked")), [`desertfox-restacked ${LAYERS.command_line}`]);
});

test("a closed higher host and the mounted host hear no restack", () => {
  const { hosts, calls } = fake_page([LAYERS.command_line, LAYERS.toast]);
  mount_surface(hosts[1]!);
  assert.deepEqual(calls.filter((call) => call.startsWith("desertfox-restacked")), []);
});

test("create_surface makes a manual popover host that carries its layer", () => {
  const attributes: Record<string, string> = {};
  const host = {
    style: {},
    setAttribute: (name: string, value: string) => (attributes[name] = value),
    attachShadow: () => ({ append: () => {} }),
  };
  Object.assign(globalThis, {
    document: { createElement: (tag: string) => (tag === "div" ? host : { style: {} }) },
  });
  create_surface("x", "", LAYERS.toast);
  assert.equal(attributes.popover, "manual");
  assert.equal(attributes["data-desertfox-layer"], String(LAYERS.toast));
});
