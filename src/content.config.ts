import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

/*
 * Content collections — frozen content model.
 *
 * Sources of truth:
 * - Notion "04 — Technical Architecture & Content Model" (frozen by ENG-73)
 * - MIS v1.0 "Technical contract" (content collections + field lists)
 *
 * Field lists are transcribed exactly from the approved specification.
 * Evidence rule (MIS): fields are optional where evidence/content is
 * unavailable; do not fabricate values merely to satisfy the schema.
 * Therefore only identity fields (title, slug) are required so an entry can
 * route; every content field is optional.
 *
 * Status note: the approved specs require a `status` field but do not define
 * a status-taxonomy enum (spec 02 references a "status taxonomy" for the Work
 * page without enumerating values). Status is validated as a non-empty string
 * when present; the enum stays undefined until the specification defines it.
 * Seeded value "In Development" for EthioBio is mandated by MIS v1.0.
 */

/** Required identity text. */
const text = z.string().min(1);
/** Optional narrative/metadata text — omitted when no evidence exists. */
const optionalText = text.optional();
/** Optional list of strings — omitted when no evidence exists. */
const stringList = z.array(text).optional();

/**
 * Approved slug pattern (ENG-97). Slugs interpolate directly into dynamic
 * routes (/solutions/[slug], /work/[project], /research/[slug]) and into
 * cross-page relation links, so they must be lowercase URL-safe: letters,
 * digits and single hyphens only — no spaces, no slashes. Cross-collection
 * uniqueness is a separate rule (a zod field cannot see sibling entries);
 * it is enforced by tests/content-slugs.test.mjs in `npm run verify`.
 */
const slug = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "must match ^[a-z0-9]+(?:-[a-z0-9]+)*$ (lowercase URL-safe slug, e.g. workflow-automation)",
  );

const solutions = defineCollection({
  loader: glob({ base: "./src/content/solutions", pattern: "**/*.md" }),
  schema: z.object({
    title: text,
    slug,
    summary: optionalText,
    problem: optionalText,
    what_we_build: optionalText,
    applications: stringList,
    how_it_works: optionalText,
    capabilities: stringList,
    related_work: stringList,
    engagement_path: optionalText,
    status: optionalText,
    images: stringList,
  }),
});

const projects = defineCollection({
  loader: glob({ base: "./src/content/projects", pattern: "**/*.md" }),
  schema: z.object({
    title: text,
    slug,
    status: optionalText,
    category: optionalText,
    summary: optionalText,
    problem: optionalText,
    built: optionalText,
    architecture: optionalText,
    implementation: optionalText,
    evidence: optionalText,
    limitations: optionalText,
    learnings: optionalText,
    next: optionalText,
    technologies: stringList,
    github: optionalText,
    demo: optionalText,
    images: stringList,
  }),
});

const research = defineCollection({
  loader: glob({ base: "./src/content/research", pattern: "**/*.md" }),
  schema: z.object({
    title: text,
    slug,
    status: optionalText,
    topic: optionalText,
    question: optionalText,
    context: optionalText,
    investigation: optionalText,
    experiments: optionalText,
    results: optionalText,
    observations: optionalText,
    limitations: optionalText,
    learnings: optionalText,
    next: optionalText,
    sources: stringList,
    github: optionalText,
  }),
});

export const collections = { solutions, projects, research };
