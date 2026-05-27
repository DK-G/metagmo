
# Meta-Gumo (メタグモ) Development Context

You are a senior full-stack engineer. Your goal is to implement the Meta-Gumo MVP as specified in `metagumo_spec.md`.

## Project Overview

Meta-Gumo is a social media platform that aims to visualize subjectivity by allowing users to add tags to "fact" pages. Users can switch between different "views" (filters) to see how perceptions differ.

*   **Core Concept:** A Wiki-like platform for objective facts, enriched with a social layer of subjective tags and viewpoints.
*   **Key Features:**
    *   **Pages (Entities):** Neutral, fact-based articles.
    *   **Facts:** Verifiable facts with required sources.
    *   **Tags:** Subjective labels (evaluations, associations, opinions) with up/down voting.
    *   **MVP Views:** Three anonymous tag aggregation toggles: `直近一週間`, `合意`, and `論争`.
    *   **Future Views:** `registered_only`, trust-weighted views, and leverage are post-MVP concepts.

## Tech Stack

*   **Framework:** Next.js (with App Router)
*   **Backend:** Supabase (PostgreSQL + Auth)
*   **Deployment:** Vercel

## Current Sprint Goals (MVP)

1.  **Database Schema:**
    *   Create SQL schema for: `Entity`, `Fact`, `Tag`, `Vote`, `Follow`, and basic `History`.
2.  **API Routes:**
    *   Implement anonymous MVP API routes for entities, facts, tags, and votes as defined in `metagumo_spec.md`.
3.  **Frontend - Word Cloud and Views:**
    *   Display tags for a page as a word cloud.
    *   Size words by `up - down` net score.
    *   Implement the three MVP view toggles: `直近一週間`, `合意`, and `論争`.
    *   Implement sorting options (`score_desc`, `newest`).
4.  **Search:**
    *   Implement title/tag partial-match search.

## Development Conventions & Constraints

*   **MVP Scope:** No login, no authentication, no `registered_only`, no `leverage`, no CAPTCHA, and no moderation in the MVP unless `metagumo_spec.md` is updated first.
*   **Fact Rules:** Facts must be verifiable and require a source URL.
*   **View Logic:** Strictly implement the three MVP view button rules in `metagumo_spec.md`.
*   **Testing:** Prefer tests for MVP scoring queries (`直近一週間`, `合意`, `論争`) and search/sort behavior.
*   **Performance:** Avoid heavy database joins. Use materialized views if necessary to improve performance.
*   **Agent Entry:** `AGENTS.md` is the current coding-agent entrypoint. This file is supplementary context only.
