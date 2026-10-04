/**
 * Cross-entry slug uniqueness gate (ENG-97).
 *
 * Run: node --test
 *
 * The content schemas (src/content.config.ts) validate each slug's shape,
 * but a zod field cannot see sibling entries: duplicate slugs within a
 * collection collide in `getStaticPaths` and in cross-page relation links.
 * This suite is the validation step wired into `npm run verify` (`npm test`
 * runs here, and CI runs the identical command in "Unit tests"), so a
 * duplicate fails the build with the colliding slugs named.
 *
 * Pattern rule for authors is documented in README "Content authoring" and
 * enforced by the schema itself (`npx astro sync` / `npm run build`).
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Collections whose frontmatter `slug` feeds a route — mirrors src/content.config.ts. */
const COLLECTIONS = ["solutions", "projects", "research"];

const CONTENT_DIR = fileURLToPath(new URL("../src/content/", import.meta.url));

/** Read the frontmatter `slug:` value of one markdown entry ("" when absent). */
function readFrontmatterSlug(markdown) {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (!block) return "";
  const line = /^slug:[ \t]*(.*?)[ \t]*$/m.exec(block[1]);
  if (!line) return "";
  let value = line[1];
  if (
    value.length > 1 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

/** All entries of one collection: [{ file, slug }] with repo-relative paths. */
function collectionEntries(collection) {
  const dir = path.join(CONTENT_DIR, collection);
  const names = readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".md"))
    .sort();
  return names.map((name) => ({
    file: path.posix.join("src/content", collection, name),
    slug: readFrontmatterSlug(readFileSync(path.join(dir, name), "utf8")),
  }));
}

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
  for (const collection of COLLECTIONS) {
    test(`${collection}: no duplicate slugs`, () => {
      const duplicates = findDuplicateSlugs(collectionEntries(collection));
      const message = duplicates
        .map(
          ({ slug, files }) =>
            `Duplicate slug "${slug}" in collection "${collection}": ${files.join(", ")}`,
        )
        .join("\n");
      assert.equal(duplicates.length, 0, message);
    });
  }
});
