import { build } from "esbuild";

// Same options as tools/build.mjs, but written nowhere: that script clears dist/, which a key test may be reading. Property mangling does not change which files enter a bundle.
export async function shipped_sources(entry: string): Promise<string[]> {
  const result = await build({
    bundle: true,
    format: "iife",
    target: "firefox140",
    logLevel: "silent",
    entryPoints: { entry },
    write: false,
    minify: true,
    metafile: true,
    mangleProps: /_$/,
    define: { __KEY_TEST__: "false" },
  });
  const outputs = Object.values(result.metafile.outputs);
  // A file that is imported but tree-shaken to nothing (a barrel) puts no code in the bundle.
  return Object.entries(outputs[0]!.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => path)
    .sort();
}
