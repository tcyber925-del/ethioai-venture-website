# Project profile for EthioAI Venture Website

## repo
tcyber925-del/ethioai-venture-website

## base_branch
main

## setup_command
npm ci

## fast_gate
npm run format:check && npm run lint && npm run typecheck && npm run test

## full_gate
npm run verify

## high_risk_areas
astro.config.mjs
src/**/*
.env*

## protected_paths
- .github/workflows/**
- package.json
- package-lock.json
- astro.config.mjs
- wrangler.jsonc
- .env*
- AGENTS.md

## review_perspectives
code; accessibility/security; SEO; preview smoke

## non_goals
Backend APIs, user accounts, private data, deployment orchestration, content generated outside approved specs

## known_limitations
Astro rendered output and SEO fixtures are exercised by `npm run verify`; UX/accessibility is not covered by browser automation yet.
