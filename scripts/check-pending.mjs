#!/usr/bin/env node
/**
 * ENG-102 — deterministic gate for the pending-state and evidence changes.
 *
 * Why this exists: tests/fonts.test.mjs covers the font work, but the other three
 * scope items had no assertions at all. That gap let a real bug through — an
 * Evidence step whose content is IMAGES rather than text was filtered in as
 * "has content" but rendered nothing at all, because ProjectSection defaults
 * `hasContent` to `body !== undefined` and the call site did not pass it. The
 * content was simultaneously excluded from the pending note, so it vanished
 * silently and nothing failed.
 *
 * The invariant this gate asserts:
 *
 *   for every step in the approved sequence, EXACTLY ONE is true —
 *     it renders as a section, OR it is named in the PendingNote.
 *
 * Nothing both (a section plus a pending entry — the visitor sees it twice) and
 * nothing neither (content that silently vanishes, the ENG-80 class of bug that
 * shipped through a green run once already).
 *
 * Absence must also stay truthful, because the evidence policy is the site's
 * core constraint: real content, or an honest statement of absence, never
 * invention. Hence the content-derived expectations — the approved step lists
 * and the EthioSci technology chips are read from src/content/, not restated
 * here, so this file cannot drift from the source of truth.
 *
 * Runs after Build, like check:dist / check:seo / check:work / check:fonts,
 * because `npm test` runs BEFORE `npm run build` in both `npm run verify` and
 * CI. A test that read the real dist/ failed on every clean checkout.
 *
 * This gate's own logic was proven by mutating the built output and confirming
 * a non-zero exit for each regression (duplicate coverage, missing coverage, an
 * inaccurate Related Work string, a dropped demo link, an altered technology
 * chip, an added form field). There is no separate fixture battery file: this
 * gate reads the real content collections, so a hand-built fixture would have
 * to re-state the approved sequences and could pass while the real ones drifted.
 * The source-level contract lives in the existing suites instead.
 *
 * Local reproduction: npm run build && npm run check:pending
 * Exits non-zero on any problem (CI gate).
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Default to the repo's dist/ plus its content collections; explicit paths are
// taken as-is (the battery).
const distDir = process.argv[2] ?? join(repoRoot, "dist");
const contentDir = process.argv[3] ?? join(repoRoot, "src/content");

const failures = [];
const fail = (message) => failures.push(message);

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(
    "check:pending failed — dist/ not found. Run `npm run build` first.",
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * Approved sequences, read from the page sources
 * ------------------------------------------------------------------ */

const readSource = (relative) => readFileSync(join(repoRoot, relative), "utf8");

/**
 * Step titles as declared in the page source, so this gate cannot assert a
 * sequence the page has since been changed to. Matches `heading="..."` /
 * `title: "..."` entries in order.
 */
function approvedSteps(sourceRelative, pattern) {
  const text = readSource(sourceRelative);
  return [...text.matchAll(pattern)].map((m) => m[1]);
}

/**
 * The eight content steps, read from `sequence` in [project].astro, plus
 * Related Work.
 *
 * Related Work is rendered from a separate branch, but the page still declares
 * its title in a `title: "Related Work"` shape that the extraction regex picks
 * up — so it is already in the list and must NOT be appended again. Appending it
 * unconditionally made every Related Work failure print twice (verified: "2
 * problems" for one issue). Deduplicated rather than hardcoded, so a future
 * rename cannot silently drop the step.
 */
const PROJECT_STEP_TITLES = approvedSteps(
  "src/pages/work/[project].astro",
  /title:\s*"([^"]+)"/g,
);
if (!PROJECT_STEP_TITLES.includes("Related Work")) {
  PROJECT_STEP_TITLES.push("Related Work");
}
const PROJECT_STEPS = [...new Set(PROJECT_STEP_TITLES)];

const SOLUTION_STEPS = approvedSteps(
  "src/pages/solutions/[slug].astro",
  /heading="([^"]+)"/g,
);

/* ------------------------------------------------------------------ *
 * Built-HTML readers
 * ------------------------------------------------------------------ */

