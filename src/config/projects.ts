/**
 * Public project-listing rules (ENG-119, ENG-120).
 *
 * `ethiobio` stays a routable project — /work/ethiobio is built from the full
 * `projects` collection in src/pages/work/[project].astro — but is excluded from
 * the public INDEX LISTINGS: the /work index (ENG-119) and the homepage Selected
 * work section (ENG-120). The founder removed it from those listings (CR-009,
 * 2026-11-03); the detail route and the content entry are preserved.
 *
 * Shared across both listing surfaces so the shipped pages and the post-build
 * gate (scripts/check-work.mjs) read one source and cannot drift.
 *
 * An explicit list rather than a front-matter flag: the `projects` schema in
 * src/content.config.ts is a frozen content model (ENG-73), and a flag would
 * require adding a field to it (CR-009 Option B, not taken).
 */
export const listingExcludedSlugs: readonly string[] = ["ethiobio"];
