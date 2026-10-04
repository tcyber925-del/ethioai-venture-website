/**
 * /robots.txt (ENG-84) — static endpoint, generated at build time so the
 * sitemap reference derives from the single site URL constant
 * (src/config/site.ts) instead of a duplicated literal.
 *
 * Allow all: there is no reason to block any crawler on a public marketing
 * site, and the sitemap line gives crawlers the route inventory.
 */
import { site } from "../config/site";

export function GET(): Response {
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${site.url}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
