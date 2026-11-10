import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { INSPECT_EXPRESSION, run_page, select_pick } from "../../src/devtools/hand_off.ts";

function make_port() {
  const messages: unknown[] = [];
  const handlers = { message: (_message: unknown) => {}, disconnect: () => {} };
  const port = {
    postMessage: (message: unknown) => void messages.push(message),
    onMessage: { addListener: (listener: (message: unknown) => void) => void (handlers.message = listener) },
    onDisconnect: { addListener: (listener: () => void) => void (handlers.disconnect = listener) },
  };
  return { port, messages, handlers };
}

// `after_inspects(n)` settles once the page has run the inspect expression n times, which ends a pick whether its select worked or not.
function make_page(evaluate: (expression: string) => Promise<unknown>) {
  const ports: ReturnType<typeof make_port>[] = [];
  const timers: (() => void)[] = [];
  const waiting: { count: number; resolve: () => void }[] = [];
  let inspects = 0;
  run_page({
    tab_id: 9,
    connect: () => {
      ports.push(make_port());
      return ports.at(-1)!.port;
    },
    evaluate: async (expression) => {
      try {
        return await evaluate(expression);
      } finally {
        if (expression === INSPECT_EXPRESSION) {
          inspects += 1;
          for (const wait of waiting) if (inspects >= wait.count) wait.resolve();
        }
      }
    },
    schedule: (action) => void timers.push(action),
  });
  const after_inspects = (count: number) => (inspects >= count ? Promise.resolve() : new Promise<void>((resolve) => waiting.push({ count, resolve })));
  return { after_inspects, ports, timers };
}

test("the expression is the constant string the review reads", () => {
  assert.equal(INSPECT_EXPRESSION, "(p => { delete window.__desertfox_pick; inspect(p) })(window.__desertfox_pick)");
});

// A fake page that runs the real expression in node:vm. `after_eval` runs once after the first eval, as page script does in the gap before the next eval of a round trip.
function make_fake_page(after_eval: (window: { __desertfox_pick?: string }) => void) {
  const window: { __desertfox_pick?: string } = {};
  const inspected: (string | undefined)[] = [];
  const context = vm.createContext({ window, inspect: (node: string | undefined) => void inspected.push(node) });
  let hook_pending = true;
  const evaluate = async (expression: string) => {
    vm.runInContext(expression, context);
    if (hook_pending) {
      hook_pending = false;
      after_eval(window);
    }
  };
  return { window, inspected, evaluate };
}

test("a pick that lands right after the eval of the one before still reaches the Inspector", async () => {
  const page = make_fake_page((window) => void (window.__desertfox_pick = "B"));
  page.window.__desertfox_pick = "A";
  await select_pick(page.evaluate);
  await select_pick(page.evaluate);
  assert.deepEqual(page.inspected, ["A", "B"]);
  assert.equal("__desertfox_pick" in page.window, false);
});

test("the property is gone after the eval when inspect throws", () => {
  const window: { __desertfox_pick?: string } = { __desertfox_pick: "A" };
  const context = vm.createContext({ window, inspect: () => { throw new Error("inspect failed"); } });
  assert.throws(() => vm.runInContext(INSPECT_EXPRESSION, context), /inspect failed/);
  assert.equal("__desertfox_pick" in window, false);
});

test("the page names its tab on connect, then selects on each pick", async () => {
  const evaluated: string[] = [];
  const { after_inspects, ports } = make_page(async (expression) => void evaluated.push(expression));
  assert.deepEqual(ports[0]!.messages, [{ type: "devtools_hello", tab_id: 9 }]);
  ports[0]!.handlers.message({ type: "devtools_pick" });
  await after_inspects(1);
  assert.deepEqual(evaluated, [INSPECT_EXPRESSION]);
});

test("a message of another type evals nothing", async () => {
  const evaluated: string[] = [];
  const { after_inspects, ports } = make_page(async (expression) => void evaluated.push(expression));
  ports[0]!.handlers.message({ type: "something_else", expression: "alert(1)" });
  ports[0]!.handlers.message(undefined);
  // A pick sent after them marks the end: if the others had queued an eval it would come before.
  ports[0]!.handlers.message({ type: "devtools_pick" });
  await after_inspects(1);
  assert.deepEqual(evaluated, [INSPECT_EXPRESSION]);
});

test("select_pick passes on a failing eval", async () => {
  await assert.rejects(select_pick(async () => { throw new Error("inspect failed"); }), /inspect failed/);
});

test("a failing pick does not stop the next pick", async () => {
  const evaluated: string[] = [];
  let fail_next = true;
  const { after_inspects, ports } = make_page(async (expression) => {
    evaluated.push(expression);
    if (fail_next) {
      fail_next = false;
      throw new Error("inspect failed");
    }
  });
  ports[0]!.handlers.message({ type: "devtools_pick" });
  ports[0]!.handlers.message({ type: "devtools_pick" });
  await after_inspects(2);
  assert.deepEqual(evaluated, [INSPECT_EXPRESSION, INSPECT_EXPRESSION]);
});

test("two picks in a row run one after another", async () => {
  const order: string[] = [];
  const { after_inspects, ports } = make_page(async () => {
    order.push("start");
    await new Promise((resolve) => setImmediate(resolve));
    order.push("end");
  });
  ports[0]!.handlers.message({ type: "devtools_pick" });
  ports[0]!.handlers.message({ type: "devtools_pick" });
  await after_inspects(2);
  assert.deepEqual(order, ["start", "end", "start", "end"]);
});

test("a disconnect reconnects later and says hello again, so the background can drain a waiting pick", () => {
  const { ports, timers } = make_page(async () => {});
  ports[0]!.handlers.disconnect();
  assert.equal(ports.length, 1);
  timers[0]!();
  assert.equal(ports.length, 2);
  assert.deepEqual(ports[1]!.messages, [{ type: "devtools_hello", tab_id: 9 }]);
  ports[1]!.handlers.disconnect();
  timers[1]!();
  assert.equal(ports.length, 3);
});