const stripTags = (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

/** Step titles rendered as an <h2>, excluding the CTA region's own heading. */
function renderedSteps(html) {
  return [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
    .map((m) => stripTags(m[1]).trim())
    .filter((t) => t !== "Start a Project");
}

/** Step titles named by the PendingNote. */
function pendingSteps(html) {
  const note = html.match(
    /<section[^>]*aria-label="Sections not yet published"[^>]*>([\s\S]*?)<\/section>/,
  );
  if (!note) return [];
  return [...note[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
    .map((m) => stripTags(m[1]).trim().split(" — ")[0].trim())
    .filter(Boolean);
}

const occurrences = (list, value) => list.filter((x) => x === value).length;

/**
 * The invariant: every approved step appears EXACTLY ONCE across the rendered
 * headings and the pending list — never twice, never zero times.
 *
 * Counts, not `includes()`. An earlier version used booleans, which cannot see a
 * duplicated heading or a pending entry naming something that is not an approved
 * step: a page with `<h2>Problem</h2>` twice AND an extra "Bogus Step" pending
 * entry passed. Both of those are checked here.
 */
function assertCovers(label, html, steps) {
  const rendered = renderedSteps(html);
  const pending = pendingSteps(html);

  if (rendered.length + pending.length === 0) {
    fail(`${label}: renders no steps and names none pending — nothing at all`);
    return;
  }

  for (const step of steps) {
    const renderedCount = occurrences(rendered, step);
    const pendingCount = occurrences(pending, step);
    if (renderedCount + pendingCount === 0) {
      fail(
        `${label}: "${step}" is neither rendered nor named pending — content ` +
          "vanishes silently (the ENG-80 bug class)",
      );
    }
    if (renderedCount + pendingCount > 1) {
      fail(
        `${label}: "${step}" appears ${renderedCount + pendingCount} times ` +
          `(${renderedCount} rendered, ${pendingCount} pending) — exactly once, ` +
          "never twice",
      );
    }
  }

  // Nothing may be named pending that is not an approved step: a fabricated
  // entry would tell the visitor a section exists when it does not.
  for (const entry of pending) {
    if (!steps.includes(entry)) {
      fail(
        `${label}: the pending note names "${entry}", which is not an approved ` +
          "step in the sequence",
      );
    }
  }

  // Likewise, a rendered heading that matches a sequence step must not appear
  // more than once (covered above), and any other h2 is page furniture — the
  // CTA — so it is not asserted here.
}

/* ------------------------------------------------------------------ *
 * Entry slugs, from the content collections
 * ------------------------------------------------------------------ */

function slugsIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => {
      const front = readFileSync(join(dir, f), "utf8").split("---")[1] ?? "";
      return front.match(/^slug:\s*(\S+)/m)?.[1];
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * 1. The complement invariant, per built entry page
 * ------------------------------------------------------------------ */

for (const slug of slugsIn(join(contentDir, "projects"))) {
  const file = join(distDir, "work", slug, "index.html");
  if (!existsSync(file)) {
    fail(`/work/${slug}: not built`);
    continue;
  }
  assertCovers(`/work/${slug}`, readFileSync(file, "utf8"), PROJECT_STEPS);
}

for (const slug of slugsIn(join(contentDir, "solutions"))) {
  const file = join(distDir, "solutions", slug, "index.html");
  if (!existsSync(file)) {
    fail(`/solutions/${slug}: not built`);
    continue;
  }
  assertCovers(
    `/solutions/${slug}`,
    readFileSync(file, "utf8"),
    SOLUTION_STEPS,
  );
}

if (PROJECT_STEPS.length === 0 || SOLUTION_STEPS.length === 0) {
  fail(
    `could not read the approved sequences from the page sources ` +
      `(project=${PROJECT_STEPS.length}, solution=${SOLUTION_STEPS.length}) — ` +
      "this gate would otherwise pass vacuously",
  );
}

/* ------------------------------------------------------------------ *
 * 2. Absence stays truthful
 * ------------------------------------------------------------------ */

for (const slug of slugsIn(join(contentDir, "projects"))) {
  const file = join(distDir, "work", slug, "index.html");
  if (!existsSync(file)) continue;
  const html = readFileSync(file, "utf8");
  const note = html.match(
    /aria-label="Sections not yet published"[\s\S]*?<\/section>/,
  );
  if (!note) continue;

  // Only assert the Related Work wording when Related Work is actually pending.
  // It is NOT pending once any solution entry declares `related_work: <slug>` —
  // the section then renders with real links and carries no pending entry at
  // all. Requiring the string unconditionally made the gate go red on a correct
  // page the first time a solution pointed at a project, which is exactly the
  // content edit this site exists to enable.
  if (pendingSteps(html).includes("Related Work")) {
    if (!/no approved related-work relationship is declared/.test(note[0])) {
      fail(
        `/work/${slug}: Related Work is pending, so it must state that no ` +
          "approved relationship is declared, not the old 'no approved " +
          "content published' placeholder",
      );
    }
  } else if (
    /no approved related-work relationship is declared/.test(note[0])
  ) {
    fail(
      `/work/${slug}: the pending note claims no relationship is declared, but ` +
        "Related Work is not listed as pending — one of the two is wrong",
    );
  }
  if (/No approved content published for this section/.test(note[0])) {
    fail(
      `/work/${slug}: the pending note still uses the old, less accurate ` +
        '"No approved content published for this section" placeholder',
    );
  }
}

/* ------------------------------------------------------------------ *
 * 3. The homepage proves the practice, not the website
 * ------------------------------------------------------------------ */

const homeFile = join(distDir, "index.html");
if (!existsSync(homeFile)) {
  fail("/: not built");
} else {
  const home = readFileSync(homeFile, "utf8");
  // Section scope: from the section's own open tag to the NEXT sibling section's
  // open tag (or the next `</main>`), rather than guessing a nesting depth. The
  // Astro-scoped attribute selectors make a `</section>\s*</div>\s*</section>`
  // pattern brittle — it was written against an assumed structure and silently
  // matched nothing.
  const start = home.indexOf('<section id="engineering-depth"');
  const after = start === -1 ? -1 : home.indexOf('<section id="', start + 10);
  const end =
    start === -1
      ? -1
      : Math.min(
          ...[after, home.indexOf("</main>", start)].filter((i) => i !== -1),
        );
  const section = start === -1 || end === -1 ? null : home.slice(start, end);
  if (!section) {
    fail("/: could not locate the engineering-depth section");
  } else {
    // Test the VISIBLE TEXT, not the markup. Every Astro-scoped element carries
    // `data-astro-cid-*`, so an earlier version of this check matched its own
    // framework's attribute and reported Astro on a page that had none.
    const visible = stripTags(section);
    for (const term of [
      "Astro",
      "TypeScript",
      "Notion",
      "Linear",
      "content collection",
      "pull request",
    ]) {
      if (new RegExp(term, "i").test(visible)) {
        fail(`/ engineering depth still proves the website (${term})`);
      }
    }
    if (!section.includes('href="/work/ethiosci"')) {
      fail("/ engineering depth does not link to the project it presents");
    }
  }

  // Technology chips must be the entry's own approved list, in order — read from
  // the content file so this cannot drift.
  const entryFile = join(contentDir, "projects", "ethiosci.md");
  if (!existsSync(entryFile)) {
    fail("cannot read src/content/projects/ethiosci.md to verify the chips");
  } else {
    const front = readFileSync(entryFile, "utf8");
    // Walk the frontmatter a line at a time. An earlier version used one regex
    // with a `$` boundary; under the `m` flag `$` matches at EVERY line end, so
    // the capture came back empty. Line-walking also states the rule plainly:
    // indented `- item` lines under `technologies:` are entries, and the first
    // line that is not one ends the list.
    const lines = front.split("\n");
    const keyAt = lines.findIndex((line) => /^technologies:\s*$/.test(line));
    const listed = [];
    if (keyAt !== -1) {
      for (let i = keyAt + 1; i < lines.length; i += 1) {
        const item = lines[i].match(/^\s+-\s+(.+)$/);
        if (!item) break;
        listed.push(item[1].trim());
      }
    }
    const chips = [
      ...home.matchAll(/class="evidence__tech"[^>]*>([^<]+)</g),
    ].map((m) => m[1].trim());
    if (listed.length === 0) {
      fail("could not read the approved technologies from ethiosci.md");
    } else if (chips.join("|") !== listed.join("|")) {
      fail(
        `/ technology chips do not match the entry's approved list\n` +
          `      expected: ${listed.join(", ")}\n` +
          `      rendered: ${chips.join(", ")}`,
      );
    }

    // The reused `evidence` prose ends "See the links on this page for both."
    // Rendering only the repository made the homepage state something false.
    for (const field of ["github", "demo"]) {
      const url = front.match(new RegExp(`^${field}:\\s*(\\S+)`, "m"))?.[1];
      if (!url) {
        fail(`ethiosci.md has no ${field} URL to render`);
      } else if (!home.includes(`href="${url}"`)) {
        fail(`/ the ${field} link is missing from engineering depth`);
      }
    }
  }

  if (!/class="card__summary"/.test(home)) {
    fail("/ Selected work does not render the approved project summaries");
  }
}

/* ------------------------------------------------------------------ *
 * 4. Built-output form scope
 * ------------------------------------------------------------------ *
 * Deliberately NOT re-asserting the approved field list or the honeypot
 * fields: tests/start-a-project.test.mjs owns those against the source, and two
 * sources of truth for a scope lock means a legitimate field change breaks in
 * two places with different fix paths. What only this gate can see is the
 * BUILT output — that the live regions survived the build OUTSIDE the form,
 * which is the invariant whose violation silently breaks the success state.
 */

const formFile = join(distDir, "start-a-project", "index.html");
if (!existsSync(formFile)) {
  fail("/start-a-project: not built");
} else {
  const form = readFileSync(formFile, "utf8");
  // The live regions must stay OUTSIDE the form so hiding it on success cannot
  // hide the announcement.
  const formEnd = form.indexOf("</form>");
  for (const role of ["status", "alert"]) {
    const at = form.indexOf(`role="${role}"`);
    if (at === -1) {
      fail(`/start-a-project: no role="${role}" region in the built page`);
    } else if (at < formEnd) {
      fail(
        `/start-a-project: role="${role}" is inside the <form> — hiding the ` +
          "form on success would hide the announcement",
      );
    }
  }
}

// ENG-102 forbids a navigation redesign. Assert the header still renders plain
// links with no button treatment migrated into it.
const homeNavFile = join(distDir, "index.html");
if (!existsSync(homeNavFile)) {
  fail("/: not built — cannot check the primary navigation");
} else {
  const nav = readFileSync(homeNavFile, "utf8").match(
    /<nav aria-label="Primary"[\s\S]*?<\/nav>/,
  )?.[0];
  if (!nav) {
    fail("/: primary nav not found");
  } else {
    for (const label of ["Solutions", "Work", "Research", "About"]) {
      if (!nav.includes(`>${label}<`)) fail(`/ primary nav lost "${label}"`);
    }
    if (/class="btn/.test(nav)) {
      fail(
        "/ primary nav was restyled as buttons — navigation redesign is out of scope",
      );
    }
  }
}

/* ------------------------------------------------------------------ *
 * 5. The locked token boundary
 * ------------------------------------------------------------------ */

const tokens = readSource("src/styles/tokens.css");
for (const [pattern, description] of [
  [/--font-sans:\s*Inter,\s*system-ui/, "--font-sans"],
  [/--text-h1-size:\s*3\.75rem/, "--text-h1-size"],
  [/--text-h2-size:\s*3rem/, "--text-h2-size"],
  [/--color-tertiary:\s*#0f5b5a/, "--color-tertiary"],
  [/--color-secondary:\s*#525252/, "--color-secondary"],
]) {
  if (!pattern.test(tokens)) {
    fail(
      `tokens.css: ${description} changed — ENG-102 locks the design tokens`,
    );
  }
}

if (failures.length > 0) {
  console.error(`check:pending failed — ${failures.length} problem(s):\n`);
  for (const problem of failures) console.error(`  ✗ ${problem}`);
  process.exit(1);
}

const projectCount = slugsIn(join(contentDir, "projects")).length;
const solutionCount = slugsIn(join(contentDir, "solutions")).length;
console.log(
  `check:pending passed — ${projectCount} project page(s), ` +
    `${solutionCount} solution page(s), 0 problems.`,
);
