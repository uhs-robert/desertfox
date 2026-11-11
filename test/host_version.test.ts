import assert from "node:assert/strict";
import { test } from "node:test";
import { compare_release_versions, host_standing, parse_release_version, update_channel } from "../src/shared/host_version.ts";

const order = (a: string, b: string) => Math.sign(compare_release_versions(parse_release_version(a)!, parse_release_version(b)!));

test("a release version is x.y.z with an optional beta number and nothing else", () => {
  assert.deepEqual(parse_release_version("0.1.22"), { major: 0, minor: 1, patch: 22, beta: undefined });
  assert.deepEqual(parse_release_version("1.2.3.4"), { major: 1, minor: 2, patch: 3, beta: 4 });
  for (const bad of ["dev", "", "1.2", "1.2.3.4.5", "1.2.3.0", "1.2.3.01", "1.2.3.", "1.2.3.x", "1.2.3.1234567", "v1.2.3", "1.2.3-beta.4", "1.2.3-rc.1", "1.2.3 ", "1.2.-3", "1234567.0.0", "١.2.3", undefined, null, 3, {}]) {
    assert.equal(parse_release_version(bad), undefined, String(bad));
  }
});

test("versions compare by number, not by text, and a beta sits between its release and the next", () => {
  assert.equal(order("0.1.9", "0.1.10"), -1);
  assert.equal(order("0.2.0", "0.1.99"), 1);
  assert.equal(order("1.0.0", "0.99.99"), 1);
  assert.equal(order("1.2.3", "1.2.3"), 0);
  assert.equal(order("0.1.23", "0.1.23.1"), -1);
  assert.equal(order("0.1.23.1", "0.1.23.2"), -1);
  assert.equal(order("0.1.23.2", "0.1.24"), -1);
  assert.equal(order("1.2.3.2", "1.2.3.10"), -1);
  assert.equal(order("1.2.4", "1.2.3.9"), 1);
});

test("the channel is stable, beta or development", () => {
  assert.equal(update_channel("normal", "0.1.22"), "stable");
  assert.equal(update_channel("normal", "0.2.0.3"), "beta");
  assert.equal(update_channel("sideload", "0.2.0.3"), "beta");
  assert.equal(update_channel("development", "0.1.22"), "development");
  assert.equal(update_channel("development", "0.2.0.3"), "development");
});

test("an older host is outdated, an equal or newer one is current", () => {
  assert.equal(host_standing("0.1.21", "0.1.22"), "outdated");
  assert.equal(host_standing("0.1.22", "0.1.22"), "current");
  assert.equal(host_standing("0.1.23", "0.1.22"), "current");
  assert.equal(host_standing("0.2.0.1", "0.1.22"), "current");
});

test("a beta extension updates the stable host it counts from, and a host that is a later beta stays", () => {
  assert.equal(host_standing("0.2.0", "0.2.0.2"), "outdated");
  assert.equal(host_standing("0.2.0.1", "0.2.0.2"), "outdated");
  assert.equal(host_standing("0.2.0.2", "0.2.0.2"), "current");
  assert.equal(host_standing("0.2.0.2", "0.2.0"), "current");
});

test("a host with no version, or one that is not a version, counts as older", () => {
  assert.equal(host_standing(undefined, "0.1.22"), "outdated");
  assert.equal(host_standing(null, "0.1.22"), "outdated");
  assert.equal(host_standing("", "0.1.22"), "outdated");
  assert.equal(host_standing("garbage", "0.1.22"), "outdated");
  assert.equal(host_standing(7, "0.1.22"), "outdated");
});

test("a development host is left alone", () => {
  assert.equal(host_standing("dev", "0.1.22"), "development");
});

test("an extension with no release version has nothing to match", () => {
  assert.equal(host_standing("0.1.1", "dev"), "current");
  assert.equal(host_standing(undefined, "not-a-version"), "current");
});
