#!/usr/bin/env node
/**
 * The no-scoring-math-elsewhere guard (M3-T004).
 *
 * Enforces the architectural rule that WHS/USGA scoring arithmetic lives
 * only inside src/lib/scoring: no page or component code may perform
 * arithmetic on scores, handicaps, or standings values, and page/component
 * code may only reach the package through its public entry
 * (`@/lib/scoring`) — never a deep import into the package internals.
 *
 * Implemented as a TypeScript-AST scan (not a regex) so the guard tracks
 * real identifiers and operators. Wired into `npm run lint` and
 * `npm run build`, so a single command enforces it in CI. Run the
 * demonstration with `npm run guard:scoring-boundary:prove` — it plants an
 * intentional violation, asserts that the guard fails, and cleans up.
 */
import { pathToFileURL } from "node:url";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const APP_DIRS = [
  path.join(ROOT, "src", "app"),
  path.join(ROOT, "src", "components"),
];

/** Identifiers whose arithmetic meaning is scoring math. */
const SCORING_TERMS = [
  "score",
  "scores",
  "strokes",
  "strokesreceived",
  "gross",
  "net",
  "netstrokes",
  "par",
  "topar",
  "handicap",
  "handicapindex",
  "coursehandicap",
  "playinghandicap",
  "allowance",
  "stableford",
  "points",
  "standings",
  "standing",
  "position",
  "payout",
  "purse",
  "flight",
  "skins",
  "thru",
  "card",
  "cardoff",
  "tiebreak",
];

/** Binary / update operators the guard treats as arithmetic. */
const ARITHMETIC_BINARIES = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "**",
  "+=",
  "-=",
  "*=",
  "/=",
  "%=",
]);

async function loadTypescript() {
  const tsPath = path.join(
    ROOT,
    "node_modules",
    "typescript",
    "lib",
    "typescript.js",
  );
  try {
    return await import(pathToFileURL(tsPath).href);
  } catch {
    console.error(
      "guard: typescript is not installed — run `npm install` first.",
    );
    process.exit(2);
  }
}

function collectSourceFiles(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      collectSourceFiles(full, files);
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

/** Whether an identifier name belongs to the scoring domain. */
function isScoringName(name) {
  const lower = name.toLowerCase();
  return SCORING_TERMS.some((term) => lower.includes(term));
}

/**
 * Whether an import specifier reaches past the package entry into the
 * scoring package internals.
 */
function isDeepScoringImport(specifier) {
  if (specifier === "@/lib/scoring") return false;
  return (
    specifier.startsWith("@/lib/scoring/") ||
    specifier.includes("/lib/scoring/src/") ||
    specifier.includes("/lib/scoring/test/")
  );
}

/**
 * Every identifier name reachable inside an expression tree — flattened, so
 * `standings[i].net - par` yields ["standings", "i", "net", "par"],
 * `row.net` yields ["row", "net"], and `obj.scores[h]` yields
 * ["obj", "scores", "h"]. Property names and element keys are collected on
 * purpose: `row.net - 1` is scoring math even though `net` is only a
 * property, and missing it would make the guard under-match.
 */
function expressionNames(expr, ts, names = new Set()) {
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (
      node.kind === ts.SyntaxKind.Identifier ||
      node.kind === ts.SyntaxKind.PrivateIdentifier
    ) {
      names.add(node.text);
      return;
    }
    if (node.kind === ts.SyntaxKind.PropertyAccessExpression) {
      names.add(node.name.text);
      visit(node.expression);
      return;
    }
    if (node.kind === ts.SyntaxKind.ElementAccessExpression) {
      if (node.argumentExpression) visit(node.argumentExpression);
      visit(node.expression);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(expr);
  return names;
}

function scanFile(file, ts) {
  const source = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.ES2022,
    /* setParentNodes */ true,
  );
  const violations = [];

  const report = (pos, message) => {
    const pos8 = ts.getLineAndCharacterOfPosition(sf, pos);
    violations.push({
      file: path.relative(ROOT, file),
      line: pos8.line + 1,
      message,
    });
  };

  function visit(node) {
    if (!node || typeof node !== "object") return;

    // Arithmetic on scoring-domain values (binary forms).
    if (node.kind === ts.SyntaxKind.BinaryExpression) {
      const operatorText = node.operatorToken.getText(sf);
      if (ARITHMETIC_BINARIES.has(operatorText)) {
        const names = new Set([
          ...expressionNames(node.left, ts),
          ...expressionNames(node.right, ts),
        ]);
        const hits = [...names].filter(isScoringName);
        if (hits.length > 0) {
          report(
            node.getStart(sf),
            `arithmetic on scoring-domain value(s): ${hits.join(", ")} — scoring math belongs in src/lib/scoring`,
          );
        }
      }
    }

    // Arithmetic on scoring-domain values (x++ / x-- forms — postfix is
    // PostfixUnaryExpression, prefix is PrefixUnaryExpression with a
    // ++/-- operator).
    if (
      node.kind === ts.SyntaxKind.PostfixUnaryExpression ||
      (node.kind === ts.SyntaxKind.PrefixUnaryExpression &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken))
    ) {
      const names = expressionNames(node.operand, ts);
      const hits = [...names].filter(isScoringName);
      if (hits.length > 0) {
        report(
          node.getStart(sf),
          `increment/decrement on scoring-domain value(s): ${hits.join(", ")} — scoring math belongs in src/lib/scoring`,
        );
      }
    }

    // Arithmetic on scoring-domain values (unary sign: -n.score / +n.score).
    if (
      node.kind === ts.SyntaxKind.PrefixUnaryExpression &&
      (node.operator === ts.SyntaxKind.PlusToken ||
        node.operator === ts.SyntaxKind.MinusToken)
    ) {
      const names = expressionNames(node.operand, ts);
      const hits = [...names].filter(isScoringName);
      if (hits.length > 0) {
        report(
          node.getStart(sf),
          `unary sign arithmetic on scoring-domain value(s): ${hits.join(", ")} — scoring math belongs in src/lib/scoring`,
        );
      }
    }

    // Deep imports bypassing the package entry.
    if (
      node.kind === ts.SyntaxKind.ImportDeclaration &&
      node.moduleSpecifier?.kind === ts.SyntaxKind.StringLiteral &&
      isDeepScoringImport(node.moduleSpecifier.text)
    ) {
      report(
        node.moduleSpecifier.getStart(sf),
        `deep import "${node.moduleSpecifier.text}" bypasses the @/lib/scoring package entry`,
      );
    }
    if (node.kind === ts.SyntaxKind.CallExpression) {
      for (const arg of node.arguments ?? []) {
        if (
          arg.kind === ts.SyntaxKind.StringLiteral &&
          isDeepScoringImport(arg.text)
        ) {
          report(
            arg.getStart(sf),
            `dynamic deep import "${arg.text}" bypasses the @/lib/scoring package entry`,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sf);

  return violations;
}

async function main() {
  const ts = await loadTypescript();
  const files = APP_DIRS.flatMap((dir) => collectSourceFiles(dir));
  let failed = false;
  for (const file of files) {
    for (const v of scanFile(file, ts)) {
      failed = true;
      console.error(
        `guard: ${v.file}:${v.line}: ${v.message}`,
      );
    }
  }
  console.log(
    `guard: scanned ${files.length} page/component files (src/app + src/components) — ${
      failed ? "VIOLATIONS FOUND" : "clean: no scoring math outside src/lib/scoring"
    }`,
  );
  process.exit(failed ? 1 : 0);
}

main();
