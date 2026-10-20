// bot/effect-fn: a function that returns an Effect is `Effect.fn("name")(function* ...)`
// (CODING_STANDARDS.md, "Discord bot"), which names its span and keeps its stack. Typed: it
// reads the function's return type, so `Effect.gen(...)` held in a const (a value, not a
// function) passes. A callback passed straight to a call is an explicit lambda, as the same
// rule asks, so it passes too: that covers `Effect.fn`'s own arguments.
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
const calleeName = (call) =>
  call.callee.type === "MemberExpression" ? call.callee.property.name : call.callee.name;

/* a callback: a function handed straight to a call, a handler in an object handed to one
   (catchTags({ ... }), Option.match({ ... })), or one another function builds and returns.
   A service handed to Tag.of({ ... }) or Layer.succeed(Tag, { ... }) is not a callback. */
function isCallback(node) {
  const p = node.parent;
  if (calledWith(p, node)) return true;
  if (p.type === "ArrowFunctionExpression" || p.type === "ReturnStatement") return true;
  if (p.type !== "Property" || p.value !== node) return false;
  const call = p.parent.parent;
  return calledWith(call, p.parent) && !["of", "succeed", "sync"].includes(calleeName(call));
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
    const check = (node) => {
      if (node.generator || isCallback(node)) return;
      /* () => Effect.void hands over a ready-made Effect: there is nothing in it to trace */
      if (node.body.type === "MemberExpression" || node.body.type === "Identifier") return;
      const type = checker.getTypeAtLocation(services.esTreeNodeToTSNodeMap.get(node));
      if (type.getCallSignatures().some((s) => isEffect(s.getReturnType())))
        context.report({ node, messageId: "fn", data: { name: nameOf(node) } });
    };
    return Object.fromEntries(FUNCTIONS.map((f) => [f, check]));
  },
};
