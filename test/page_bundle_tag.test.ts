import assert from "node:assert/strict";
import { test } from "node:test";
import { answer_bundle_request, create_bundle_tag_adder } from "../src/shared/page_bundle_tag.ts";

type FakeTag = { src: string; removed: boolean; onload?: () => void; onerror?: () => void; remove: () => void };

function fake_document() {
  const tags: FakeTag[] = [];
  const doc = {
    createElement: () => {
      const tag: FakeTag = { src: "", removed: false, remove: () => void (tag.removed = true) };
      return tag;
    },
    head: { append: (tag: FakeTag) => void tags.push(tag) },
  } as unknown as Document;
  return { doc, tags };
}

test("two asks for one file while it loads add one tag, and both wait for onload", async () => {
  const { doc, tags } = fake_document();
  const add = create_bundle_tag_adder(doc);
  let done = 0;
  const first = add("text.js").then(() => done++);
  const second = add("text.js").then(() => done++);
  await Promise.resolve();
  assert.equal(tags.length, 1);
  assert.equal(done, 0);
  tags[0]!.onload!();
  await Promise.all([first, second]);
  assert.equal(done, 2);
});

test("a tag that fails is removed and the next ask adds a new one", async () => {
  const { doc, tags } = fake_document();
  const add = create_bundle_tag_adder(doc);
  const failed = add("text.js");
  tags[0]!.onerror!();
  await assert.rejects(failed, /text.js did not load/);
  assert.equal(tags[0]!.removed, true);
  const retry = add("text.js");
  assert.equal(tags.length, 2);
  tags[1]!.onload!();
  await retry;
});

test("the answer is a refusal for a failed tag and for a file that is not a bundle", async () => {
  assert.deepEqual(await answer_bundle_request(() => Promise.resolve(), { type: "add_bundle_script", file: "grab.js" }), { ok: true });
  assert.deepEqual(await answer_bundle_request(() => Promise.reject(new Error("boom")), { type: "add_bundle_script", file: "grab.js" }), { ok: false, message: "boom" });
  const refused = await answer_bundle_request(() => Promise.resolve(), { type: "add_bundle_script", file: "evil.js" });
  assert.equal(refused.ok, false);
});
