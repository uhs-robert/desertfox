import assert from "node:assert/strict";
import { test } from "node:test";
import { best_effort, ignore_refusal, keep_chain, refused_as, warn_and_go } from "../../src/shared/swallow.ts";

const refuse = (): Promise<number> => Promise.reject(new Error("no such tab"));

test("ignore_refusal passes a value and turns a rejection into undefined", async () => {
    assert.equal(await ignore_refusal(Promise.resolve(7)), 7);
    assert.equal(await ignore_refusal(refuse()), undefined);
});

test("best_effort never rejects: a value passes through and a rejection gives undefined", async () => {
    assert.equal(await best_effort(Promise.resolve(7)), 7);
    assert.equal(await best_effort(refuse()), undefined);
});

test("keep_chain keeps a queue alive after a failed turn while the turn's own promise still rejects", async () => {
    const failed = refuse();
    const tail = keep_chain(failed);
    await assert.rejects(failed, /no such tab/);
    assert.equal(await tail, undefined);
    const next = tail.then(() => "ran");
    assert.equal(await next, "ran");
});

test("refused_as passes a value and gives the fallback on a rejection", async () => {
    assert.equal(await refused_as(Promise.resolve(7), 0), 7);
    assert.deepEqual(await refused_as(refuse(), []), []);
    assert.equal(await refused_as(refuse(), false), false);
});

test("warn_and_go logs the label and the error, then returns undefined", async (context) => {
    const warn = context.mock.method(console, "warn", () => undefined);
    const error = new Error("boom");
    const result = await Promise.reject(error).catch(warn_and_go("a bridge update failed"));
    assert.equal(result, undefined);
    assert.equal(warn.mock.callCount(), 1);
    assert.deepEqual(warn.mock.calls[0]!.arguments, ["desertfox: a bridge update failed", error]);
});

test("warn_and_go returns its fallback after the warning", async (context) => {
    context.mock.method(console, "warn", () => undefined);
    assert.deepEqual(await Promise.reject(new Error("boom")).catch(warn_and_go("a read", [] as string[])), []);
});
