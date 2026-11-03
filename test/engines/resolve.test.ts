import assert from "node:assert/strict";
import { test } from "node:test";
import { parse } from "smol-toml";
import { nodes_of_file, resolve_engines } from "../../src/shared/engines/resolve.ts";

// Several files model a child in a later file, where TOML itself cannot see the clash with a parent field.
function resolve(...files: string[]) {
  const problems: string[] = [];
  const nodes = files.flatMap((toml, index) => nodes_of_file(`t${index}.toml`, structuredClone(parse(toml)), problems));
  const resolved = resolve_engines(nodes);
  return { engines: resolved.engines, problems: [...problems, ...resolved.problems] };
}

const GITHUB = `
[github]
label = "GitHub"
url = "https://github.com/search?q={scope}{query}&type={type}"
scope = ""

[github.params.type]
default = "code"
children = true
values = { code = "code", issues = "issues", prs = "pullrequests", repos = "repositories", any = "" }

[github.repo]
label = "this repo"
scope = "repo:{repo} "
type = { only = ["code", "issues", "prs"] }
`;

test("the GitHub tree resolves to generated children at both levels", () => {
  const { engines, problems } = resolve(GITHUB);
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(engines).sort(), [
    "github", "github.any", "github.code", "github.issues", "github.prs", "github.repo", "github.repo.code", "github.repo.issues", "github.repo.prs", "github.repos",
  ]);
  assert.equal(engines["github.issues"]?.url, "https://github.com/search?q={query}&type=issues");
  assert.equal(engines["github.repo.prs"]?.url, "https://github.com/search?q=repo:{repo} {query}&type=pullrequests");
  assert.deepEqual(engines["github.repo.prs"]?.slots, ["repo"]);
  assert.equal(engines["github.issues"]?.slots, undefined);
});

test("labels are the chain of the labels on the path", () => {
  const { engines } = resolve(GITHUB);
  assert.equal(engines.github?.label, "GitHub");
  assert.equal(engines["github.repo"]?.label, "GitHub: this repo");
  assert.equal(engines["github.repo.issues"]?.label, "GitHub: this repo: issues");
});

test("an empty param leaves its query pair out", () => {
  const { engines } = resolve(GITHUB);
  assert.equal(engines["github.any"]?.url, "https://github.com/search?q={query}");
});

test("a default applies when no value is assigned", () => {
  assert.equal(resolve(GITHUB).engines.github?.url, "https://github.com/search?q={query}&type=code");
});

test("a hand child overrides a generated one and an own label wins", () => {
  const { engines, problems } = resolve(`${GITHUB}
[github.issues]
label = "Issues!"
url = "https://example.com/{query}"
`);
  assert.deepEqual(problems, []);
  assert.equal(engines["github.issues"]?.url, "https://example.com/{query}");
  assert.equal(engines["github.issues"]?.label, "GitHub: Issues!");
});

test("a child inherits fields and overrides by name, to depth three", () => {
  const { engines, problems } = resolve(`
[a]
label = "A"
url = "https://a.com/?q=%s"
fallback = "a"
[a.b]
label = "B"
[a.b.c]
url = "https://c.com/?q={query}"
`);
  assert.deepEqual(problems.filter((problem) => !problem.includes("fallback")), []);
  assert.equal(engines["a.b"]?.url, "https://a.com/?q={query}");
  assert.equal(engines["a.b.c"]?.url, "https://c.com/?q={query}");
  assert.equal(engines["a.b.c"]?.label, "A: B: c");
  assert.equal(engines["a.b.c"]?.fallback, "a");
});

test("a value outside the declared list is a problem", () => {
  assert.match(resolve(`${GITHUB}\n[github.repo.x]\ntype = "nope"\nurl = "https://x.com/{type}{query}"\n`).problems.join("\n"), /outside the declared list/);
  assert.match(resolve(GITHUB.replace('"issues", "prs"]', '"issues", "bogus"]')).problems.join("\n"), /outside the declared list/);
});

test("a param no url uses is a problem", () => {
  const { problems } = resolve(`
[x]
url = "https://x.com/?q={query}"
[x.params.kind]
values = { a = "a" }
`);
  assert.match(problems.join("\n"), /param "kind" is not used/);
});

test("an unknown slot is a problem", () => {
  assert.match(resolve('[x]\nurl = "https://x.com/{nope}?q={query}"').problems.join("\n"), /unknown slot \{nope\}/);
});

test("a url without a query slot is a problem", () => {
  assert.match(resolve('[x]\nurl = "https://x.com/"').problems.join("\n"), /no \{query\}/);
});

test("reserved child names are rejected", () => {
  for (const name of ["url", "label", "fallback", "scope", "type"]) {
    const { problems } = resolve(GITHUB, `[github.${name}]\nurl = "https://x.com/{query}"\n`);
    assert.match(problems.join("\n"), /reserved or names a field or param/, name);
  }
});

test("a var that refers to itself is a problem", () => {
  assert.match(resolve('[x]\nurl = "https://x.com/{a}{query}"\na = "{b}"\nb = "{a}"').problems.join("\n"), /refer to each other/);
});

test("a child with no parent is a problem", () => {
  assert.match(resolve('[x]\nurl = "https://x.com/{query}"', '[y.z]\nurl = "https://x.com/{query}"').problems.join("\n"), /no url|no parent engine/);
});
