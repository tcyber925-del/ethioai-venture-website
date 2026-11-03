/**
 * Work index listing rules (ENG-119).
 *
 * `ethiobio` stays a routable project — /work/ethiobio is built from the full
 * `projects` collection in src/pages/work/[project].astro — but is excluded
 * from the /work INDEX listing only, because the founder identified the entry
 * as duplicate/redundant in the index.
 *
 * An explicit list rather than a front-matter flag: the `projects` schema in
 * src/content.config.ts is a frozen content model (ENG-73), and a flag would
 * require adding a field to it.
 */
export const workIndexExcludedSlugs: readonly string[] = ["ethiobio"];
