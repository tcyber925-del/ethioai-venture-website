/**
 * Cross-entry slug uniqueness gate (ENG-97, advisory round).
 *
 * Run: node --test
 *
 * Mechanism — slug parsing belongs to Astro, not to this test:
 * the content schemas (src/content.config.ts) validate each slug's shape,
 * but a zod field cannot see sibling entries, and a hand-rolled frontmatter
 * regex diverges from YAML (`slug : x` with a space before the colon, a
 * value on the next indented line, …) — shapes that bypassed this gate
 * while `astro sync`, `astro build` and this suite all stayed green.
 *
 * The gate therefore reads Astro's own parsed content data, always starting
 * with a fresh `astro sync` (so a clean checkout works standalone):
 *
 * 1. Disk↔store reconciliation — the layer of record: `.md` files on disk
 *    that the content store (node_modules/.astro/data-store.json) does not
 *    represent are collapsed duplicates. Identical-content copies dedupe on
 *    the loader's digest early-return without ever warning; the collapsed
 *    slug is attributed via body/frontmatter match. This layer fires on a
 *    first sync with an empty store — repro-verified (sync exit 0, zero
 *    loader warnings, duplicate still detected).
 * 2. Duplicate-slug warnings parsed from the sync output — a backstop that
 *    fires only on later syncs, once the store already holds the first
 *    entry of a colliding pair (it never fired in a first-sync repro). When
 *    it fires it is parse-accurate for every YAML shape and already names
 *    the collection, the colliding slug and both files.
 * 3. The store itself scanned for duplicate slugs. It keys entries by
 *    `data.slug` (generateIdDefault), so same-slug entries collapse into
 *    one Map entry — this layer alone cannot see today's duplicates and
 *    only pays off if the loader ever keys by path.
 *
 * Probe lifecycle: tests materialize temporary entries named `eng97tmp-*.md`
 * under src/content/<collection>/ and delete them in a `finally` block. The
 * `eng97tmp-` prefix is reserved for these probes — never author real
 * content under it. sweepTempProbes() at module load only reaps leftovers
 * from a run that crashed between write and cleanup, so probes cannot leak
 * into later runs (a crash is the only way a probe outlives its test).
 *
 * Wired via `npm test` into `npm run verify` and the CI "Unit tests" step —
 * violations fail both with the colliding slugs and files named. Pattern
 * rule for authors: README "Content authoring" (schema-enforced by
 * `npx astro sync` / `npm run build`).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Collections whose frontmatter `slug` feeds a route — mirrors src/content.config.ts. */
const COLLECTIONS = ["solutions", "projects", "research"];

const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));
const CONTENT_DIR = path.join(REPO_ROOT, "src/content");
const ASTRO_CLI = path.join(
  REPO_ROOT,
  "node_modules",
  "astro",
  "bin",
  "astro.mjs",
);
const STORE_FILE = path.join(
  REPO_ROOT,
  "node_modules",
  ".astro",
  "data-store.json",
);

/** Repo-relative posix path (stable messages on every platform). */
function toRepoRelative(absolute) {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
}

/** Run `astro sync` and return exit status plus combined output. */
function runAstroSync() {
  const result = spawnSync(process.execPath, [ASTRO_CLI, "sync"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  if (result.error) {
    return {
      status: -1,
      output: `failed to spawn astro sync: ${result.error.message}`,
    };
  }
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** Extract DuplicateContentEntrySlugError warnings → [{collection, slug, files}]. */
function parseDuplicateWarnings(output) {
  // The loader message puts the slug line, a blank line, then `Entries: `
  // and one `- path` per file (tolerated with or without the blank line).
  const pattern =
    /\*\*([^*]+)\*\* contains multiple entries with the same slug: `([^`]+)`\.[^\n]*(?:\n[^\S\n]*)+Entries:[^\S\n]*\n((?:- [^\n]*(?:\n|$))+)/g;
  const warnings = [];
  for (const match of output.matchAll(pattern)) {
    const files = match[3]
      .split("\n")
      .map((line) => line.replace(/^- /, "").trim())
      .filter(Boolean);
    warnings.push({ collection: match[1].trim(), slug: match[2], files });
  }
  return warnings;
}

/**
 * Decode the content store's string-pool JSON → Map<collection, Map<id, entry>>.
 * Numbers inside containers are pool indexes; `["Map", k, v, …]` nodes are
 * Maps (this is Astro's own serialization — the format `astro sync` writes).
 */
function decodeStore(raw) {
  const pool = JSON.parse(raw);
  const expand = (node) => {
    if (typeof node === "number") return expand(pool[node]);
    if (Array.isArray(node)) {
      if (node[0] === "Map") {
        const map = new Map();
        for (let i = 1; i + 1 < node.length; i += 2) {
          map.set(expand(node[i]), expand(node[i + 1]));
        }
        return map;
      }
      return node.map(expand);
    }
    if (node && typeof node === "object") {
      const expanded = {};
      for (const [key, value] of Object.entries(node))
        expanded[key] = expand(value);
      return expanded;
    }
    return node;
  };
  return expand(pool[0]);
}

function readStore() {
  let raw;
  try {
    raw = readFileSync(STORE_FILE, "utf8");
  } catch (error) {
    throw new Error(
      `Astro content store not found at ${toRepoRelative(STORE_FILE)} — ` +
        `\`astro sync\` (run automatically by this gate) should create it: ${error.message}`,
      { cause: error },
    );
  }
  return decodeStore(raw);
}

