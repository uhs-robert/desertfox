import tseslint from "typescript-eslint";

// test/ is out of scope: node:test calls `test(...)` return promises, which is thousands of hits that are not bugs.
// The two promise rules catch a promise nobody awaits and a promise handed to a callback that ignores it. A third rule bans a silent `.catch` handler: name the reason with a helper from src/shared/swallow.ts. No style rules, no formatter.
// Silent means a handler that cannot act on the error, in `.catch(h)` or as the second argument of `.then(ok, h)`. Without a parameter, the body is empty, returns nothing, or is a bare value instead of an action (`() => undefined`, `function () {}`, `() => { return []; }`). A call, await, assignment, `void log(x)` or `fn?.()` acts and is spared. With a parameter, only a constant body counts (`_e => undefined`, `(error) => []`), because a body such as `error.message` may use the error.
// A handler passed as an identifier (`.catch(noop)`) is not checked: that needs scope analysis. src/shared/swallow.ts is exempt in the config below, since the helpers live there. There is no comment escape except an `eslint-disable-next-line` with a reason, for a site a bundle size guard forces inline.
const ACTING = "/^(CallExpression|AwaitExpression|ChainExpression|AssignmentExpression|UpdateExpression|UnaryExpression|SequenceExpression)$/";

function constant_at(path) {
    return [
        `[${path}.type='Literal']`,
        `[${path}.type='TSAsExpression'][${path}.expression.type='Literal']`,
        `[${path}.type='TSAsExpression'][${path}.expression.type='ArrayExpression'][${path}.expression.elements.length=0]`,
        `[${path}.type='Identifier'][${path}.name='undefined']`,
        `[${path}.type='ArrayExpression'][${path}.elements.length=0]`,
        `[${path}.type='ObjectExpression'][${path}.properties.length=0]`,
        `[${path}.type='NewExpression'][${path}.arguments.length=0]`,
    ];
}

function silent_handler(method, position) {
    const handler = `arguments.${position}`;
    const body = `${handler}.body`;
    const first = `${body}.body.0`;
    const call = `CallExpression[callee.property.name='${method}'][${handler}.type=/^(ArrowFunctionExpression|FunctionExpression)$/]`;
    const block = `[${body}.type='BlockStatement']`;
    const expression = `[${body}.type!='BlockStatement']`;
    const empty_block = `${block}[${body}.body.length=0]`;
    const lone_return = `${block}[${body}.body.length=1][${first}.type='ReturnStatement']`;
    const bare = `[${handler}.params.length=0]`;
    const with_param = `:not(${bare})`;
    return [
        `${call}${bare}${expression}[${body}.type!=${ACTING}]`,
        `${call}${bare}${empty_block}`,
        `${call}${bare}${lone_return}:not([${first}.argument])`,
        `${call}${bare}${lone_return}[${first}.argument.type!=${ACTING}]`,
        ...constant_at(body).map((condition) => `${call}${with_param}${expression}${condition}`),
        `${call}${with_param}${empty_block}`,
        `${call}${with_param}${lone_return}:not([${first}.argument])`,
        ...constant_at(`${first}.argument`).map((condition) => `${call}${with_param}${lone_return}${condition}`),
    ];
}

export const SILENT_CATCH_HANDLER = [...silent_handler("catch", 0), ...silent_handler("then", 1)].join(", ");

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
            "no-restricted-syntax": ["error", { selector: SILENT_CATCH_HANDLER, message: "Silent .catch: name the reason with a helper from src/shared/swallow.ts, or log with warn_and_go." }],
        },
    },
    // The helpers are the one sanctioned place for a silent handler.
    { files: ["src/shared/swallow.ts"], rules: { "no-restricted-syntax": "off" } },
);
