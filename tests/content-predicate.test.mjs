/**
 * ENG-102 — the shared content predicate.
 *
 * Three surfaces read the same collection fields and each had grown its own
 * "does this carry approved content" test: truthiness on /work, trim-nonempty on
 * /solutions, and a bare `typeof === "string"` on the homepage. That last one
 * counted a whitespace-only value as content, so one field could render a section
 * on one page and be reported pending on another — which is precisely the
 * evidence-versus-absence distinction the site's content policy turns on.
 *
 * These cases pin the single definition every page now shares.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..");

// src/lib/content.ts is TypeScript. The other suites already import type-stripped
// .ts directly (the engines floor of Node >= 22.18 supports it), so this uses
// the same mechanism rather than duplicating the logic it tests.
const { hasContent, hasListItem } = await import(
  join(REPO_ROOT, "src/lib/content.ts")
);

describe("hasContent — the one definition of approved content", () => {
  test("absent values are not content", () => {
    for (const value of [undefined, null, 0, false, {}, [], NaN]) {
      assert.equal(
        hasContent(value),
        false,
        `${String(value)} should not count`,
      );
    }
  });

  test("a string with non-whitespace is content", () => {
    assert.equal(hasContent("EthioSci"), true);
    assert.equal(hasContent("In Development"), true);
    assert.equal(hasContent("0"), true, "a zero string is still content");
  });

  test("whitespace-only is NOT content", () => {
    // The reachable case the homepage's `typeof === "string"` got wrong. The
    // schema is z.string().min(1), so "" cannot occur — but " " can.
    for (const value of ["", " ", "   ", "\n", "\t", " \n\t "]) {
      assert.equal(
        hasContent(value),
        false,
        `${JSON.stringify(value)} should not count as content`,
      );
    }
  });

  test("leading or trailing whitespace around real content still counts", () => {
    assert.equal(hasContent("  EthioSci  "), true);
  });
});

describe("hasListItem — the same rule, applied to a list", () => {
  test("an absent or empty list has no content", () => {
    assert.equal(hasListItem(undefined), false);
    assert.equal(hasListItem([]), false);
  });

  test("a list of only blank entries has no content", () => {
    assert.equal(hasListItem(["", "   "]), false);
  });

  test("one real entry is enough", () => {
    assert.equal(hasListItem(["", "LangGraph"]), true);
  });
});

describe("every page uses the shared predicate", () => {
  // The point of the shared module is that pages stop rolling their own. If a
  // page reintroduces a local test, the divergence this replaced can return.
  const pages = [
    "src/pages/index.astro",
    "src/pages/work/[project].astro",
    "src/pages/solutions/[slug].astro",
  ];

  for (const page of pages) {
    test(`${page} imports the shared predicate`, () => {
      const source = readFileSync(join(REPO_ROOT, page), "utf8");
      assert.match(
        source,
        /from "\.\.\/\.\.\/lib\/content"|from "\.\.\/lib\/content"/,
      );
    });

    test(`${page} has no local "has content" test`, () => {
      const source = readFileSync(join(REPO_ROOT, page), "utf8");
      // A local reimplementation would be a `.trim().length > 0` or a bare
      // `typeof … === "string"` outside a comment.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.doesNotMatch(
        code,
        /\.trim\(\)\.length\s*>\s*0/,
        "local trim-based content test reintroduced",
      );
      assert.doesNotMatch(
        code,
        /typeof\s+\w[\w.]*\.\w+\s*===\s*"string"/,
        "local typeof-based content test reintroduced",
      );
    });
  }
});
