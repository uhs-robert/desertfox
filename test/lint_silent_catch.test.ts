import assert from "node:assert/strict";
import { test } from "node:test";
import { Linter } from "eslint";
import tseslint from "typescript-eslint";
// @ts-expect-error The config is plain JS and exports the selector for this test.
import { SILENT_CATCH_HANDLER } from "../eslint.config.mjs";

const linter = new Linter();

function hits(code: string): number {
    const messages = linter.verify(
        code,
        [{ files: ["**/*.ts"], languageOptions: { parser: tseslint.parser }, rules: { "no-restricted-syntax": ["warn", { selector: SILENT_CATCH_HANDLER as string }] } }],
        "sample.ts",
    );
    assert.deepEqual(messages.filter((message) => message.fatal), []);
    return messages.length;
}

test("the silent catch rule hits a handler that ignores its error", () => {
    assert.equal(hits("p.catch(() => undefined);"), 1);
    assert.equal(hits("p.catch(() => {});"), 1);
    assert.equal(hits("p.catch((): string[] => []);"), 1);
    assert.equal(hits("p.catch((): Map<string, number> => new Map());"), 1);
    assert.equal(hits("p.catch(() => false as const);"), 1);
    assert.equal(hits("p.catch(() => ({}));"), 1);
    assert.equal(hits("p.catch(() => null);"), 1);
    assert.equal(hits("void a.b().catch(() => undefined);"), 1);
    assert.equal(hits("p.catch(_e => undefined);"), 1);
    assert.equal(hits("p.catch((error) => []);"), 1);
    assert.equal(hits("p.catch((error) => undefined);"), 1);
    assert.equal(hits("p.catch((_) => {});"), 1);
    assert.equal(hits("p.catch(function () {});"), 1);
    assert.equal(hits("p.catch(() => { return; });"), 1);
    assert.equal(hits("p.catch(() => { return undefined; });"), 1);
    assert.equal(hits("p.catch(() => { return []; });"), 1);
    assert.equal(hits("p.catch((e) => { return false; });"), 1);
    assert.equal(hits("p.then(ok, () => undefined);"), 1);
    assert.equal(hits("p.then(undefined, () => false);"), 1);
    assert.equal(hits("p.then(() => true, (_e) => false);"), 1);
});

test("the silent catch rule spares helpers, logging handlers and handlers that act", () => {
    assert.equal(hits("p.catch(warn_and_go('x'));"), 0);
    assert.equal(hits("p.catch(ignore_refusal);"), 0);
    assert.equal(hits("ignore_refusal(p);"), 0);
    assert.equal(hits("p.catch((error: unknown) => console.warn('x', error));"), 0);
    assert.equal(hits("p.catch((error) => error.message);"), 0);
    assert.equal(hits("p.catch(() => void log(x));"), 0);
    assert.equal(hits("p.catch(() => (flag = true));"), 0);
    assert.equal(hits("p.catch(() => fn?.());"), 0);
    assert.equal(hits("p.catch(() => { return log(x); });"), 0);
    assert.equal(hits("p.catch(function (error) { report(error); });"), 0);
    assert.equal(hits("p.then(ok, warn_and_go('x'));"), 0);
    assert.equal(hits("p.then(ok, (error) => log(error));"), 0);
    assert.equal(hits("p.then((tab) => tab.url);"), 0);
    assert.equal(hits("p.catch(() => console.warn('x'));"), 0);
    assert.equal(hits("p.catch(() => { console.warn('x'); });"), 0);
    assert.equal(hits("p.catch(() => { throw new Error('x'); });"), 0);
    assert.equal(hits("p.catch(() => finish('gone'));"), 0);
});
