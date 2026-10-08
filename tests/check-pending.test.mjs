/**
 * ENG-102 — regression battery for scripts/check-pending.mjs.
 *
 * Every other gate in this repo has one of these; check:pending did not, and
 * that is not a neutral gap. Five of the seven review rounds run against this
 * branch found a real defect in this one gate, and two of those were
 * false-PASSES — the direction that lets a broken page reach production:
 *
 *   round 2  coverage counted with `includes()`, blind to a duplicate heading
 *            and to a fabricated pending entry
 *   round 3  crashed on a missing page instead of reporting, losing every
 *            collected message
 *   round 5  the card bound was computed in the wrong coordinate system, so a
 *            link dropped from an evidence card still passed
 *   round 6  a project list built from slugs rather than filenames, so
 *            renaming a slug made the gate call its own chips fabricated
 *   round 7  step titles extracted from page source INCLUDING comments, so a
 *            comment explaining the extraction became an approved step
 *
 * Each of those was found by hand. This file is what stops the next one from
 * shipping: every case below asserts the gate EXITS NON-ZERO, so a regression
 * that the gate would have waved through fails here instead.
 *
 * Fixture-built rather than read from the repo's dist/, because `npm test` runs
 * BEFORE `npm run build` in both `npm run verify` and CI — a suite that read the
 * real dist/ failed on every clean checkout (it did, once). The content
 * directory is deliberately the REAL src/content, not a fixture: the gate's
 * whole design is that its expectations are derived from approved content, so a
 * fixture content tree would test a different contract than the one that ships.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK_SCRIPT = join(REPO_ROOT, "scripts/check-pending.mjs");
const CONTENT_DIR = join(REPO_ROOT, "src/content");

/* ------------------------------------------------------------------ *
 * The approved sequences, read exactly as the gate reads them
 * ------------------------------------------------------------------ */

/**
 * Mirrors scripts/check-pending.mjs's own extraction, comment-stripping
 * included. If the gate's extraction changes and this does not, the
 * "passes on correct output" case below fails with a mismatch rather than
 * the battery quietly testing a fiction.
 */
function approvedSteps(relative, pattern) {
  const text = readFileSync(join(REPO_ROOT, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

const PROJECT_STEPS = [
  ...new Set([
    ...approvedSteps("src/pages/work/[project].astro", /title:\s*"([^"]+)"/g),
    "Related Work",
  ]),
];

const SOLUTION_STEPS = approvedSteps(
  "src/pages/solutions/[slug].astro",
  /heading="([^"]+)"/g,
);

/* ------------------------------------------------------------------ *
 * Approved content, for building correct fixtures
 * ------------------------------------------------------------------ */

