import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import type { SnippetEntry } from "../../src/shared/config.ts";
import { snippet_deps } from "../../src/background/browser_deps.ts";
import { create_snippets, MAX_SNIPPET_DEPTH, type SnippetCall } from "../../src/background/snippets.ts";
import { create_router } from "../../src/background/router.ts";
import { make_fake } from "./fakes.ts";

const PAGE_URL = "https://app.example.com/board?x=1";

function snippet(id: string, code: string, extra: Partial<SnippetEntry> = {}): SnippetEntry {
  return { id, label: id, intent: `Runs ${id}.`, matches: ["https://app.example.com/*"], code, ...extra };
}

// Runs the wrapped code in a fresh context that stands in for the page, with `browser.runtime` wired to the bridge.
function setup(entries: SnippetEntry[], tab_url: string | null = PAGE_URL) {
  const fake = make_fake({
    "other.note": {
      label: "Note",
      intent: "Records a call.",
      params: [{ name: "text", type: "string", main: true }],
      runs_in: "background",
      run: (_context, args) => void fake.log.push(`note ${String(args.text)}`),
    },
  });
  const executions: { tab_id: number; code: string }[] = [];
  let snippets!: ReturnType<typeof create_snippets>;
  const deps = {
    tab_url: async () => tab_url ?? undefined,
    execute_in_top_frame: async (tab_id: number, code: string) => {
      executions.push({ tab_id, code });
      const sandbox = {
        location: { href: tab_url },
        log: (text: string) => fake.log.push(text),
        browser: { runtime: { sendMessage: (call: SnippetCall) => snippets.handle_call(call, { tab_id, frame_id: 0 }) } },
      };
      return runInNewContext(code, sandbox);
    },
  };
  snippets = create_snippets(fake.registry, deps, fake.deps);
  const warnings = snippets.register(entries);
  const router = create_router({ ...fake.deps, get_command: (id) => fake.registry.get(id) });
  const press = (id: string, args: Record<string, unknown> = {}) => router.run({ invocations: [{ id, args }], mode: "normal", sender_tab_id: 7 });
  return { fake, executions, warnings, press };
}

test("a snippet runs on a matching page and receives its args", async () => {
  const { press, fake, executions } = setup([
    snippet("app.show", "log('got ' + args.query + ' ' + args.all)", {
      params: [
        { name: "query", type: "string", main: true },
        { name: "all", type: "bool", default: false },
      ],
    }),
  ]);
  assert.deepEqual(await press("app.show", { query: "abc", all: true }), { ok: true });
  assert.equal(executions.length, 1);
  assert.deepEqual(fake.log, ["got abc true"]);
});

test("the body sees neither browser nor chrome, but oasisfox.run still works", async () => {
  const { press, fake } = setup([
    snippet("app.peek", "log(typeof browser + ' ' + typeof chrome + ' ' + typeof send + ' ' + typeof expected_url); await oasisfox.run('other.note hi')"),
  ]);
  assert.deepEqual(await press("app.peek"), { ok: true });
  assert.ok(fake.log.includes("undefined undefined undefined undefined"));
  assert.ok(fake.log.includes("note hi"));
});

test("top-level await works in the body", async () => {
  const { press, fake } = setup([snippet("app.wait", "await Promise.resolve(); log('after await')")]);
  assert.deepEqual(await press("app.wait"), { ok: true });
  assert.deepEqual(fake.log, ["after await"]);
});

test("a snippet never runs where its matches do not name the page", async () => {
  for (const url of [
    "https://other.example.org/board",
    "http://app.example.com/board",
    "https://evil.test/?x=@app.example.com/",
    "https://app.example.com.evil.test/board",
    "about:blank",
    null,
  ]) {
    const { press, executions, fake } = setup([snippet("app.show", "log('ran')")], url);
    const response = await press("app.show");
    assert.equal(response.ok, false, `ran on ${url}`);
    assert.equal(executions.length, 0, `injected on ${url}`);
    assert.deepEqual(
      fake.log.filter((line) => line === "ran"),
      [],
    );
  }
});

test("the refusal on a wrong page names the snippet id", async () => {
  const { press, fake } = setup([snippet("app.show", "log('ran')")], "https://other.example.org/");
  await press("app.show");
  assert.match(fake.log.join("\n"), /refuse 7 app\.show: does not run on this page/);
});

test("an error in the snippet reaches the toast with the id, and the next run still works", async () => {
  const { press, fake } = setup([snippet("app.boom", "throw new Error('bad thing')"), snippet("app.fine", "log('fine')")]);
  const failed = await press("app.boom");
  assert.deepEqual(failed.ok, false);
  assert.ok(fake.log.includes("refuse 7 app.boom: bad thing"));
  assert.deepEqual(await press("app.fine"), { ok: true });
  assert.ok(fake.log.includes("fine"));
});

test("a rejected promise and a syntax error both reach the toast", async () => {
  const { press, fake } = setup([snippet("app.reject", "await Promise.reject(new Error('later'))"), snippet("app.syntax", "let = ;")]);
  await press("app.reject");
  await press("app.syntax");
  assert.ok(fake.log.includes("refuse 7 app.reject: later"));
  assert.ok(fake.log.some((line) => line.startsWith("refuse 7 app.syntax: ")));
});

