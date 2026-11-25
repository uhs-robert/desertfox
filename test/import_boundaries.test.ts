import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, posix } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { CONTENT_EXCEPTIONS, EXCEPTIONS } from "./import_boundaries.ts";

const PAGE_FOLDERS = ["help", "newtab", "popup", "devtools", "cmdline"];
const ALLOWED_FOLDERS: Record<string, string[]> = {
  shared: ["shared"],
  content: ["content", "shared"],
  commands: ["commands", "background", "shared"],
  background: ["background", "shared"],
  ...Object.fromEntries(PAGE_FOLDERS.map((folder) => [folder, [folder, "shared"]])),
};
// Files that may import another folder besides the ones above: the wiring that builds the background, and the cmdline bundle that is a content script.
const EXTRA_FOLDER: Record<string, string> = {
  "background/command_modules.ts": "commands",
  "background/main.ts": "commands",
  "cmdline/host.ts": "content",
};

const root = new URL("../", import.meta.url);
const sources = readdirSync(new URL("src", root), { recursive: true, encoding: "utf8" })
  .filter((path) => path.endsWith(".ts") && !path.endsWith(".d.ts"))
  .sort();

// Import declarations, `export ... from`, `import()` calls and `import("...")` types, read from the syntax tree, so a comment or a string never adds or hides an edge. `import type` counts like any import. Only string-literal relative specifiers are followed.
export function relative_specifiers(source: string): string[] {
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    const specifier =
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node)
        ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
          ? node.arguments[0]
          : ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)
            ? node.argument.literal
            : undefined;
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) found.push(specifier.text);
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true));
  return found;
}

const edges = new Set<string>();
for (const file of sources) {
  for (const specifier of relative_specifiers(readFileSync(new URL(`src/${file}`, root), "utf8"))) {
    edges.add(`${file} -> ${posix.normalize(posix.join(dirname(file), specifier))}`);
  }
}

const folder_of = (path: string) => path.split("/")[0]!;
const is_allowed = (from: string, to: string) =>
  folder_of(from) === folder_of(to) || ALLOWED_FOLDERS[folder_of(from)]?.includes(folder_of(to)) === true || EXTRA_FOLDER[from] === folder_of(to);
const forbidden = [...edges].filter((edge) => {
  const [from, to] = edge.split(" -> ") as [string, string];
  return !is_allowed(from, to);
});

test("every import between src folders follows the one-way rule or is a listed exception", () => {
  const unlisted = forbidden.filter((edge) => !(edge in EXCEPTIONS));
  assert.deepEqual(
    unlisted,
    [],
    `These imports break the folder rule in AGENTS.md. Move the shared code into src/shared instead of adding an exception:\n${unlisted.join("\n")}`,
  );
});

test("every listed exception is still a forbidden import", () => {
  const stale = Object.keys(EXCEPTIONS).filter((edge) => !forbidden.includes(edge));
  assert.deepEqual(stale, [], `These exceptions no longer match an import. Remove them from test/import_boundaries.ts:\n${stale.join("\n")}`);
});

// A src/content folder other than lib, or a root file (folder ""). handlers/ is the core command folder that the root may import. cmdline/host.ts counts as a root file, so it may not import a bundle folder either.
const CONTENT_ROOT_IMPORTERS = ["cmdline/host.ts"];
const content_folder_of = (path: string) => {
  if (CONTENT_ROOT_IMPORTERS.includes(path)) return "";
  const parts = path.split("/");
  return parts.length > 2 ? parts[1]! : "";
};
const is_content_cross_bundle = (edge: string) => {
  const [from, to] = edge.split(" -> ") as [string, string];
  if (!(from.startsWith("content/") || CONTENT_ROOT_IMPORTERS.includes(from)) || !to.startsWith("content/")) return false;
  const [from_folder, to_folder] = [content_folder_of(from), content_folder_of(to)];
  if (to_folder === "" || to_folder === "lib" || from_folder === to_folder) return false;
  return !(from_folder === "" && to_folder === "handlers");
};
const content_forbidden = [...edges].filter(is_content_cross_bundle);

test("no content bundle imports another bundle folder unless listed", () => {
  const unlisted = content_forbidden.filter((edge) => !(edge in CONTENT_EXCEPTIONS));
  assert.deepEqual(
    unlisted,
    [],
    `These imports break the content rule in AGENTS.md. Move the shared code into src/content/lib instead of adding an exception:\n${unlisted.join("\n")}`,
  );
});

