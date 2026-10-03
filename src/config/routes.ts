/**
 * Build-time route registry.
 *
 * The site shell (ENG-77) lands before the G2 pages exist. To avoid shipping
 * dead links (review requirement from PR #3), nav/footer items render as
 * plain text until the page module exists under src/pages; they become links
 * automatically when the route's page is added (G2/G3). Home always exists.
 *
 * Matching rules (ENG-78 reviews — dynamic-segment awareness):
 * - literal files: `start-a-project.astro`, `solutions/index.astro`
 * - dynamic route files: `work/[project].astro` matches `work/ethiobio`,
 *   because G2 detail pages are built with `getStaticPaths`
 * - a rest segment (`docs/[...slug]`) matches its parent path too (`docs`)
 * - `?query` and `#hash` suffixes are ignored when matching
 * - non-internal refs (external URLs, `mailto:`, `#anchors`) are not
 *   existence-checked: there is no page module to look up, so they report
 *   as available and callers render them live
 *
 * The pure matching logic lives in `route-patterns.ts` (no Vite APIs) with a
 * regression suite in `tests/` — run `node --test`. `routeExists`
 * itself needs `import.meta.glob`, so it stays here.
 *
 * Contracts for callers (shared with Header.astro / Footer.astro):
 * - A collection route (`/work/...`, `/solutions/...`) activates only when a
 *   matching file exists — build slugs from the same `src/content`
 *   collection the detail page reads (homepage cards do), or a slug outside
 *   the collection could render as a live link whose page is never emitted.
 *   Detail pages must also emit params from the entry's `data.slug` (as the
 *   homepage links do), not a divergent identifier such as `entry.id`.
 *   File shape is checked; `getStaticPaths` output is not visible at build
 *   time from here.
 * - A nav index route (`/work`, `/solutions`, …) needs its index page
 *   (`work/index.astro`); dynamic children do not imply it. Every open G2
 *   PR ships one (PRs #8 and #10).
 */
import {
  isInternalSitePath,
  normalizeRoutePath,
  routeMatchesFile,
} from "./route-patterns";

const pageModules = import.meta.glob("../pages/**/*.astro");

/** Whether a route resolves to an existing page module at build time. */
export function routeExists(route: string): boolean {
  if (!isInternalSitePath(route)) return true;
  const path = normalizeRoutePath(route);
  if (path === "") return true;
  const candidates = [`../pages/${path}.astro`, `../pages/${path}/index.astro`];
  if (candidates.some((candidate) => candidate in pageModules)) return true;
  return Object.keys(pageModules).some((key) => {
    const file = key.replace(/^\.\.\/pages\//, "").replace(/\.astro$/, "");
    return routeMatchesFile(path, file);
  });
}
