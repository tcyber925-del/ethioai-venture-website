---
# Traceability (ENG-76 evidence policy; ENG-100 content unblock). Founder
# approved publishing this project on 2026-10-05. Every fact below is taken from
# the project's own public repository — its GitHub description, README and
# release list — and nothing is asserted beyond what those sources state.
# No licence is claimed: the repository publishes none.
# `status` stays "In Development", the only status the approved specifications
# sanction for a project without evidence of production use; a tagged release
# and a live deployment are not the same as proven production use, and status
# vocabulary is a founder decision (ENG-80).
title: EthioSci
slug: ethiosci
status: In Development
category: Education
summary: >-
  An AI-assisted science learning and teaching assistant for Ethiopian middle
  and high school education (Grades 7-12) across biology, chemistry, physics
  and mathematics.
problem: >-
  Science teaching for Grades 7-12 in Ethiopia has to cover four subjects at
  once, in English and Amharic, with material that is not widely available as
  digital, curriculum-aligned content. The project's stated aim is grounding
  answers, quizzes and lesson plans in Ethiopian textbook content with
  explicit source citations, so a learner or teacher can check where a claim
  came from.
built: >-
  A Telegram bot as the primary interface, plus a Next.js teacher dashboard for
  content review, an approval workflow and monitoring. Answers cite their source
  as grade, unit and page. Quizzes, lesson plans, progress tracking and weekly
  parent summaries are part of the described feature set, with bilingual
  explanations and Amharic summaries.
architecture: >-
  A LangGraph-orchestrated pipeline (the README describes a unified graph of
  twelve or more nodes, ending in claim verification and a safety stage) over
  hybrid retrieval: dense vectors via pgvector, sparse BM25, and a cross-encoder
  reranker. Model access is multi-provider — Ollama first, then OpenRouter,
  OpenAI and Anthropic — behind a provider interface with per-provider circuit
  breakers.
implementation: >-
  Python. Authentication is cookie-based JWT with refresh-token rotation and
  Redis-backed revocation; rate limiting is tiered and Redis-backed. Generated
  quizzes and lesson plans export to DOCX and PDF.
evidence: >-
  Public repository with a tagged release (v0.3.0 — Socratic tutoring, hint
  progression, export, misconception detection) and a deployed dashboard. See
  the links on this page for both.
limitations: >-
  This entry describes what the project's own repository states; it is not an
  independent assessment. The repository publishes no licence, so reuse terms
  are undefined. No production-usage evidence has been reviewed, which is why
  the status above is conservative.
technologies:
  - Python
  - LangGraph
  - pgvector
  - BM25
  - Next.js
  - PostgreSQL
  - Redis
github: https://github.com/tcyber925-del/Ethiosci-AI-Assistant
demo: https://ethio-bio-ai-assistant.vercel.app
---