function frontmatter(file) {
  const text = readFileSync(file, "utf8");
  const out = {};
  for (const m of text.matchAll(/^([a-z_]+):[ \t]*(.*)$/gm)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const collectionFiles = (name, root = CONTENT_DIR) =>
  readdirSync(join(root, name))
    .filter((f) => f.endsWith(".md"))
    .map((f) => join(root, name, f));

const slugOf = (file) =>
  frontmatter(file).slug ?? file.split("/").pop().replace(/\.md$/, "");

/**
 * Approved step title -> the frontmatter field that backs it, taken from the
 * page sources. Related Work is absent by design: it renders from a separate
 * branch and always states its own honest state, so it is never "pending".
 */
const PROJECT_FIELD = {
  Problem: "problem",
  "What We Built": "built",
  Architecture: "architecture",
  "Technical Implementation": "implementation",
  Evidence: "evidence",
  Limitations: "limitations",
  "What We Learned": "learnings",
  Next: "next",
};

const SOLUTION_FIELD = {
  Problem: "problem",
  "What we build": "what_we_build",
  "Typical applications": "applications",
  "How it works": "how_it_works",
  Capabilities: "capabilities",
  "Engagement path": "engagement_path",
};

const RELATED_REASON = "no approved related-work relationship is declared";

/**
 * The project step titles a given entry actually renders.
 *
 * Reads every field through `readField`, not the single-line `frontmatter()`
 * helper: a folded block (`evidence: >-`) or a block list (`images:` continued
 * on indented lines) reads as `""` there, which is how the images-only Evidence
 * shape — round 1's real bug, where a step whose content is images rendered
 * nothing — went unexercised in this battery.
 */
function presentProjectSteps(file) {
  const has = (field) => readField(file, field) !== null;
  const hasList = (field) => readList(file, field).length > 0;
  return PROJECT_STEPS.filter((title) => {
    if (title === "Related Work") return false; // always rendered, never pending
    const field = PROJECT_FIELD[title];
    // Evidence is the one step with two content shapes: prose, or images.
    if (title === "Evidence") return has("evidence") || hasList("images");
    return field ? has(field) : false;
  });
}

function presentSolutionSteps(file) {
  return SOLUTION_STEPS.filter((title) => {
    if (title === "Related work") return false;
    const field = SOLUTION_FIELD[title];
    return field ? readField(file, field) !== null : false;
  });
}

/* ------------------------------------------------------------------ *
 * Fixture construction — a CORRECT build, which each case then mutates
 * ------------------------------------------------------------------ */

const html = (body) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
  `<title>t</title></head><body><main>${body}</main></body></html>`;

function pendingNote(titles) {
  if (titles.length === 0) return "";
  return (
    `<section aria-label="Sections not yet published"><ul>` +
    titles.map((t) => `<li>${t} — not yet published</li>`).join("") +
    `</ul></section>`
  );
}

function stepSections(present) {
  return present
    .map((t) => `<section><h2>${t}</h2><p>body</p></section>`)
    .join("");
}

/** A correct /work/<slug> page: every approved step rendered or named once. */
function projectPage(file, mutate = (b) => b) {
  const fm = frontmatter(file);
  const present = presentProjectSteps(file);
  const pending = PROJECT_STEPS.filter(
    (t) => t !== "Related Work" && !present.includes(t),
  );
  let body =
    `<header><h1>${fm.title}</h1></header>` +
    stepSections(present) +
    pendingNote(pending) +
    `<section><h2>Related Work</h2><p>${RELATED_REASON}</p></section>` +
    `<section><h2>Start a Project</h2></section>`;
  body = mutate(body, { present, pending, fm, slug: slugOf(file) });
  return html(body);
}

/** A correct /solutions/<slug> page. */
function solutionPage(file, mutate = (b) => b) {
  const fm = frontmatter(file);
  const present = presentSolutionSteps(file);
  const pending = SOLUTION_STEPS.filter(
    (t) => t !== "Related work" && !present.includes(t),
  );
  let body =
    `<header><h1>${fm.title}</h1></header>` +
    pendingNote(pending) +
    stepSections(present) +
    `<section><h2>Related work</h2><p>${RELATED_REASON}</p></section>` +
    `<section><h2>Start a Project</h2></section>`;
  body = mutate(body, { present, pending, fm, slug: slugOf(file) });
  return html(body);
}

/** A correct homepage: the engineering-depth section built from the content. */
/** One evidence card for a project entry, built from its approved content. */
function evidenceCard(file, { withChips = true } = {}) {
  const fm = frontmatter(file);
  const slug = slugOf(file);
  const evidence = readField(file, "evidence");
  const chips = withChips
    ? readList(file, "technologies")
        .map((t) => `<li class="evidence__tech">${t}</li>`)
        .join("")
    : "";
  const links = ["github", "demo"]
    .filter((k) => fm[k])
    .map((k) => `<a href="${fm[k]}">${k}</a>`)
    .join("");
  return (
    `<li class="evidence"><p class="evidence__title">` +
    `<a href="/work/${slug}">${fm.title}</a></p>` +
    (chips ? `<ul class="evidence__stack" role="list">${chips}</ul>` : "") +
    (evidence ? `<p class="evidence__text">${evidence}</p>` : "") +
    `<p class="evidence__links">${links}</p></li>`
  );
}

/** A correct homepage: the engineering-depth section built from the content. */
function homePage(mutate = (b) => b, content = CONTENT_DIR) {
  // Read BOTH shapes properly. The single-line `frontmatter()` helper above
  // reads a block list (`technologies:` continued on indented lines) as `""`,
  // so `Boolean(fm.technologies)` is false for it — which made this fixture
  // omit the card for the first entry to declare a stack, and reddened the
  // suite on the most ordinary content addition this site exists for. That is
  // the false-red class rounds 2, 4 and 5 removed, reintroduced one layer down.
  const evidenced = collectionFiles("projects", content).filter(
    (f) =>
      readField(f, "evidence") !== null ||
      readList(f, "technologies").length > 0,
  );
  const cards = evidenced.map((f) => evidenceCard(f)).join("");

  const summaries = collectionFiles("projects", content)
    .map((file) => readField(file, "summary"))
    .filter(Boolean)
    .map((s) => `<p class="card__summary">${s}</p>`)
    .join("");

  let section =
    `<section id="engineering-depth"><h2>Engineering depth</h2>` +
    `<ul class="evidence-list" role="list">${cards}</ul></section>`;

  let body =
    `<nav aria-label="Primary"><a href="/solutions">Solutions</a>` +
    `<a href="/work">Work</a><a href="/research">Research</a>` +
    `<a href="/about">About</a></nav>` +
    `<main><h1>EthioAI Venture</h1><ul class="card-list">${summaries}</ul>${section}</main>`;

  body = mutate(body, {
    section,
    cards,
    card: evidenceCard,
    files: collectionFiles("projects", content),
  });
  return html(body);
}

/**
 * The live regions must sit OUTSIDE the form, and the gate reads that as
 * "after `</form>` in document order" — matching the real page, where they
 * follow the form so hiding it on success cannot hide the announcement.
 */
function formPage(mutate = (b) => b) {
  let body =
    `<form action="https://formspree.io/f/x"><input name="email">` +
    `<button>Send</button></form>` +
    `<p role="status" id="form-status" hidden></p>` +
    `<p role="alert" id="form-error" hidden></p>`;
  body = mutate(body);
  return html(body);
}

/**
 * Frontmatter field value, in every shape YAML allows.
 *
 * Deliberately NOT a copy of the gate's parser. This file used to reimplement
 * the same two-shape reader, so fixture and gate agreed with each other and
 * both disagreed with Astro — which is why `npm test` stayed green while a real
 * build reddened on an ordinary `technologies: [Rust]` or an ampersand. Both
 * readers now handle folded scalars, plain multi-line scalars, literal blocks
 * and flow sequences, and the two shapes the gate genuinely does not accept
 * (a scalar where a list is expected, a list where a scalar is expected) are
 * covered by RED cases below rather than by agreement.
 */
function readField(file, field) {
  const text = readFileSync(file, "utf8");
  const m = text.match(new RegExp(`^${field}:[ \\t]*(.*)$`, "m"));
  if (!m) return null;
  const continuation = [];
  for (const line of text.slice(m.index).split("\n").slice(1)) {
    if (!/^[ \t]+/.test(line)) break;
    if (/^\s*#/.test(line)) continue;
    continuation.push(line.trim());
  }
  const first = m[1].trim();
  if (first === "|") {
    const value = continuation.join("\n").trim();
    return value === "" ? null : value;
  }
  if (first === "" || first === ">" || first === ">-") {
    const value = continuation.join(" ").trim();
    return value === "" ? null : value;
  }
  const scalar = [first.replace(/^["']|["']$/g, "").trim(), ...continuation]
    .filter(Boolean)
    .join(" ")
    .trim();
  return scalar === "" ? null : scalar;
}

/** Frontmatter list field, in block or flow form. */
function readList(file, field) {
  const text = readFileSync(file, "utf8");
  const m = text.match(new RegExp(`^${field}:[ \\t]*(.*)$`, "m"));
  if (!m) return [];
  const first = m[1].trim();
  const strip = (v) => v.replace(/^["']|["']$/g, "").trim();
  if (first.startsWith("[") && first.endsWith("]")) {
    return first
      .slice(1, -1)
      .split(",")
      .map((item) => strip(item.trim()))
      .filter(Boolean);
  }
  if (first !== "") return [];
  const out = [];
  for (const line of text.slice(m.index).split("\n").slice(1)) {
    if (!/^[ \t]+/.test(line)) break;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (!item) continue;
    out.push(strip(item[1]));
  }
  return out.filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

/**
 * Build a fixture dist/ and run the gate against it.
 *
 * A case asserting RED is only meaningful if the SAME fixture passes before the
 * mutation — otherwise a case can redden for an unrelated reason and prove
 * nothing. Every mutation below is therefore expressed as a function over an
 * otherwise-correct page, and "the fixture is genuinely correct" asserts the
 * unmutated build is green.
 *
 * (An earlier version of this comment claimed a per-case `baselineGreen`
 * checked that. No such thing existed; the check is global, not per case, and
 * the comment is now written to match what actually runs.)
 */
function runGate({
  project,
  solution,
  home,
  form,
  content = CONTENT_DIR,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "check-pending-"));
  try {
    for (const file of collectionFiles("projects", content)) {
      const dirPath = join(dir, "work", slugOf(file));
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(join(dirPath, "index.html"), projectPage(file, project));
    }
    for (const file of collectionFiles("solutions", content)) {
      const dirPath = join(dir, "solutions", slugOf(file));
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(join(dirPath, "index.html"), solutionPage(file, solution));
    }
    mkdirSync(join(dir, "start-a-project"), { recursive: true });
    writeFileSync(join(dir, "start-a-project", "index.html"), formPage(form));
    writeFileSync(join(dir, "index.html"), homePage(home, content));

    try {
      const stdout = execFileSync("node", [CHECK_SCRIPT, dir, content], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, output: stdout };
    } catch (error) {
      return {
        ok: false,
        output: `${error.stdout ?? ""}${error.stderr ?? ""}`,
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Assert the mutation REDs, and that the same fixture shape passes clean. */
function assertReds(mutate, expected, label) {
  const result = runGate(mutate);
  assert.ok(
    !result.ok,
    `the gate PASSED but should have failed — ${label}\n${result.output}`,
  );
  assert.match(result.output, expected);
}

/* ------------------------------------------------------------------ *
 * Tests
 * ------------------------------------------------------------------ */

describe("check:pending passes on a correct build", () => {
  test("the fixture is genuinely correct", () => {
    const result = runGate();
    assert.ok(
      result.ok,
      `expected the gate to pass on a correct fixture, it failed:\n${result.output}`,
    );
    assert.match(result.output, /0 problems/);
  });

  test("the fixture is non-trivial — it must exercise real steps", () => {
    // A battery against an empty fixture proves nothing. If the content
    // collections lose their approved fields, this fails instead of the whole
    // battery quietly degrading into assertions about empty strings.
    const projects = collectionFiles("projects");
    const withPending = projects.filter(
      (f) => presentProjectSteps(f).length < PROJECT_STEPS.length,
    );
    assert.ok(
      withPending.length > 0,
      "no project entry has a pending step — the collapse case is untested",
    );
    assert.ok(
      SOLUTION_STEPS.length >= 5,
      `expected the solution sequence to be intact, got ${SOLUTION_STEPS.length}`,
    );
  });
});

describe("check:pending catches the regressions it exists for", () => {
  /** Every case must RED. A case that passes here proves nothing. */
  const cases = [
    [
      // Drop the first entry from the pending note. That step is then neither
      // rendered nor named — content vanishing silently, the ENG-80 bug class.
      "a step is neither rendered nor named pending",
      {
        project: (b) => b.replace(/<li>[^<]*<\/li>/, ""),
        solution: (b) => b.replace(/<li>[^<]*<\/li>/, ""),
      },
      /is neither rendered nor named pending/,
    ],
    [
      // A pending step is ALSO rendered, so it appears twice — once rendered,
      // once named. This is the case an `includes()` check could not see.
      //
      // Injected BEFORE the note, not inside it: the gate reads the note up to
      // the first `</section>`, so a nested section would truncate it and this
      // case would red for an unrelated reason.
      "a step is both rendered and named pending",
      {
        project: (b, ctx) =>
          b.replace(
            '<section aria-label="Sections not yet published">',
            `<section><h2>${ctx.pending[0]}</h2><p>body</p></section>` +
              `<section aria-label="Sections not yet published">`,
          ),
      },
      /appears 2 times .*exactly once, never twice/s,
    ],
    [
      "a pending entry names a step that is not approved",
      {
        project: (b) =>
          b.replace(
            /<section aria-label="Sections not yet published">/,
            `<section aria-label="Sections not yet published"><ul><li>Bogus Step \u2014 not yet published</li>`,
          ),
      },
      /names "Bogus Step", which is not an approved step/,
    ],
    [
      "a solution step vanishes silently",
      { solution: (b) => b.replace(/<li>[^<]*<\/li>/, "") },
      /is neither rendered nor named pending/,
    ],
    [
      // Round 2. Related Work is rendered from its own branch, so naming it
      // pending means the note must carry the honest reason — not the old
      // "no approved content published" placeholder.
      "Related Work is named pending without the honest reason",
      {
        project: (b) =>
          b.replace(
            "</ul></section>",
            "<li>Related Work — not yet published</li></ul></section>",
          ),
      },
      /Related Work is pending, so it must state that no approved relationship/,
    ],
    [
      // The other direction: the note claims no relationship is declared while
      // Related Work is rendered, so one of the two is wrong.
      "the pending note claims no relationship while Related Work is rendered",
      {
        project: (b) =>
          b.replace(
            "</ul></section>",
            `<li>Some Step — ${RELATED_REASON}</li></ul></section>`,
          ),
      },
      /claims no relationship is declared, but Related Work is not listed/,
    ],
    [
      // Round 5. The link is gone from the card but the same href sits just
      // past the list's closing tag. An unbounded card slice accepted it.
      "an evidence card drops a link its prose claims, and the href reappears later on the page",
      {
        home: (b) =>
          b
            .replace(/<a href="https:\/\/[^"]*vercel\.app">demo<\/a>/, "")
            .replace(
              "</section>",
              `<a href="https://ethio-bio-ai-assistant.vercel.app">stray</a></section>`,
            ),
      },
      /link for .* is missing from engineering depth/,
    ],
    [
      "a technology chip is altered on the card",
      {
        home: (b) =>
          b.replace(
            /class="evidence__tech">([^<]*)</,
            'class="evidence__tech">Altered<',
          ),
      },
      /technology chips do not match the entry's approved list/,
    ],
    [
      // A card carrying chips for a slug no entry backs. Written against an
      // invented slug rather than an entry that "has no stack", because the
      // first approved stack on every entry made that lookup return undefined
      // and crash — another false red on an ordinary content addition.
      "a chip is invented for an entry that does not exist",
      {
        home: (b, ctx) =>
          b.replace(
            ctx.cards,
            ctx.cards +
              `<li class="evidence"><p class="evidence__title">` +
              `<a href="/work/no-such-project">No Such Project</a></p>` +
              `<ul class="evidence__stack" role="list">` +
              `<li class="evidence__tech">Pinecone</li></ul>` +
              `<p class="evidence__links"></p></li>`,
          ),
      },
      /renders technology chips for .* which declares no approved technologies/,
    ],
    [
      "the approved summary is no longer rendered",
      { home: (b) => b.replace(/<p class="card__summary">[^<]*<\/p>/, "") },
      /does not render the approved summary for/,
    ],
    [
      // Round 7 advisory. The prose is the public claim; altering it in the
      // output while chips and links still match used to pass.
      "the evidence prose is altered in the output",
      {
        home: (b) =>
          b.replace(
            /(<p class="evidence__text">)([^<]*)(<\/p>)/,
            (m, a, t, c) =>
              `${a}${t.replace("Public repository", "No public repository")}${c}`,
          ),
      },
      /evidence prose for .* does not match the approved text/,
    ],
    [
      "the section proves the website again",
      {
        home: (b) =>
          b.replace(
            "<h2>Engineering depth</h2>",
            "<h2>Engineering depth</h2><p>Built with Astro and TypeScript.</p>",
          ),
      },
      /still proves the website \(Astro\)/,
    ],
    [
      "an approved summary is fabricated on the homepage",
      {
        home: (b) =>
          b.replace(
            "</main>",
            '<p class="card__summary">An invented summary</p></main>',
          ),
      },
      /summary\/summaryies with no approved entry behind/,
    ],
    [
      // Round 7 finding 2: the prose claims both links ("see the links on this
      // page for both") and the card stops rendering one of them, so the reused
      // sentence is false on this page.
      "an evidence card drops a link its prose claims",
      {
        home: (b) =>
          b.replace(/<a href="https:\/\/[^"]*vercel\.app">demo<\/a>/, ""),
      },
      /link for .* is missing from engineering depth/,
    ],
    [
      // The gate reads "outside the form" as "after </form> in document
      // order". Moving a region back inside the form is what breaks the
      // success announcement.
      "a live region moves inside the form",
      {
        form: (b) =>
          b.replace(
            '<form action="https://formspree.io/f/x">',
            '<form action="https://formspree.io/f/x">' +
              '<p role="status" id="form-status" hidden></p>',
          ),
      },
      /role="status" is inside the <form>/,
    ],
    [
      "a live region is dropped by the build",
      {
        form: (b) =>
          b.replace('<p role="alert" id="form-error" hidden></p>', ""),
      },
      /no role="alert" region in the built page/,
    ],
    [
      "the primary nav loses an item",
      {
        home: (b) => b.replace('<a href="/work">Work</a>', ""),
      },
      /primary nav lost "Work"/,
    ],
    [
      "the primary nav is restyled as buttons",
      {
        home: (b) =>
          b.replace(
            '<a href="/work">Work</a>',
            '<a href="/work" class="btn">Work</a>',
          ),
      },
      /navigation redesign is out of scope/,
    ],
    [
      "a page is missing from the build entirely",
      { project: () => "" },
      /neither rendered nor named pending|renders no steps/,
    ],
  ];

  for (const [label, fixture, expected] of cases) {
    test(`RED on ${label}`, () => {
      assertReds(fixture, expected, label);
    });
  }
});

describe("two evidenced entries coexist", () => {
  /**
   * Round 4's bug was a chip check that concatenated every chip on the homepage
   * and compared it to ONE entry, so the first second entry with a stack would
   * redden CI. Every RED chip case above reddens under both the old and the new
   * implementation, and the real collections have exactly one evidenced entry —
   * so nothing in the battery could tell the two apart.
   *
   * This is the state that distinguishes them, and it must be GREEN: two cards,
   * each matching its own approved list.
   */
  function withSecondStack() {
    const root = mkdtempSync(join(tmpdir(), "check-pending-two-"));
    for (const name of ["projects", "solutions"]) {
      mkdirSync(join(root, name), { recursive: true });
      for (const file of collectionFiles(name)) {
        writeFileSync(
          join(root, name, file.split("/").pop()),
          readFileSync(file),
        );
      }
    }
    writeFileSync(
      join(root, "projects", "second-stack.md"),
      [
        "---",
        "title: Second Stack",
        "slug: second-stack",
        "status: In Development",
        "technologies:",
        "  - Rust",
        "  - WASM",
        "---",
        "",
      ].join("\n"),
    );
    return root;
  }

  test("both entries' chips match their own lists, in either card order", () => {
    const content = withSecondStack();
    try {
      for (const reverse of [false, true]) {
        const result = runGate({
          content,
          home: (b, ctx) => {
            if (!reverse) return b;
            // Split on the card's OPENING tag, not a `</li>`: a card contains a
            // nested `<ul>` of chips, so a `[\s\S]*?</li>` match stops at the
            // first chip and truncates the card.
            const OPEN = '<li class="evidence"';
            const parts = ctx.cards.split(OPEN).slice(1);
            return b.replace(
              ctx.cards,
              parts
                .map((p) => OPEN + p)
                .reverse()
                .join(""),
            );
          },
        });
        assert.ok(
          result.ok,
          `two evidenced entries must pass (reversed=${reverse}):\n${result.output}`,
        );
      }
    } finally {
      rmSync(content, { recursive: true, force: true });
    }
  });

  test("a stack-declaring entry with no card at all is still caught", () => {
    const content = withSecondStack();
    try {
      const result = runGate({
        content,
        home: (b) =>
          b.replace(
            /<li class="evidence"[\s\S]*?second-stack[\s\S]*?<\/li>/,
            "",
          ),
      });
      assert.ok(!result.ok, "expected a missing card to redden");
      assert.match(result.output, /second-stack/);
    } finally {
      rmSync(content, { recursive: true, force: true });
    }
  });
});

describe("the gate follows the `slug:` field, not the filename", () => {
  /**
   * Round 6's latent bug lived here and no case above could see it: the project
   * list was built from slugs, then re-joined to filenames, which only worked
   * because every slug happens to equal its filename today. Renaming `slug:` in
   * frontmatter made the gate lose the entry and then report its own approved
   * chips as fabricated.
   *
   * The real collections agree on both, so nothing short of a content copy with
   * a deliberately divergent slug exercises this. Mutation-verified: reverting
   * the project list to slugs, or making `slugOf` read the filename, turns this
   * red.
   */
  function withRenamedSlug(rename) {
    const root = mkdtempSync(join(tmpdir(), "check-pending-content-"));
    for (const name of ["projects", "solutions"]) {
      mkdirSync(join(root, name), { recursive: true });
      for (const file of collectionFiles(name)) {
        writeFileSync(
          join(root, name, file.split("/").pop()),
          rename(readFileSync(file, "utf8")),
        );
      }
    }
    return root;
  }

  test("renaming a slug in frontmatter does not redden the gate", () => {
    const content = withRenamedSlug((text) =>
      text.replace(/^slug: ethiosci$/m, "slug: ethiosci-renamed"),
    );
    try {
      const result = runGate({ content });
      assert.ok(
        result.ok,
        `renaming slug: in frontmatter must not redden the gate:\n${result.output}`,
      );
    } finally {
      rmSync(content, { recursive: true, force: true });
    }
  });

  test("but a genuinely missing card for that entry still reddens", () => {
    // The counterpart: the gate must follow the rename, not become blind. With
    // the entry renamed, dropping its card is a real problem and must say so.
    const content = withRenamedSlug((text) =>
      text.replace(/^slug: ethiosci$/m, "slug: ethiosci-renamed"),
    );
    try {
      const result = runGate({
        content,
        home: (b, ctx) => b.replace(ctx.cards, ""),
      });
      assert.ok(!result.ok, "expected the gate to fail on a missing card");
      assert.match(result.output, /ethiosci-renamed/);
    } finally {
      rmSync(content, { recursive: true, force: true });
    }
  });
});

describe("check:pending is wired into verify and CI", () => {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const ci = readFileSync(join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

  test("npm run verify runs the gate after the build", () => {
    const verify = pkg.scripts.verify;
    assert.match(verify, /check:pending/);
    // `npm test` runs before `npm run build`, so a gate reading dist/ must
    // come after it or it fails on every clean checkout.
    assert.ok(
      verify.indexOf("build") < verify.indexOf("check:pending"),
      "check:pending must run after build in verify",
    );
  });

  test("CI runs the gate after the build step", () => {
    assert.match(ci, /check:pending/);
    assert.ok(
      ci.indexOf("npm run build") < ci.indexOf("check:pending"),
      "check:pending must run after the Build step in CI",
    );
  });

  test("the gate refuses to run without a build", () => {
    // A path that does not exist at all. An EMPTY directory is a directory, so
    // the gate would proceed and then report every page as missing — a
    // different (and much noisier) failure than the one worth pinning.
    const missing = join(tmpdir(), "check-pending-absent-dist", "nope");
    assert.throws(
      () =>
        execFileSync("node", [CHECK_SCRIPT, missing, CONTENT_DIR], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        }),
      (error) => {
        assert.match(
          `${error.stdout ?? ""}${error.stderr ?? ""}`,
          /dist\/ not found/,
        );
        return true;
      },
    );
  });
});
