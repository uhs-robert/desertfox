import assert from "node:assert/strict";
import { test } from "node:test";
import { BACKDROP_RESET_CSS, create_surface, mount_surface } from "../../src/content/surface.ts";
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
  const styles: { textContent: string; attributes: Set<string>; setAttribute: (name: string) => void }[] = [];
  const root = {
    children: [] as unknown[],
    append: (node: { parentElement?: unknown; attributes?: Set<string> }) => {
      if (node.attributes) root.children.push(node);
      else (calls.push("append"), (node.parentElement = root));
    },
    // Finds a style element by its attribute, as the real root does.
    querySelector: (selector: string) => root.children.find((node) => selector.includes([...(node as { attributes: Set<string> }).attributes][0] ?? "\0")),
    querySelectorAll: () => hosts,
  };
  Object.assign(globalThis, {
    document: {
      documentElement: root,
      createElement: () => {
        const attributes = new Set<string>();
        const style = { textContent: "", attributes, setAttribute: (name: string) => attributes.add(name) };
        styles.push(style);
        return style;
      },
    },
  });
  return { calls, hosts, styles, root };
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

// The unit environment has no style engine, so it cannot compute ::backdrop. It pins what makes the reset work instead: the rule
// text clears each property with !important, it targets only our hosts, and it is installed once and again after a removal.
test("mount_surface installs one backdrop reset that clears the page's backdrop styles on our hosts only", () => {
  const { hosts, styles } = fake_page([LAYERS.toast, LAYERS.which_key]);
  mount_surface(hosts[0]!);
  mount_surface(hosts[1]!);
  assert.equal(styles.length, 1);
  assert.equal(styles[0]!.textContent, BACKDROP_RESET_CSS);
  assert.match(BACKDROP_RESET_CSS, /^\[popover\]\[data-desertfox-layer\]::backdrop \{/);
  for (const property of ["backdrop-filter: none", "-webkit-backdrop-filter: none", "filter: none", "background: transparent", "opacity: 1"]) {
    assert.ok(BACKDROP_RESET_CSS.includes(`${property} !important`), property);
  }
});

test("mount_surface puts the backdrop reset back after a page removes it", () => {
  const { hosts, styles, root } = fake_page([LAYERS.toast]);
  mount_surface(hosts[0]!);
  root.children.length = 0;
  mount_surface(hosts[0]!);
  assert.equal(styles.length, 2);
  assert.equal(root.children.length, 1);
});

test("two bundles, each with its own copy of the module, share one backdrop reset", async () => {
  const other = (await import(`../../src/content/surface.ts?${"second_bundle"}`)) as typeof import("../../src/content/surface.ts");
  const { hosts, styles, root } = fake_page([LAYERS.toast, LAYERS.which_key]);
  mount_surface(hosts[0]!);
  other.mount_surface(hosts[1]!);
  assert.equal(styles.length, 1);
  assert.equal(root.children.length, 1);
});
