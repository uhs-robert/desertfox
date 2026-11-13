import tseslint from "typescript-eslint";

// test/ is out of scope: node:test calls `test(...)` return promises, which is thousands of hits that are not bugs.
// The two promise rules catch a promise nobody awaits and a promise handed to a callback that ignores it. A third rule bans a silent `.catch` handler: name the reason with a helper from src/shared/swallow.ts. No style rules, no formatter.
// Silent means a handler with no parameter whose body is empty or a bare value (`() => undefined`, `() => {}`, `(): T => x`). A body that calls something (a log, a helper) or a block with statements is spared. There is no comment escape.
// Severity is warn until the sweep ends, then error.
export const SILENT_CATCH_HANDLER = [
    "CallExpression[callee.property.name='catch'][arguments.0.type='ArrowFunctionExpression'][arguments.0.params.length=0]",
    "[arguments.0.body.type!='CallExpression'][arguments.0.body.type!='AwaitExpression']",
    ":not([arguments.0.body.type='BlockStatement'][arguments.0.body.body.length>0])",
].join("");

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
            "no-restricted-syntax": ["warn", { selector: SILENT_CATCH_HANDLER, message: "Silent .catch: name the reason with a helper from src/shared/swallow.ts, or log with warn_and_go." }],
        },
    },
);