/** Sorted repo-relative posix paths of every `.md` FILE under one collection. */
function listCollectionMdFiles(collection) {
  const directory = path.join(CONTENT_DIR, collection);
  let stats;
  try {
    stats = statSync(directory);
  } catch {
    throw new Error(
      `Content collection directory missing: ${toRepoRelative(directory)} ` +
        `(collection "${collection}" is declared in src/content.config.ts)`,
    );
  }
  if (!stats.isDirectory()) {
    throw new Error(
      `Content collection path is not a directory: ${toRepoRelative(directory)}`,
    );
  }
  const files = [];
  const walk = (current) => {
    for (const dirent of readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, dirent.name);
      if (dirent.isDirectory()) walk(full);
      else if (dirent.isFile() && dirent.name.endsWith(".md")) {
        files.push(toRepoRelative(full));
      }
    }
  };
  walk(directory);
  return files.sort();
}

function storeCollectionEntries(store, collection) {
  const map = store.get(collection);
  if (!(map instanceof Map)) return [];
  const entries = [];
  for (const [id, entry] of map) {
    if (!entry || typeof entry !== "object" || !entry.filePath) continue;
    entries.push({
      slug: typeof entry.data?.slug === "string" ? entry.data.slug : String(id),
      filePath: entry.filePath,
      body: entry.body ?? "",
    });
  }
  return entries;
}

/** Normalize a markdown body for equality regardless of frontmatter splitter details. */
function normalizeBody(text) {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

/** Split frontmatter the way the content layer does (body = rest of file). */
function bodyOf(markdown) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(markdown);
  return normalizeBody(match ? markdown.slice(match[0].length) : markdown);
}

/**
 * The slug a file declares in its own frontmatter — ATTRIBUTION ONLY.
 *
 * Detection never reads frontmatter: it compares the on-disk file set against
 * Astro's parsed store. Attribution used to ride on the loader's duplicate
 * warning, which is racy on a cold store — Astro loads collections
 * concurrently, so with an empty store both colliding entries can be read
 * before either is written, no warning is emitted, and the diagnostic
 * degraded to "(unattributed)" naming neither the slug nor the sibling file.
 * Reading the slug the file itself declares makes the message deterministic
 * without reopening the YAML-shape bypass a regex-based *gate* would have:
 * an exotic shape can only degrade this label, never the detection, and the
 * fallback below still covers whatever this cannot read.
 */
