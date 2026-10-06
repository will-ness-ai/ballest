// site/no-client-values: a server component imports no value from a client module
// (CODING_STANDARDS.md, "Site"). On the server, everything a "use client" file exports
// arrives as a client reference: a component renders, but a constant or function becomes
// one that throws when called or compared. Components (PascalCase) and types pass.
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const USE_CLIENT = /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*["']use client["']/;
const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];
const cache = new Map();

function isClientModule(from, source) {
  const base = resolve(dirname(from), source);
  const file = [base, ...EXTENSIONS.map((e) => base + e)].find(
    (f) => /\.tsx?$/.test(f) && existsSync(f),
  );
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
    return {
      ImportDeclaration(node) {
        if (node.importKind === "type" || !node.source.value.startsWith(".")) return;
        if (!isClientModule(context.filename, node.source.value)) return;
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
