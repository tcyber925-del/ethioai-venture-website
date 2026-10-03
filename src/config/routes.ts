/**
 * Build-time route registry.
 *
 * The site shell (ENG-77) lands before the G2 pages exist. To avoid shipping
 * dead links (review requirement from PR #3), nav/footer items render as
 * plain text until the page module exists under src/pages; they become links
 * automatically when the route's page is added (G2/G3). Home always exists.
 */
const pageModules = import.meta.glob("../pages/**/*.astro");

/** Whether a route resolves to an existing page module at build time. */
export function routeExists(route: string): boolean {
  const path = route.replace(/^\//, "").replace(/\/$/, "");
  if (path === "") return true;
  const candidates = [`../pages/${path}.astro`, `../pages/${path}/index.astro`];
  return candidates.some((candidate) => candidate in pageModules);
}
