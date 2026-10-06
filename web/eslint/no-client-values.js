// site/no-client-values: a server component imports no value from a client module
// (CODING_STANDARDS.md, "Site"). On the server, everything a "use client" file exports
// arrives as a client reference: a component renders, but a constant or function becomes
// one that throws when called or compared. Types pass, and so does a PascalCase name, read
// as a component: a PascalCase constant from a client module gets past it.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;
const EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts"];
const cache = new Map();

function isClientModule(from, source) {
  /* "./x.js" may name x.ts, as TypeScript resolves it */
  const base = resolve(dirname(from), source).replace(/\.jsx?$/, "");
  const file = EXTENSIONS.map((e) => base + e).find((f) => existsSync(f));
  if (!file) return false;
  if (!cache.has(file)) cache.set(file, USE_CLIENT.test(readFileSync(file, "utf8")));
  return cache.get(file);
}

const isComponent = (name) => /^[A-Z]/.test(name) && /[a-z]/.test(name);

export default {
  meta: {
    type: "problem",
    messages: {
      value:
        "{{name}} is a value from a client module; a server component gets a client reference, not the value. Move it to lib/.",
    },
  },
  create(context) {
    const src = context.sourceCode;
    if (USE_CLIENT.test(src.text)) return {};
    const fromClient = (node) =>
      node.source?.value.startsWith(".") && isClientModule(context.filename, node.source.value);
    return {
      /* a re-export hands the same reference on */
      ExportAllDeclaration(node) {
        if (node.exportKind !== "type" && fromClient(node))
          context.report({ node, messageId: "value", data: { name: "*" } });
      },
      ExportNamedDeclaration(node) {
        if (node.exportKind === "type" || !fromClient(node)) return;
        for (const s of node.specifiers) {
          const name = s.local.name ?? s.local.value;
          if (s.exportKind !== "type" && !isComponent(name))
            context.report({ node: s, messageId: "value", data: { name } });
        }
      },
      ImportDeclaration(node) {
        if (node.importKind === "type" || !fromClient(node)) return;
        for (const s of node.specifiers) {
          if (s.type === "ImportSpecifier" && s.importKind === "type") continue;
          const name = s.type === "ImportSpecifier" ? s.imported.name : s.local.name;
          if (s.type !== "ImportNamespaceSpecifier" && isComponent(name)) continue;
          context.report({ node: s, messageId: "value", data: { name } });
        }
      },
    };
  },
};
