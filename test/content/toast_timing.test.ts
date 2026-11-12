import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { ToastKind } from "../../src/shared/messages.ts";

type FakeNode = Record<string, unknown> & { removed: boolean };

// A document just big enough for `create_surface` and `mount_surface`. `remove` is the only call the test reads.
function install_fake_document(): FakeNode[] {
  const hosts: FakeNode[] = [];
  const document_element = {
    querySelector: () => ({}),
    append: (host: FakeNode) => ((host.parentElement = document_element), (host.removed = false)),
    querySelectorAll: () => hosts.filter((host) => !host.removed),
  };
  const make_node = (): FakeNode => {
    const node: FakeNode = {
      removed: true,
      style: {},
      setAttribute: () => {},
      getAttribute: () => "0",
      attachShadow: () => ({ append: () => {} }),
      matches: () => false,
      showPopover: () => {},
      hidePopover: () => {},
      dispatchEvent: () => true,
      remove: () => (node.removed = true),
    };
    return node;
  };
  Object.assign(globalThis, {
    document: {
      documentElement: document_element,
      createElement: () => {
        const node = make_node();
        hosts.push(node);
        return node;
      },
    },
  });
  return hosts;
}

const KINDS_AND_DURATIONS: [ToastKind, number][] = [
  ["error", 6000],
  ["warning", 3000],
  ["info", 3000],
  ["success", 3000],
];

test("the proxy hands the error duration to an error toast and the other duration to every other kind", async () => {
  const { bundles } = await import("../../src/content/bundles.ts");
  const { set_toast_durations, show_toast } = await import("../../src/content/ui_proxy.ts");
  const sent: unknown[] = [];
  mock.method(bundles, "run_command_", (_id: string, _bundle: string, args: unknown) => void sent.push(args));
  set_toast_durations({ toast_ms: 3000, toast_error_ms: 6000 });
  for (const [kind] of KINDS_AND_DURATIONS) show_toast("m", kind);
  show_toast("m");
  assert.deepEqual(
    sent.map((args) => (args as { duration_ms: number }).duration_ms),
    [6000, 3000, 3000, 3000, 6000],
  );
  mock.restoreAll();
});

for (const [kind, duration_ms] of KINDS_AND_DURATIONS) {
  test(`a ${kind} toast hides after exactly the duration it was given`, async () => {
    const hosts = install_fake_document();
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const { show_toast } = await import(`../../src/content/toast.ts?${kind}`);
      show_toast("message", duration_ms, kind);
      const host = hosts[0]!;
      assert.equal(host.removed, false);
      mock.timers.tick(duration_ms - 1);
      assert.equal(host.removed, false);
      mock.timers.tick(1);
      assert.equal(host.removed, true);
    } finally {
      mock.timers.reset();
    }
  });
}
