// bot/effect-fn (eslint/effect-fn.js), the lint behind CODING_STANDARDS.md's "a function that
// returns an Effect is Effect.fn". The rule reads types, so each case is typed as a file in
// test/, where `effect` resolves to the bot's own copy. ESLint and typescript-eslint come from
// the repo root's install (docs/linting.md).
import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { describe, it } from "vitest";
import rule from "../eslint/effect-fn.js";

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      projectService: { allowDefaultProject: ["test/*.ts"] },
      tsconfigRootDir: new URL("..", import.meta.url).pathname,
    },
  },
});

const header = `import { Context, Effect, Layer } from "effect";\n`;
const filename = new URL("./effect-fn-case.ts", import.meta.url).pathname;
const at = (code) => ({ code: header + code, filename });
const fails = (code, name) => ({
  ...at(code),
  errors: [{ messageId: "fn", data: { name } }],
});

const tag = `class Svc extends Context.Tag("Svc")<Svc, { readonly go: (n: number) => Effect.Effect<number> }>() {}\n`;

tester.run("bot/effect-fn", rule, {
  valid: [
    // a value, not a function
    at(`export const one = Effect.gen(function* () { return 1; });`),
    // a callback handed straight to a call
    at(`export const two = Effect.succeed(1).pipe(Effect.flatMap((n) => Effect.succeed(n + 1)));`),
    // a handler in an object handed to a call
    at(
      `class A { readonly _tag = "A"; }\n` +
        `declare const e: Effect.Effect<number, A>;\n` +
        `export const three = e.pipe(Effect.catchTags({ A: () => Effect.succeed(0) }));`,
    ),
    // the shape the rule asks for
    at(`export const four = Effect.fn("four")(function* (n: number) { return n; });`),
    // a ready-made Effect handed over
    at(`export const five = () => Effect.void;`),
    // a builder handing back a function it didn't write
    at(`declare const make: () => () => Effect.Effect<void>;\nexport const six = () => make();`),
    // a service's methods written as the rule asks
    at(
      tag +
        `export const seven = Svc.of({ go: Effect.fn("Svc.go")(function* (n) { return n; }) });`,
    ),
  ],
  invalid: [
    fails(`export const add = (n: number) => Effect.succeed(n + 1);`, "add"),
    fails(`export function add(n: number) { return Effect.succeed(n + 1); }`, "add"),
    // a curried builder: the inner arrow passes as a callback, so the outer one is reported
    fails(`export const add = (a: number) => (b: number) => Effect.succeed(a + b);`, "add"),
    fails(
      `export const add = (a: number) => { return function (b: number) { return Effect.succeed(a + b); }; };`,
      "add",
    ),
    // a service's methods: Tag.of({ ... }) and Layer.succeed(Tag, { ... }) build services
    fails(tag + `export const svc = Svc.of({ go: (n) => Effect.succeed(n) });`, "go"),
    fails(tag + `export const live = Layer.succeed(Svc, { go: (n) => Effect.succeed(n) });`, "go"),
  ],
});