test("every listed content exception is still a cross-bundle import", () => {
  const stale = Object.keys(CONTENT_EXCEPTIONS).filter((edge) => !content_forbidden.includes(edge));
  assert.deepEqual(stale, [], `These content exceptions no longer match an import. Remove them from test/import_boundaries.ts:\n${stale.join("\n")}`);
});

test("every content exception is permanent", () => {
  const unnamed = Object.entries(CONTENT_EXCEPTIONS).filter(([, owner]) => !/^permanent$/.test(owner));
  assert.deepEqual(unnamed, []);
  const permanent = Object.entries(CONTENT_EXCEPTIONS).filter(([, owner]) => owner === "permanent");
  assert.ok(permanent.every(([edge]) => edge.startsWith("content/media/") && edge.includes("-> content/quality/")), "only media to quality is permanent");
});

// Type-only imports are erased, so only a runtime import carries config_build code into a bundle.
export function runtime_relative_specifiers(source: string): string[] {
  const found: string[] = [];
  const add = (specifier: ts.Node | undefined) => {
    if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) found.push(specifier.text);
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const all_type_names = bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly);
      if (!(clause?.isTypeOnly || (all_type_names && clause?.name === undefined))) add(node.moduleSpecifier);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly) add(node.moduleSpecifier);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile("scan.ts", source, ts.ScriptTarget.Latest, true));
  return found;
}

test("only the background and config_build itself import config_build at runtime", () => {
  const offenders: string[] = [];
  for (const file of sources) {
    if (file.startsWith("background/") || file.startsWith("shared/config_build/")) continue;
    for (const specifier of runtime_relative_specifiers(readFileSync(new URL(`src/${file}`, root), "utf8"))) {
      const target = posix.normalize(posix.join(dirname(file), specifier));
      if (target.startsWith("shared/config_build/")) offenders.push(`${file} -> ${target}`);
    }
  }
  assert.deepEqual(offenders, [], `These files bundle config_build code outside the background. Move the value they need into src/shared:\n${offenders.join("\n")}`);
});

test("the runtime scan skips type-only imports and keeps value imports", () => {
  const found = (source: string) => runtime_relative_specifiers(source);
  assert.deepEqual(found('import type { T } from "./t.ts";'), []);
  assert.deepEqual(found('import { type T } from "./t.ts";'), []);
  assert.deepEqual(found('export type { U } from "./u.ts";'), []);
  assert.deepEqual(found('import { a, type T } from "./a.ts";'), ["./a.ts"]);
  assert.deepEqual(found('export { b } from "./b.ts";\nimport "./side.ts";'), ["./b.ts", "./side.ts"]);
  assert.deepEqual(found('const m = await import("./dyn.ts");'), ["./dyn.ts"]);
});

test("every exception names the cluster that removes it", () => {
  const unnamed = Object.entries(EXCEPTIONS).filter(([, cluster]) => !/^C([1-9]|10)$/.test(cluster));
  assert.deepEqual(unnamed, []);
});

test("the extractor finds each import form and ignores comments and strings", () => {
  const found = (source: string) => relative_specifiers(source);
  assert.deepEqual(found('import { a } from "./a.ts";'), ["./a.ts"]);
  assert.deepEqual(found('import type { T } from "./t.ts";'), ["./t.ts"]);
  assert.deepEqual(found('export { b } from "./b.ts";\nexport type { U } from "./u.ts";'), ["./b.ts", "./u.ts"]);
  assert.deepEqual(found('import "./side.ts";'), ["./side.ts"]);
  assert.deepEqual(found('const m = await import("./dyn.ts");'), ["./dyn.ts"]);
  assert.deepEqual(found("const s = \"import x from './s.ts'\";\n// import y from './c.ts'"), []);
  assert.deepEqual(found('/* c */ import { d } from "./d.ts";'), ["./d.ts"]);
  assert.deepEqual(found('import { z } from "pkg";'), []);
  assert.deepEqual(found('type A = typeof import("./t.ts");\ntype B = import("./u.ts").Foo;'), ["./t.ts", "./u.ts"]);
});
