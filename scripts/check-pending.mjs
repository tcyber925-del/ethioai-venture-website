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
 * invention. Hence the content-derived expectations — the approved step lists,
 * and each entry's approved technology list, are read from src/content/ rather
 * than restated here, so this file cannot drift from the source of truth.
 *
 * Runs after Build, like check:dist / check:seo / check:work / check:fonts,
 * because `npm test` runs BEFORE `npm run build` in both `npm run verify` and
 * CI. A test that read the real dist/ failed on every clean checkout.
 *
 * This gate's own logic was proven by mutating the built output and confirming
 * a non-zero exit for each regression (duplicate coverage, missing coverage, an
 * inaccurate Related Work string, a dropped demo link, an altered technology
 * chip, a fabricated pending entry, chips on an entry that declares none, an
 * evidence entry with no card, and both card orderings across two evidenced
 * entries).
 *
 * Deliberately NOT asserted here: the form's field list, its honeypots, or its
 * endpoint. An earlier version of this comment claimed an added form field was
 * caught here; it stopped being caught when the field-set assertion was dropped,
 * because those live in tests/start-a-project.test.mjs by design — that suite
 * reads source, this one reads built output. What this gate does assert about
 * the form is narrow and stated in its own section: the live regions must
 * survive the build OUTSIDE <form>.
 *
 * There IS a fixture battery: tests/check-pending.test.mjs asserts this gate
 * REDS on each regression below. It builds its fixture dist/ from the REAL
 * src/content rather than a fixture content tree, because this gate's whole
 * design is that its expectations derive from approved content — a fixture
 * content tree would test a different contract than the one that ships.
 *
 * That battery exists because five of the seven review rounds on this branch
 * found a real defect in this one gate, two of them false-PASSES, and every one
 * had been found by hand. An earlier version of this comment said no suite
 * covered the contract at all; that was true when written and false within a
 * commit, which is how a comment outlives the code it describes.
 *
 * tests/content-predicate.test.mjs covers the underlying `hasContent` rule; the
 * pending/evidence contract is held here, and its RED battery there.
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
 *
 * Comments are stripped first. Without that, this gate reads its own
 * expectations out of prose: a comment in [slug].astro explaining that the gate
 * parses `heading="…"` became an approved step called "…", and all five
 * solution pages went red with it neither rendered nor named pending. A gate
 * whose input includes documentation of itself cannot be reasoned about.
 */
function approvedSteps(sourceRelative, pattern) {
  const text = readSource(sourceRelative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
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
  return filesIn(dir)
    .map((file) => {
      const front = readFileSync(file, "utf8").split("---")[1] ?? "";
      return front.match(/^slug:\s*(\S+)/m)?.[1];
    })
    .filter(Boolean);
}

/**
 * Absolute paths of the markdown files in a collection directory.
 *
 * NOT slugs. An earlier version built its project list as
 * `slugsIn(dir).map((slug) => join(dir, `${slug}.md`))`, which only worked
 * because every slug happens to equal its filename today — rename `slug:` in
 * frontmatter and the gate silently stopped seeing that entry, then reported
 * its own approved chips as fabricated. Reading the directory and keeping the
 * paths removes the assumption entirely.
 */
function filesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.mdx?$/.test(f))
    .map((f) => join(dir, f));
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

// The project collection and its approved technology lists, read once. Declared
// here, above the homepage section, because the section's own expectations are
// now derived from them — an earlier version hardcoded `href="/work/ethiosci"`
// and only computed these further down.
const projectFiles = filesIn(join(contentDir, "projects")).filter(existsSync);
if (projectFiles.length === 0) {
  fail("cannot read the project collection to verify the homepage evidence");
}