function declaredSlugOf(markdown) {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (frontmatter === null) return null;
  const unquote = (value) => {
    const trimmed = value.trim();
    const quoted = /^(['"])([\s\S]*)\1$/.exec(trimmed);
    return (quoted ? quoted[2] : trimmed).trim() === ""
      ? null
      : (quoted ? quoted[2] : trimmed).trim();
  };
  const lines = frontmatter[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^[ \t]*slug[ \t]*:[ \t]*(.*)$/.exec(lines[index]);
    if (match === null) continue;
    const inline = unquote(match[1].replace(/\s+#.*$/, ""));
    if (inline !== null) return inline;
    // Value on the next indented, non-key line (a shape Astro accepts).
    const next = lines[index + 1];
    if (
      next !== undefined &&
      /^[ \t]+\S/.test(next) &&
      !/^[ \t]*[\w-]+[ \t]*:/.test(next)
    ) {
      return unquote(next);
    }
    return null;
  }
  return null;
}

/** Attribute a store-invisible file to the entry its identical content collapsed into. */
function identifyCollapsedEntry(collection, file, entries) {
  const raw = readFileSync(path.join(REPO_ROOT, file), "utf8");
  const body = normalizeBody(bodyOf(raw));
  const matched = entries.filter(
    (entry) => normalizeBody(entry.body) === body && raw.includes(entry.slug),
  );
  // Only a LIVE attributed path is a second copy on disk. An entry whose
  // filePath no longer exists is stale store state (a deleted probe left a
  // byte-identical path behind — the loader's digest early-return never
  // heals it), not a duplicate: skip it rather than fail a clean tree.
  const live = matched.filter((entry) =>
    existsSync(path.join(REPO_ROOT, entry.filePath)),
  );
  if (live.length === 1) {
    return {
      collection,
      slug: live[0].slug,
      files: [live[0].filePath, file],
    };
  }
  if (live.length === 0 && matched.length > 0) {
    return null;
  }
  return {
    collection,
    slug: "(unattributed)",
    files: [file],
    note:
      `identical-content duplicate suspected in "${collection}" but could not ` +
      `attribute a slug (${live.length} live/${matched.length} total ` +
      `body matches) — inspect its frontmatter`,
  };
}

/**
 * Name the collision behind a file the store does not represent.
 *
 * Primary path: the file's own declared slug matched against the store — this
 * is what makes the diagnostic independent of the loader's duplicate warning
 * (unreliable on a cold store). Fallback: identical-content body matching,
 * which is the only signal left for an entry whose frontmatter this cannot
 * read.
 */
function attributeUnrepresented(collection, file, entries) {
  const raw = readFileSync(path.join(REPO_ROOT, file), "utf8");
  const declared = declaredSlugOf(raw);
  if (declared !== null) {
    const live = entries.filter(
      (entry) =>
        entry.slug === declared &&
        existsSync(path.join(REPO_ROOT, entry.filePath)),
    );
    if (live.length >= 1) {
      return {
        collection,
        slug: declared,
        files: [...new Set([...live.map((entry) => entry.filePath), file])],
      };
    }
  }
  return identifyCollapsedEntry(collection, file, entries);
}

/**
 * The gate. Runs a fresh sync, then reads Astro's parsed content data
 * (warnings + store) and the on-disk file set.
 * Returns [{collection, slug, files, note?}] — throws with the full astro
 * output when sync itself fails (schema violations, error-mode duplicates).
 */
function gateViolations() {
  const { status, output } = runAstroSync();
  if (status !== 0) {
    throw new Error(`astro sync failed (exit ${status}):\n${output}`);
  }

  // Backstop (later syncs only): the glob loader's duplicate-slug warnings —
  // parse-accurate for every YAML shape, naming collection, slug, both files.
  const violations = parseDuplicateWarnings(output).map((violation) => ({
    ...violation,
    via: "warning",
  }));
  const namedInWarnings = new Set(
    violations.flatMap((violation) => violation.files),
  );

  const store = readStore();
  for (const collection of COLLECTIONS) {
    const entries = storeCollectionEntries(store, collection);

    // Store self-scan (no-op while the loader keys entries by data.slug and
    // same-slug entries collapse into one Map entry).
    violations.push(
      ...findDuplicateSlugs(
        entries.map((entry) => ({ file: entry.filePath, slug: entry.slug })),
      ).map((duplicate) => ({ ...duplicate, collection, via: "store" })),
    );

    // Layer of record: files on disk the store does not represent — this is
    // what detects a first-sync duplicate and any identical-content copy
    // (digest dedupe, no warning possible). Attribution reads each file's own
    // declared slug, so the message names the colliding slug and both files
    // even when the loader emitted no warning (cold store).
    const storedPaths = new Set(entries.map((entry) => entry.filePath));
    for (const file of listCollectionMdFiles(collection)) {
      if (storedPaths.has(file) || namedInWarnings.has(file)) continue;
      const collapsed = attributeUnrepresented(collection, file, entries);
      if (collapsed) {
        violations.push({ ...collapsed, via: "reconciliation" });
      }
    }
  }
  // A pair whose two files are both live in the store can warn twice (each
  // overwrite sees the other as existing), and a warning can coincide with
  // reconciliation: one collision must be reported once.
  const seen = new Set();
  return violations.filter((violation) => {
    const key = [
      violation.collection,
      violation.slug,
      [...violation.files].sort().join(","),
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatViolations(violations) {
  return violations
    .map(
      ({ collection, slug, files, note }) =>
        `Duplicate slug "${slug}" in collection "${collection}": ${files.join(", ")}` +
        (note ? ` — ${note}` : ""),
    )
    .join("\n");
}

// --- shared duplicate detector (used for store entries) ---

/**
 * Slugs used by more than one entry of a collection.
 * Returns [{ slug, files }] — empty when every slug is unique.
 * Entries without a slug are skipped (schema enforcement covers absence).
 */
function findDuplicateSlugs(entries) {
  const bySlug = new Map();
  for (const { file, slug } of entries) {
    if (!slug) continue;
    const files = bySlug.get(slug) ?? [];
    files.push(file);
    bySlug.set(slug, files);
  }
  return [...bySlug.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([slug, files]) => ({ slug, files }));
}

// --- crash recovery: temp probes must never outlive a run ---

function sweepTempProbes() {
  for (const collection of COLLECTIONS) {
    const dir = path.join(CONTENT_DIR, collection);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir, { recursive: true }).map(String)) {
      if (!name.startsWith("eng97tmp-") || !name.endsWith(".md")) continue;
      const full = path.join(dir, name);
      if (statSync(full).isFile()) rmSync(full, { force: true });
    }
  }
}
sweepTempProbes();

describe("decodeStore", () => {
  test("resolves the string-pool format into collections, entries and data", () => {
    const sample = JSON.stringify([
      ["Map", 1, 2],
      "projects",
      ["Map", 3, 4],
      "ethiobio",
      { id: 3, data: 5, filePath: 6, digest: 7, body: 8 },
      { title: 9, slug: 3 },
      "src/content/projects/ethiobio.md",
      "abc123",
      "",
      "EthioBio",
    ]);
    const store = decodeStore(sample);
    const projects = store.get("projects");
    assert.ok(projects instanceof Map, "projects collection decodes to a Map");
    const entry = projects.get("ethiobio");
    assert.equal(entry.filePath, "src/content/projects/ethiobio.md");
    assert.equal(entry.data.slug, "ethiobio");
    assert.equal(entry.data.title, "EthioBio");
    assert.equal(entry.digest, "abc123");
  });
});

describe("parseDuplicateWarnings", () => {
  // Mirrors the loader's real output — including the blank line before
  // `Entries: ` that the message embeds.
  const sample = [
    "15:56:52 [content] Syncing content",
    "15:56:52 [WARN] [glob-loader] **projects** contains multiple entries with the same slug: `ethiobio`. Slugs must be unique.",
    "",
    "Entries: ",
    "- src/content/projects/eng97tmp-bypass-b.md",
    "- src/content/projects/ethiobio.md",
    "15:56:52 [content] Synced content",
  ].join("\n");
  test("extracts collection, colliding slug and both files", () => {
    assert.deepEqual(parseDuplicateWarnings(sample), [
      {
        collection: "projects",
        slug: "ethiobio",
        files: [
          "src/content/projects/eng97tmp-bypass-b.md",
          "src/content/projects/ethiobio.md",
        ],
      },
    ]);
  });
  test("tolerates the message without its blank line", () => {
    const compact = [
      "**solutions** contains multiple entries with the same slug: `workflow-automation`. Slugs must be unique.",
      "Entries: ",
      "- src/content/solutions/workflow-automation.md",
      "- src/content/solutions/eng97tmp-shape-spacecolon.md",
    ].join("\n");
    assert.deepEqual(parseDuplicateWarnings(compact), [
      {
        collection: "solutions",
        slug: "workflow-automation",
        files: [
          "src/content/solutions/workflow-automation.md",
          "src/content/solutions/eng97tmp-shape-spacecolon.md",
        ],
      },
    ]);
  });
  test("returns empty for a clean sync", () => {
    assert.deepEqual(
      parseDuplicateWarnings("15:56:52 [content] Synced content"),
      [],
    );
  });
});

describe("listCollectionMdFiles", () => {
  test("missing collection directory fails with a clear diagnostic", () => {
    assert.throws(
      () => listCollectionMdFiles("eng97tmp-does-not-exist"),
      /missing: src\/content\/eng97tmp-does-not-exist/,
    );
  });
});

describe("findDuplicateSlugs", () => {
  test("reports a slug used twice, naming the colliding slug and both files", () => {
    const duplicates = findDuplicateSlugs([
      { file: "src/content/projects/a.md", slug: "ethiobio" },
      { file: "src/content/projects/b.md", slug: "ethiobio" },
      { file: "src/content/projects/c.md", slug: "other" },
    ]);
    assert.deepEqual(duplicates, [
      {
        slug: "ethiobio",
        files: ["src/content/projects/a.md", "src/content/projects/b.md"],
      },
    ]);
  });

  test("returns empty when every slug is unique", () => {
    const duplicates = findDuplicateSlugs([
      { file: "src/content/solutions/a.md", slug: "one" },
      { file: "src/content/solutions/b.md", slug: "two" },
    ]);
    assert.deepEqual(duplicates, []);
  });

  test("ignores entries without a slug", () => {
    const duplicates = findDuplicateSlugs([
      { file: "src/content/research/.gitkeep.md", slug: "" },
    ]);
    assert.deepEqual(duplicates, []);
  });
});

describe("src/content slug uniqueness", () => {
  test("no duplicate slugs in any collection", () => {
    const violations = gateViolations();
    assert.equal(violations.length, 0, formatViolations(violations));
  });
});

describe("frontmatter shapes (materialized through Astro's parser)", () => {
  // Schema-valid shapes only: invalid ones (missing slug, bad pattern) are
  // rejected by `astro sync` itself — that guarantee moved to the schema.
  const SHAPE_CASES = [
    {
      name: "plain value",
      collection: "solutions",
      file: "eng97tmp-shape-plain.md",
      slugLine: "slug: eng97tmp-shape-plain",
      parsedSlug: "eng97tmp-shape-plain",
    },
    {
      name: "inline YAML comment",
      collection: "solutions",
      file: "eng97tmp-shape-comment.md",
      slugLine: "slug: eng97tmp-shape-comment # approved route",
      parsedSlug: "eng97tmp-shape-comment",
    },
    {
      name: "quoted value with trailing comment",
      collection: "solutions",
      file: "eng97tmp-shape-quoted.md",
      slugLine: 'slug: "eng97tmp-shape-quoted" # note',
      parsedSlug: "eng97tmp-shape-quoted",
    },
    {
      name: "CRLF line endings",
      collection: "solutions",
      file: "eng97tmp-shape-crlf.md",
      slugLine: "slug: eng97tmp-shape-crlf",
      parsedSlug: "eng97tmp-shape-crlf",
      crlf: true,
    },
    {
      name: "bypass: space before colon (duplicate of an approved entry)",
      collection: "solutions",
      file: "eng97tmp-shape-spacecolon.md",
      slugLine: "slug : workflow-automation",
      duplicate: {
        slug: "workflow-automation",
        otherFile: "src/content/solutions/workflow-automation.md",
      },
    },
    {
      name: "bypass: value on the next indented line (duplicate of an approved entry)",
      collection: "projects",
      file: "eng97tmp-shape-nextline.md",
      slugLine: "slug:\n  ethiobio",
      duplicate: {
        slug: "ethiobio",
        otherFile: "src/content/projects/ethiobio.md",
      },
    },
  ];

  function shapeMarkdown(shape) {
    const markdown =
      `---\ntitle: "ENG-97 shape probe — ${shape.name}"\n${shape.slugLine}\n---\n\n` +
      "Temporary probe (ENG-97 advisory round). Removed by the test's cleanup.\n";
    return shape.crlf ? markdown.replace(/\n/g, "\r\n") : markdown;
  }

  test("detects both bypass duplicates and parses every other shape", () => {
    const created = [];
    try {
      // Guarantee a fully hydrated store before planting probes: on a first
      // sync (empty store) the loader emits no duplicate warnings at all, and
      // a store entry pointing at a deleted byte-identical path suppresses
      // them on later syncs too (the warning requires the prior occupant's
      // file to still exist). Sync once on the clean tree, then plant.
      rmSync(STORE_FILE, { force: true });
      const hydrated = runAstroSync();
      assert.equal(hydrated.status, 0, hydrated.output);

      for (const shape of SHAPE_CASES) {
        const file = path.join(CONTENT_DIR, shape.collection, shape.file);
        writeFileSync(file, shapeMarkdown(shape));
        created.push(file);
      }

      // Gate: both bypass shapes must surface as duplicates, nothing else.
      const violations = gateViolations();
      const expectedDups = SHAPE_CASES.filter((shape) => shape.duplicate);
      for (const shape of expectedDups) {
        const relative = path.posix.join(
          "src/content",
          shape.collection,
          shape.file,
        );
        const hit = violations.find(
          (violation) =>
            violation.slug === shape.duplicate.slug &&
            violation.files.includes(relative) &&
            violation.files.includes(shape.duplicate.otherFile),
        );
        assert.ok(
          hit,
          `${shape.name} must be reported as a duplicate of ${shape.duplicate.otherFile}\n` +
            `reported:\n${formatViolations(violations) || "(none)"}`,
        );
      }
      assert.deepEqual(
        violations.map((violation) => violation.slug).sort(),
        expectedDups.map((shape) => shape.duplicate.slug).sort(),
        `only the planted duplicates may be reported\n${formatViolations(violations)}`,
      );

      // Astro's parser: every shape resolves to its schema-visible slug.
      const store = readStore();
      for (const shape of SHAPE_CASES.filter((entry) => entry.parsedSlug)) {
        const relative = path.posix.join(
          "src/content",
          shape.collection,
          shape.file,
        );
        const entries = storeCollectionEntries(store, shape.collection);
        const entry = entries.find(
          (candidate) => candidate.filePath === relative,
        );
        assert.equal(
          entry?.slug,
          shape.parsedSlug,
          `${shape.name}: content store must hold ${shape.parsedSlug}`,
        );
      }
    } finally {
      for (const file of created) rmSync(file, { force: true });
    }
  });

  test("detects a byte-identical copy via reconciliation (digest dedupe never warns)", () => {
    const source = path.join(
      CONTENT_DIR,
      "solutions",
      "workflow-automation.md",
    );
    const copy = path.join(
      CONTENT_DIR,
      "solutions",
      "eng97tmp-identical-copy.md",
    );
    writeFileSync(copy, readFileSync(source));
    try {
      const violations = gateViolations();
      const hit = violations.find(
        (violation) =>
          violation.slug === "workflow-automation" &&
          violation.files.includes(
            "src/content/solutions/workflow-automation.md",
          ) &&
          violation.files.includes(
            "src/content/solutions/eng97tmp-identical-copy.md",
          ),
      );
      assert.ok(
        hit,
        "a byte-identical copy must be reported by disk↔store reconciliation " +
          `(digest early-return means no warning can fire)\nreported:\n` +
          (formatViolations(violations) || "(none)"),
      );
      assert.equal(
        hit.via,
        "reconciliation",
        "identical-content detection must come from the layer of record",
      );
    } finally {
      rmSync(copy, { force: true });
      // The loader's digest early-return keeps the deleted copy's path in the
      // store forever (byte-identical content never re-processes), which would
      // poison later runs and the build step — reset the store instead.
      rmSync(STORE_FILE, { force: true });
    }
  });

  test("attributes a duplicate on a COLD store — declared slug, no loader warning needed", () => {
    // Astro loads collections concurrently: with an empty store both colliding
    // entries can be read before either is written, so the glob loader emits
    // no duplicate warning at all (and `astro sync`/`npm run build` exit 0 in
    // silence). Detection and attribution must both survive that, and the
    // message must still name the slug and both files.
    rmSync(STORE_FILE, { force: true });
    const copy = path.join(
      CONTENT_DIR,
      "projects",
      "eng97tmp-cold-duplicate.md",
    );
    writeFileSync(
      copy,
      "---\ntitle: Duplicate slug\nslug: ethiobio\n---\n\nA different body, same slug.\n",
    );
    try {
      const violations = gateViolations();
      const hit = violations.find(
        (violation) =>
          violation.slug === "ethiobio" &&
          violation.files.includes("src/content/projects/ethiobio.md") &&
          violation.files.includes(
            "src/content/projects/eng97tmp-cold-duplicate.md",
          ),
      );
      assert.ok(
        hit,
        "a cold-store duplicate must be attributed by the slug the file " +
          `declares\nreported:\n${formatViolations(violations) || "(none)"}`,
      );
      assert.equal(
        hit.via,
        "reconciliation",
        "cold-store attribution must come from the layer of record",
      );
    } finally {
      rmSync(copy, { force: true });
      rmSync(STORE_FILE, { force: true });
    }
  });
});
