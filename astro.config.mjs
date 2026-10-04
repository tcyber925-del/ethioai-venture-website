// @ts-check
import { defineConfig } from "astro/config";
import { site } from "./src/config/site";

// https://astro.build/config
export default defineConfig({
  // Deployed root URL (ENG-84) — imported from src/config/site.ts so every
  // absolute URL in the site (canonical, Open Graph, sitemap, robots.txt)
  // derives from one constant. See site.url for the domain swap point.
  site: site.url,
});
