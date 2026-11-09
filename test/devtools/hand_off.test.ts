import assert from "node:assert/strict";
import { test } from "node:test";
import { CLEAR_EXPRESSION, INSPECT_EXPRESSION, run_page, select_pick } from "../../src/devtools/hand_off.ts";

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

function make_page(evaluate: (expression: string) => Promise<unknown>) {
  const ports: ReturnType<typeof make_port>[] = [];
  const timers: (() => void)[] = [];
  const page = run_page({
    tab_id: 9,
    connect: () => {
      ports.push(make_port());
      return ports.at(-1)!.port;
    },
    evaluate,
    schedule: (action) => void timers.push(action),
  });
  return { page, ports, timers };
}

test("the two expressions are the constant strings the review reads", () => {
  assert.equal(INSPECT_EXPRESSION, "inspect(window.__desertfox_pick)");
  assert.equal(CLEAR_EXPRESSION, "delete window.__desertfox_pick");
});

test("the page names its tab on connect, then selects and clears on each pick", async () => {
  const evaluated: string[] = [];
  const { page, ports } = make_page(async (expression) => void evaluated.push(expression));
  assert.deepEqual(ports[0]!.messages, [{ type: "devtools_hello", tab_id: 9 }]);
  ports[0]!.handlers.message({ type: "devtools_pick" });
  await page.settled();
  assert.deepEqual(evaluated, [INSPECT_EXPRESSION, CLEAR_EXPRESSION]);
});

test("a message of another type evals nothing", async () => {
  const evaluated: string[] = [];
  const { page, ports } = make_page(async (expression) => void evaluated.push(expression));
  ports[0]!.handlers.message({ type: "something_else", expression: "alert(1)" });
  ports[0]!.handlers.message(undefined);
  await page.settled();
  assert.deepEqual(evaluated, []);
});

test("the property is cleared when the select throws", async () => {
  const evaluated: string[] = [];
  const evaluate = async (expression: string) => {
    evaluated.push(expression);
    if (expression === INSPECT_EXPRESSION) throw new Error("inspect failed");
  };
  await assert.rejects(select_pick(evaluate), /inspect failed/);
  assert.deepEqual(evaluated, [INSPECT_EXPRESSION, CLEAR_EXPRESSION]);
});

test("a failed clear does not hide the result of the select", async () => {
  const evaluate = async (expression: string) => {
    if (expression === CLEAR_EXPRESSION) throw new Error("page gone");
  };
  await select_pick(evaluate);
});

test("a failing pick does not stop the next pick, and each pick clears its own property", async () => {
  const evaluated: string[] = [];
  let fail_next = true;
  const { page, ports } = make_page(async (expression) => {
    evaluated.push(expression);
    if (expression === INSPECT_EXPRESSION && fail_next) {
      fail_next = false;
      throw new Error("inspect failed");
    }
  });
  ports[0]!.handlers.message({ type: "devtools_pick" });
  ports[0]!.handlers.message({ type: "devtools_pick" });
  await page.settled();
  assert.deepEqual(evaluated, [INSPECT_EXPRESSION, CLEAR_EXPRESSION, INSPECT_EXPRESSION, CLEAR_EXPRESSION]);
});

test("two picks in a row run one after another", async () => {
  const order: string[] = [];
  const { page, ports } = make_page(async (expression) => {
    order.push(`start ${expression}`);
    await new Promise((resolve) => setImmediate(resolve));
    order.push(`end ${expression}`);
  });
  ports[0]!.handlers.message({ type: "devtools_pick" });
  ports[0]!.handlers.message({ type: "devtools_pick" });
  await page.settled();
  assert.deepEqual(order, [
    `start ${INSPECT_EXPRESSION}`, `end ${INSPECT_EXPRESSION}`, `start ${CLEAR_EXPRESSION}`, `end ${CLEAR_EXPRESSION}`,
    `start ${INSPECT_EXPRESSION}`, `end ${INSPECT_EXPRESSION}`, `start ${CLEAR_EXPRESSION}`, `end ${CLEAR_EXPRESSION}`,
  ]);
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
