import { build } from "esbuild";

// The esbuild options of tools/build.mjs, for a test that builds on its own. Nothing is written: that script clears dist/, which a key test may be reading. Property mangling does not change which files enter a bundle, so a test that reads sizes or contents of the mangled output builds through tools/build.mjs instead.
export const release_options = (entry: Record<string, string>, key_test = false) =>
  ({
    bundle: true,
    format: "iife",
    target: "firefox140",
    logLevel: "silent",
    entryPoints: entry,
    write: false,
    minify: true,
    mangleProps: /_$/,
    define: { __KEY_TEST__: String(key_test) },
  }) as const;

export async function shipped_sources(entry: string): Promise<string[]> {
  const result = await build({ ...release_options({ entry }), metafile: true });
  const outputs = Object.values(result.metafile.outputs);
  // A file that is imported but tree-shaken to nothing (a barrel) puts no code in the bundle.
  return Object.entries(outputs[0]!.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => path)
    .sort();
}