/**
 * The route slug for a project entry.
 *
 * Read from the `slug:` FIELD, not the filename, because that is what
 * getStaticPaths uses: `{ params: { project: project.data.slug } }`. An earlier
 * version took the filename, which coincides today and diverges the moment the
 * two differ — renaming the slug in frontmatter then made this gate claim the
 * entry had no approved stack and that its chips were fabricated, which is the
 * false-red class this gate exists to avoid, reintroduced by the fix for it.
 */
const slugOf = (file) =>
  frontmatterValue(readFileSync(file, "utf8"), "slug") ??
  file.split("/").pop().replace(/\.md$/, "");

/** Approved `technologies` entries for one markdown file. */
const approvedTechnologies = (file) => {
  const front = readFileSync(file, "utf8");
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
  return listed;
};

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
    // The section must not describe the WEBSITE's own build. Test the visible text
    // rather than the markup — every Astro-scoped element carries
    // `data-astro-cid-*`, so an earlier version matched its own framework's
    // attribute and reported Astro on a page that had none.
    //
    // Scoped to the section's EDITORIAL LEAD — the copy this PR wrote — and not
    // to every visible mention. An approved `evidence` field is free to name
    // Astro honestly ("built on Astro"); that is the project's own evidence and
    // must never be read as the site describing itself. Only the static
    // editorial text around the evidence cards is ours to police.
    const leadEnd = section.indexOf('<li class="evidence"');
    const lead = stripTags(
      leadEnd === -1 ? section : section.slice(0, leadEnd),
    ).trim();
    for (const term of [
      "Astro",
      "TypeScript",
      "Notion",
      "Linear",
      "content collection",
      "pull request",
    ]) {
      if (new RegExp(term, "i").test(lead)) {
        fail(`/ engineering depth still proves the website (${term})`);
      }
    }
    // Derived, not hardcoded. This used to require `href="/work/ethiosci"` by
    // name, so renaming the entry would redden CI with a message about
    // "engineering depth" rather than about the entry that moved — every other
    // expectation on this page is read from src/content/. Which project the
    // section presents is decided by the entry that actually carries a
    // technology stack or evidence prose, so derive it the same way.
    const evidencedSlugs = projectFiles
      .filter((file) => {
        const front = readFileSync(file, "utf8");
        return (
          frontmatterValue(front, "evidence") !== null ||
          approvedTechnologies(file).length > 0
        );
      })
      .map((file) => slugOf(file));
    if (evidencedSlugs.length === 0) {
      fail(
        "/ no approved entry carries evidence or a technology stack, so " +
          "engineering depth has nothing to present",
      );
    }
    for (const slug of evidencedSlugs) {
      if (!section.includes(`href="/work/${slug}"`)) {
        fail(
          `/ engineering depth does not link to ${slug}, the entry it presents`,
        );
      }
    }
  }

  // Technology chips must be each entry's own approved list, in order — read from
  // the content files so this cannot drift.
  //
  // Scoped PER CARD, not across the whole page. An earlier version concatenated
  // every `evidence__tech` chip on the homepage and compared it to ethiosci.md
  // alone, so the first approved project to add a `technologies:` list would
  // turn CI red — the same false-red class round 2 fixed for `related_work`.
  // Adding content is the normal case here, not an edge case.

  // Each evidence card on the homepage, keyed by the project it links to.
  // Split positionally on the card's opening tag rather than matching its closing
  // tag: a card contains a nested `<ul>` for its stack, so a matcher of the shape
  // `</li></ul></section>` silently finds no card at all — which surfaces as "the
  // entry has no card" and looks like a content problem rather than a broken
  // matcher.
  const cards = new Map();
  {
    const listStart = home.indexOf('<ul class="evidence-list"');
    const listHtml = listStart === -1 ? "" : home.slice(listStart);

    // The list's own closing tag, found by depth-counting `<ul`/`</ul>` from the
    // start of the list. An earlier attempt searched for the next `</ul>` after
    // the first `evidence__` occurrence, which lands on a card's inner stack
    // list rather than the list's end. Cards are not nested inside each other,
    // so counting `<ul>` tags is sufficient.
    const endOfList = (() => {
      let depth = 0;
      for (const m of listHtml.matchAll(/<ul\b|<\/ul>/g)) {
        depth += m[0] === "</ul>" ? -1 : 1;
        if (depth === 0) return m.index;
      }
      return -1;
    })();

    // Card boundaries, ALL in listHtml coordinates.
    //
    // Two earlier attempts were wrong here, both in the same way — mixing
    // coordinate systems. Splitting into `parts` gives slices whose origins are
    // unknown and offset, so a list-relative index applied to them overshot the
    // list's closing tag, and `part.indexOf(next)` could never match because a
    // split-delimited part ENDS where the next part begins; it returned -1 and
    // `slice(0, -1)` silently dropped one character instead of bounding
    // anything. The first version sliced the list to end-of-document, which let
    // a URL anywhere later on the page satisfy "this card links to it".
    //
    // So: locate each card's opening tag by index, and bound it by the next
    // opening tag or the list's closing tag. One coordinate system, no
    // re-derivation of offsets.
    const CARD_OPEN = '<li class="evidence"';
    const starts = [];
    for (let at = listHtml.indexOf(CARD_OPEN); at !== -1;) {
      starts.push(at);
      at = listHtml.indexOf(CARD_OPEN, at + CARD_OPEN.length);
    }
    starts.forEach((start, index) => {
      const from = start + CARD_OPEN.length;
      const to =
        starts[index + 1] ?? (endOfList === -1 ? listHtml.length : endOfList);
      if (to <= from) return;
      const block = listHtml.slice(from, to);
      const slug = block.match(/href="\/work\/([^"]+)"/)?.[1];
      if (!slug) return;
      cards.set(slug, {
        block,
        chips: [...block.matchAll(/class="evidence__tech"[^>]*>([^<]+)</g)].map(
          (m) => m[1].trim(),
        ),
      });
    });
  }

  for (const file of projectFiles) {
    const slug = slugOf(file);
    const listed = approvedTechnologies(file);
    const card = cards.get(slug);
    if (listed.length === 0) continue; // this entry declares no stack
    if (!card) {
      fail(
        `/ ${slug} declares an approved technology stack but engineering depth ` +
          "renders no evidence card for it",
      );
      continue;
    }
    if (card.chips.join("|") !== listed.join("|")) {
      fail(
        `/ ${slug}: technology chips do not match the entry's approved list\n` +
          `      expected: ${listed.join(", ")}\n` +
          `      rendered: ${card.chips.join(", ")}`,
      );
    }
  }

  // A chip that belongs to no entry is a fabricated claim. Matched by the
  // entry's `slug:` field, since that is the slug the card links to.
  for (const [slug, card] of cards) {
    const file = projectFiles.find((f) => slugOf(f) === slug);
    const listed = file ? approvedTechnologies(file) : [];
    if (card.chips.length > 0 && listed.length === 0) {
      fail(
        `/ engineering depth renders technology chips for ${slug}, which ` +
          "declares no approved technologies",
      );
    }
  }

  // The reused `evidence` prose is rendered verbatim on the homepage, so any link
  // it SAYS is there must actually render. Which links it says is read from the
  // prose rather than assumed: an earlier version required BOTH `github:` and
  // `demo:` for every entry carrying evidence, so the first future entry with
  // honest prose and only a repository link would redden CI with "has no demo
  // URL to render" — instructing a content author to invent a deployment. That
  // is the false-red class rounds 2, 4 and 5 were spent removing.
  //
  // So: require each field whose URL the prose claims, and only those. A prose
  // that claims neither link still must render whichever URLs the entry
  // approves, so the render side is checked for every declared field.
  for (const file of projectFiles) {
    const front = readFileSync(file, "utf8");
    const evidence = frontmatterValue(front, "evidence");
    if (evidence === null) continue;
    const slug = slugOf(file);
    const card = cards.get(slug);
    if (!card) continue;

    // Which links the prose claims. "both" means both; otherwise an explicit
    // mention of the field's label. Anything unclaimed is not required, but is
    // still rendered if approved.
    const claimsBoth = /links on this page for both/i.test(evidence);
    for (const field of ["github", "demo"]) {
      const url = front.match(new RegExp(`^${field}:\\s*(\\S+)`, "m"))?.[1];
      const claimed =
        claimsBoth ||
        new RegExp(`\\b${field}\\b`, "i").test(evidence) ||
        (field === "demo" && /\blive demo\b/i.test(evidence));
      if (!url) {
        if (claimed) {
          fail(
            `${slug}.md prose claims ${field} links, but the entry approves no ` +
              `${field} URL to render`,
          );
        }
        continue;
      }
      if (!card.block.includes(`href="${url}"`)) {
        fail(
          `/ the ${field} link for ${slug} is missing from engineering depth` +
            (claimed
              ? ", so the reused evidence sentence is false on this page"
              : ""),
        );
      }
    }

    // The prose itself is the public claim on this page — "tagged release",
    // "deployed dashboard". It is reused verbatim from the entry, so assert it
    // is still there verbatim (whitespace-normalised, since the template wraps
    // it through Astro's whitespace handling).
    const rendered = card.block
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!rendered.includes(evidence.replace(/\s+/g, " ").trim())) {
      fail(
        `/ the evidence prose for ${slug} does not match the approved text\n` +
          `      approved: ${evidence}`,
      );
    }
  }

  // Selected work must render a summary for every entry that APPROVES one. The
  // condition is derived from the content, never asserted unconditionally: an
  // earlier version failed whenever no `card__summary` appeared at all, which
  // is only true while some entry carries a summary — so removing the one
  // approved summary (a legitimate content edit) reddened CI with a message
  // implying a rendering bug. Same false-red class as the chips and
  // `related_work`, in the opposite direction.
  const summaries = projectFiles.filter(
    (file) => frontmatterValue(readFileSync(file, "utf8"), "summary") !== null,
  );
  const renderedSummaries = new Set(
    [...home.matchAll(/class="card__summary"[^>]*>([^<]+)</g)].map((m) =>
      m[1].trim(),
    ),
  );
  for (const file of summaries) {
    const slug = slugOf(file);
    const approved = frontmatterValue(readFileSync(file, "utf8"), "summary");
    if (!renderedSummaries.has(approved)) {
      fail(
        `/ selected work does not render the approved summary for ${slug}\n` +
          `      approved: ${approved}`,
      );
    }
  }
  if (renderedSummaries.size > summaries.length && summaries.length > 0) {
    fail(
      `/ selected work renders ${renderedSummaries.size} summaries but only ` +
        `${summaries.length} are approved — one is not from the content`,
    );
  }
}

/**
 * The declared value of a frontmatter field in markdown source, or null when
 * the entry declares none. Handles the two shapes used here: a folded scalar
 * (`summary: >-` continued on indented lines) and a plain one-line value.
 *
 * Returns null rather than "" so "declares none" is distinguishable from
 * "declares a blank one" — the content schema forbids the latter, and the
 * difference is what lets a gate be written against the approved content
 * instead of restating it.
 */
function frontmatterValue(front, field) {
  const match = front.match(new RegExp(`^${field}:[ \\t]*(.*)$`, "m"));
  if (!match) return null;
  const first = match[1].trim();
  if (first !== "" && first !== ">-" && first !== ">") {
    return first.replace(/^["']|["']$/g, "").trim() || null;
  }
  const folded = [];
  for (const line of front.slice(match.index).split("\n").slice(1)) {
    if (!/^[ \t]+/.test(line)) break;
    folded.push(line.trim());
  }
  const value = folded.join(" ").trim();
  return value === "" ? null : value;
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
