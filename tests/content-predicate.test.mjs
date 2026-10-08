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

/** Comment-stripped source: a pattern named in a comment is documentation. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

/**
 * Collection fields whose presence these pages decide. The truthiness ban is
 * field-scoped rather than a blanket `&&` ban: `&&` is ordinary Astro
 * conditional rendering, and banning it wholesale would forbid `{items.length >
 * 0 && …}` on derived local state, which is not a content predicate at all.
 */
const COLLECTION_FIELDS = [
  "status",
  "summary",
  "category",
  "evidence",
  "architecture",
  "implementation",
  "limitations",
  "problem",
  "built",
  "what_we_build",
  "applications",
  "capabilities",
  "how_it_works",
  "engagement_path",
  "technologies",
  "github",
  "demo",
  "images",
  // research collection fields. The research collection is empty today, so
  // nothing renders them — but the routes exist, and this ban is about the
  // source, not about what currently happens to have content.
  "topic",
  "question",
  "context",
  "investigation",
  "experiments",
  "results",
  "observations",
  "learnings",
  "next",
];

describe("every surface uses the shared predicate", () => {
  // The point of the shared module is that no surface rolls its own. If a page
  // OR A COMPONENT reintroduces a local test, the divergence returns — and the
  // first version of this test scanned only the three pages, leaving
  // RelatedWork.astro's `{status && …}` live. That component renders the same
  // collection field on /solutions/*, so a whitespace-only status drew an empty
  // badge there while src/lib/content.ts called it absence.
  const pages = [
    "src/pages/index.astro",
    "src/pages/work/[project].astro",
    "src/pages/solutions/[slug].astro",
  ];
  // Components that read a collection field and must use the shared predicate.
  // Deliberately a named list, not a glob: a component that never touches a
  // content field should not be forced to import the module, and a glob would
  // silently start passing or failing as components are added. When a new
  // component reads a collection field, add it here — the failure this list
  // was widened for was exactly that omission, twice.
  const components = [
    "src/components/solutions/RelatedWork.astro",
    "src/components/work/ProjectCard.astro",
    "src/components/solutions/SolutionCard.astro",
    "src/components/research/ResearchCard.astro",
    "src/pages/research/[slug].astro",
  ];

  for (const component of components) {
    test(`${component} imports the shared predicate`, () => {
      const source = readFileSync(join(REPO_ROOT, component), "utf8");
      assert.match(source, /from "(\.\.\/)+lib\/content"/);
    });

    test(`${component} has no local "has content" test`, () => {
      const code = stripComments(
        readFileSync(join(REPO_ROOT, component), "utf8"),
      );
      for (const field of COLLECTION_FIELDS) {
        const bare = `(?<!\\w)(?<![\\w.]\\()(?:data\\.)?${field}`;
        assert.doesNotMatch(
          code,
          new RegExp(bare + `\\s*(?:&&|\\|\\||\\?(?![?.:]))`),
          `${component}: local truthiness test on \`${field}\``,
        );
        assert.doesNotMatch(
          code,
          new RegExp(
            bare +
              `\\s*(?:\\?\\.)?\\.?length\\s*` +
              `(?:\\?\\?\\s*[^)\\s]+\\s*\\)?\\s*)?(?:>|!==|>=)`,
          ),
          `${component}: local length test on \`${field}\``,
        );
      }
    });
  }

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
      // A local reimplementation shows up as one of three shapes, outside a
      // comment: a trim, a bare typeof, or — the one this originally missed —
      // plain truthiness on a collection field. Truthiness was nine of the
      // sixteen remaining sites, so a test that only banned the first two
      // shapes passed while the migration was barely started.
      const code = stripComments(source);
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
      for (const field of COLLECTION_FIELDS) {
        // The lookbehind is what makes this precise: the field must be a bare
        // reference, not an argument. `{hasListItem(technologies) && …}` and
        // `{hasList(data.applications) && …}` are the shared predicate doing its
        // job — the first attempt at this ban matched both and failed on them.
        // `(?<![\w.]\()` exempts exactly a call argument: the `(` in
        // `hasListItem(` is preceded by a word character, the `(` in
        // `(data.github || …` is preceded by a dot.
        //
        // `??` alone is deliberately NOT banned. `data.technologies ?? []` is a
        // default, not a presence test: it normalises an optional list to an
        // array so `.map` is safe, and decides nothing about whether the entry
        // has content. `?.` likewise. Only truthiness (`&&`, `||`), a ternary
        // that is not optional chaining, and a length comparison can render or
        // suppress a section, so only those are banned.
        const bare = `(?<!\\w)(?<![\\w.]\\()(?:data\\.)?${field}`;
        assert.doesNotMatch(
          code,
          new RegExp(bare + `\\s*(?:&&|\\|\\||\\?(?![?.:]))`),
          `local truthiness test on \`${field}\` reintroduced`,
        );
        assert.doesNotMatch(
          code,
          // `x.length > 0`, `x.length ?? 0) > 0` — the second shape is what
          // the homepage used to filter evidenced projects.
          new RegExp(
            bare +
              `\\s*(?:\\?\\.)?\\.?length\\s*` +
              `(?:\\?\\?\\s*[^)\\s]+\\s*\\)?\\s*)?(?:>|!==|>=)`,
          ),
          `local length test on \`${field}\` reintroduced`,
        );
      }
    });
  }
});
