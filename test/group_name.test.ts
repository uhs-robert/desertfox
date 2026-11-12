import assert from "node:assert/strict";
import { test } from "node:test";
import { find_group, group_labels } from "../src/shared/group_name.ts";

test("a unique title is its own label, a repeated or empty title gets the id suffix", () => {
  const labels = group_labels([{ id: 1, title: "Work" }, { id: 2, title: "Play" }, { id: 3, title: "Play" }, { id: 4, title: "" }, { id: 5, title: "  " }]);
  assert.deepEqual([...labels.values()], ["Work", "Play #2", "Play #3", "#4", "#5"]);
});

test("a label or a unique bare title picks one group, and a repeated bare title is ambiguous", () => {
  const groups = [{ id: 1, title: "Work" }, { id: 2, title: "Play" }, { id: 3, title: "Play" }, { id: 4, title: "" }];
  assert.deepEqual(find_group(groups, "Work"), { kind: "found", id: 1 });
  assert.deepEqual(find_group(groups, "Play #3"), { kind: "found", id: 3 });
  assert.deepEqual(find_group(groups, "#4"), { kind: "found", id: 4 });
  assert.deepEqual(find_group(groups, "Play"), { kind: "ambiguous", ids: [2, 3] });
  assert.deepEqual(find_group(groups, "Nothing"), { kind: "none" });
  assert.deepEqual(find_group(groups, "  "), { kind: "none" });
});

test("a generated label never equals another group's literal title, and every label picks one group", () => {
  const groups = [{ id: 1, title: "Play" }, { id: 2, title: "Play" }, { id: 3, title: "Play #1" }, { id: 4, title: "" }, { id: 5, title: "#4" }];
  const labels = group_labels(groups);
  assert.equal(new Set(labels.values()).size, groups.length);
  assert.equal(labels.get(3), "Play #1");
  assert.equal(labels.get(5), "#4");
  for (const group of groups) assert.deepEqual(find_group(groups, labels.get(group.id)!), { kind: "found", id: group.id });
});