test("a snippet can run another command through oasisfox.run", async () => {
  const { press, fake } = setup([snippet("app.caller", "await oasisfox.run('other.note hello world')")]);
  assert.deepEqual(await press("app.caller"), { ok: true });
  assert.ok(fake.log.includes("note hello world"));
});

test("oasisfox.run rejects on a bad command, and the snippet can catch it", async () => {
  const { press, fake } = setup([
    snippet("app.caller", "try { await oasisfox.run('nothing_like_it') } catch (error) { log('caught ' + error.message) }"),
  ]);
  assert.deepEqual(await press("app.caller"), { ok: true });
  assert.ok(fake.log.some((line) => line.startsWith("caught unknown command")));
});

test("a snippet that calls itself stops at the depth limit", async () => {
  const { press, fake, executions } = setup([snippet("app.loop", "log('level'); await oasisfox.run('app.loop')")]);
  const response = await press("app.loop");
  assert.equal(response.ok, false);
  assert.equal(executions.length, MAX_SNIPPET_DEPTH);
  assert.equal(fake.log.filter((line) => line === "level").length, MAX_SNIPPET_DEPTH);
  assert.match(fake.log.filter((line) => line.startsWith("refuse")).join(""), /5 levels deep at most/);
});

test("a nested call keeps the match gate", async () => {
  const { press, fake } = setup([
    snippet("app.outer", "await oasisfox.run('site.inner')"),
    snippet("site.inner", "log('inner ran')", { matches: ["https://nowhere.test/*"] }),
  ]);
  const response = await press("app.outer");
  assert.equal(response.ok, false);
  assert.ok(!fake.log.includes("inner ran"));
});

test("the code is refused when the page changed after the match check", async () => {
  const fake = make_fake({});
  const code_seen: string[] = [];
  const snippets = create_snippets(
    fake.registry,
    {
      tab_url: async () => PAGE_URL,
      execute_in_top_frame: async (_tab_id, code) => {
        code_seen.push(code);
        return runInNewContext(code, { location: { href: "https://evil.test/" }, browser: { runtime: { sendMessage: () => undefined } }, log: () => {} });
      },
    },
    fake.deps,
  );
  snippets.register([snippet("app.show", "log('ran')")]);
  const response = await create_router(fake.deps).run({ invocations: [{ id: "app.show" }], mode: "normal", sender_tab_id: 7 });
  assert.equal(response.ok, false);
  assert.equal(code_seen.length, 1);
  assert.ok(fake.log.some((line) => line.includes("the page changed before the snippet ran")));
});

test("a snippet in a built-in group is skipped with a warning", () => {
  const { warnings, executions } = setup([snippet("other.mine", "log(1)")]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /group "other"/);
  assert.equal(executions.length, 0);
});

test("a clashing snippet is skipped with a warning", () => {
  const { warnings } = setup([snippet("app.ok", "log(2)"), snippet("app.ok", "log(3)")]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0] ?? "", /app\.ok/);
});

test("the browser call injects into frame 0 only", async () => {
  const calls: unknown[] = [];
  (globalThis as unknown as { browser: unknown }).browser = {
    tabs: {
      get: async () => ({ url: PAGE_URL }),
      executeScript: async (tab_id: number, details: unknown) => {
        calls.push([tab_id, details]);
        return [null];
      },
    },
  };
  assert.equal(await snippet_deps.tab_url(3), PAGE_URL);
  await snippet_deps.execute_in_top_frame(3, "1");
  assert.deepEqual(calls, [[3, { code: "1", frameId: 0, runAt: "document_idle" }]]);
  delete (globalThis as unknown as { browser?: unknown }).browser;
});

test("a snippet_run message from a frame other than the top one is refused", async () => {
  const { fake } = setup([snippet("app.show", "log('ran')")]);
  const snippets = create_snippets(fake.registry, { tab_url: async () => PAGE_URL, execute_in_top_frame: async () => null }, fake.deps);
  const call = { type: "snippet_run", command_text: "other.note hi", depth: 1 } as const;
  assert.equal((await snippets.handle_call(call, { tab_id: 7, frame_id: 3 })).ok, false);
  assert.equal((await snippets.handle_call(call, { tab_id: 7, frame_id: undefined })).ok, false);
  assert.ok(!fake.log.includes("note hi"));
  assert.equal((await snippets.handle_call(call, { tab_id: 7, frame_id: 0 })).ok, true);
  assert.ok(fake.log.includes("note hi"));
});

test("a snippet that requires a slot runs where the page fills it and refuses elsewhere", async () => {
  const code = "log('ran')";
  const repo = setup([snippet("app.repo", code, { matches: ["https://github.com/*"], requires: ["repo"] })], "https://github.com/octo/cat");
  assert.deepEqual(await repo.press("app.repo"), { ok: true });
  assert.deepEqual(repo.fake.log, ["ran"]);

  const elsewhere = setup([snippet("app.repo", code, { matches: ["https://github.com/*"], requires: ["repo"] })], "https://github.com/octo");
  const response = await elsewhere.press("app.repo");
  assert.equal(response.ok, false);
  assert.match(JSON.stringify(response), /not in a GitHub repository/);
  assert.ok(!elsewhere.fake.log.includes("ran"));
});
