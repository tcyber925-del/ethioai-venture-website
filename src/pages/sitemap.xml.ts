/**
 * /sitemap.xml (ENG-84) — static endpoint, dependency-free (no
 * @astrojs/sitemap: the route inventory is small and derivable, so a
 * generated XML file keeps the AGENTS.md "avoid unnecessary dependencies"
 * rule intact).
 *
 * Route inventory stays honest by derivation, not duplication:
 * - static routes come from the approved primary navigation
 *   (src/config/site.ts) plus home, each gated through routeExists — an
 *   entry can never be advertised before its page module exists (the same
 *   dead-link policy the nav, footer and 404 page follow). /start-a-project
 *   is a V1 route per the PRD: it appears automatically once ENG-83's page
 *   lands, whichever of the two merges first — no dead window either way;
 * - detail routes come from the same content collections the pages'
 *   getStaticPaths read, so a sitemap entry can never outlive its page.
 *
 * Every <loc> is verified against the built dist/ by scripts/check-seo.mjs
 * (wired into `npm run verify`), so a dead entry reds the gate.
 *
 * URL form: trailing-slash directory URLs, matching Cloudflare Pages'
 * `auto-trailing-slash` canonical form (see BaseLayout's canonical logic).
 */
import { getCollection } from "astro:content";
import { site, primaryNav } from "../config/site";
import { routeExists } from "../config/routes";

/** Minimal XML text escape for URL content (slugs are [a-z0-9-] today). */
const escapeXml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

export async function GET(): Promise<Response> {
  // Static entries only: home always exists; nav items activate with their
  // page module (routeExists), so a route is never listed before it builds.
  const staticPaths = ["/", ...primaryNav.map(({ href }) => href)].filter(
    routeExists,
  );
  const [solutions, projects, research] = await Promise.all([
    getCollection("solutions"),
    getCollection("projects"),
    getCollection("research"),
  ]);
  const detailPaths = [
    ...solutions.map((entry) => `/solutions/${entry.data.slug}`),
    ...projects.map((entry) => `/work/${entry.data.slug}`),
    ...research.map((entry) => `/research/${entry.data.slug}`),
  ];

  const urls = [...staticPaths, ...detailPaths].map((path) => {
    const withSlash = path.endsWith("/") ? path : `${path}/`;
    return `  <url><loc>${escapeXml(`${site.url}${withSlash}`)}</loc></url>`;
  });

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
