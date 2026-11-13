import tseslint from "typescript-eslint";

// test/ is out of scope: node:test calls `test(...)` return promises, which is thousands of hits that are not bugs.
// Only the two promise rules: they catch a promise nobody awaits and a promise handed to a callback that ignores it. No style rules, no formatter.
export default tseslint.config(
    { ignores: ["dist/", "node_modules/", "web-ext-artifacts/"] },
    {
        files: ["src/**/*.ts", "tools/**/*.ts"],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
        },
        linterOptions: { reportUnusedDisableDirectives: "off" },
        plugins: { "@typescript-eslint": tseslint.plugin },
        rules: {
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-misused-promises": "error",
        },
    },
);
