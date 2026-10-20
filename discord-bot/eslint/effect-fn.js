// bot/effect-fn: a function that returns an Effect is `Effect.fn("name")(function* ...)`
// (CODING_STANDARDS.md, "Discord bot"), which names its span and keeps its stack. Typed: it
// reads the function's return type, so `Effect.gen(...)` held in a const (a value, not a
// function) passes. A callback passed straight to a call is an explicit lambda, as the same
// rule asks, so it passes too: that covers `Effect.fn`'s own arguments. Its cases are in
// test/effectFnRule.test.mjs, run by the bot's `pnpm test`.
const FUNCTIONS = ["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"];

/* Effect's own interface, not something that merely extends it (Option, Exit, a Tag) */
function isEffect(type) {
  if (type.isUnion()) return type.types.every(isEffect);
  const symbol = type.getSymbol() ?? type.aliasSymbol;
  return (
    symbol?.getName() === "Effect" &&
    (symbol.declarations ?? []).some((d) =>
      /[\\/]effect[\\/]dist[\\/]/.test(d.getSourceFile().fileName),
    )
  );
}

const calledWith = (call, arg) => call.type === "CallExpression" && call.arguments.includes(arg);

/* A service handed its methods inline is built by `Tag.of({ ... })` or
   `Layer.succeed(Tag, { ... })`. An `Effect.Service` class (Engine, Discord, Renderer) builds
   its methods in an `effect:` generator instead, so they are named consts or properties of a
   returned object, never handed to a call, and are checked as functions anyway. Matched by the
   call's shape, not a list of bare names, so `Effect.succeed({ ... })` or a handler map named
   like a constructor stays a callback. `of` matches any `X.of`, `Chunk.of` included, so a
   function inside one is checked as a service method. A new way to build a service
   (`Context.make` with an inline object, say) needs adding here, or its methods pass as
   callbacks. */
function buildsService(call) {
  const callee = call.callee;
  if (callee.type !== "MemberExpression" || callee.property.type !== "Identifier") return false;
  if (callee.property.name === "of") return true;
  return (
    callee.property.name === "succeed" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Layer"
  );
}

/* a callback: a function handed straight to a call, a handler in an object handed to one
   (catchTags({ ... }), Option.match({ ... })), or one another function builds and returns.
   A service's methods (see buildsService) are not callbacks. */
function isCallback(node) {
  const p = node.parent;
  if (calledWith(p, node)) return true;
  if (p.type === "ArrowFunctionExpression" || p.type === "ReturnStatement") return true;
  if (p.type !== "Property" || p.value !== node) return false;
  const call = p.parent.parent;
  return calledWith(call, p.parent) && !buildsService(call);
}

/* The function a builder writes inline and hands back: the body of `(a) => (b) => ...`, or
   `return function ...` / `return (b) => ...` at its top level. That inner function passes as a
   callback, so a curried builder, `const f = (a) => (b) => Effect.fail(b)`, is reported on its
   outer function: write it as one Effect.fn taking both, `(b) => f(a, b)` at the call. A builder
   that hands back a function something else made (`Schema.decodeUnknown(schema)`) is left
   alone: there is no body of ours in it to trace. */
function builtInline(node) {
  if (FUNCTIONS.includes(node.body.type)) return node.body;
  if (node.body.type !== "BlockStatement") return null;
  for (const statement of node.body.body)
    if (statement.type === "ReturnStatement" && FUNCTIONS.includes(statement.argument?.type))
      return statement.argument;
  return null;
}

function nameOf(node) {
  if (node.id) return node.id.name;
  const p = node.parent;
  if (p.type === "VariableDeclarator" && p.id.type === "Identifier") return p.id.name;
  if ((p.type === "Property" || p.type === "MethodDefinition") && p.key.type === "Identifier")
    return p.key.name;
  return "this function";
}

export default {
  meta: {
    type: "suggestion",
    messages: {
      fn: '{{name}} returns an Effect: write it as Effect.fn("{{name}}")(function* ...) (CODING_STANDARDS.md, "Discord bot").',
    },
  },
  create(context) {
    const services = context.sourceCode.parserServices;
    const checker = services.program.getTypeChecker();
    const returnsEffect = (node) => {
      if (node.generator) return false;
      /* () => Effect.void hands over a ready-made Effect: there is nothing in it to trace */
      if (node.body.type === "MemberExpression" || node.body.type === "Identifier") return false;
      const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
      if (type.getCallSignatures().some((s) => isEffect(s.getReturnType()))) return true;
      const inner = builtInline(node);
      return inner !== null && returnsEffect(inner);
    };
    const check = (node) => {
      if (node.generator || isCallback(node)) return;
      if (returnsEffect(node))
        context.report({ node, messageId: "fn", data: { name: nameOf(node) } });
    };
    return Object.fromEntries(FUNCTIONS.map((f) => [f, check]));
  },
};
