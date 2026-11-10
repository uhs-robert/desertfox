import assert from "node:assert/strict";
import { test } from "node:test";
import { create_session_flag } from "../../src/content/text/session_flag.ts";

test("an answer to the current session closes it", () => {
  const flag = create_session_flag();
  const generation = flag.open_();
  assert.equal(flag.is_open_(), true);
  flag.close_if_current_(generation);
  assert.equal(flag.is_open_(), false);
});

test("an older answer cannot close a newer session", () => {
  const flag = create_session_flag();
  const older = flag.open_();
  flag.close_();
  const newer = flag.open_();
  flag.close_if_current_(older);
  assert.equal(flag.is_open_(), true);
  flag.close_if_current_(newer);
  assert.equal(flag.is_open_(), false);
});
