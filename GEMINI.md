
# Meta-Gumo (メタグモ) Development Context

You are a senior full-stack engineer. Your goal is to implement the Meta-Gumo MVP as specified in `metagumo_spec.md`.

## Project Overview

Meta-Gumo is a platform where **the same thing looks different depending on whose voices you count**. By switching "views" (population filters), users experience how perception shifts — not as a lesson, but as a casual discovery that accumulates into subtle self-awareness.

*   **Core Concept:** Facts (objective, sourced) form the foundation. Tags (subjective labels) layer on top. Views filter *who* is counted, changing the apparent consensus. The gap between views IS the product.
*   **Key Features:**
    *   **Pages (Entities):** Neutral, fact-based articles.
    *   **Facts:** Verifiable facts with required sources.
    *   **Tags:** Subjective labels (evaluations, associations, opinions) with up/down voting.
    *   **Views (Visions):** Population filters that change which voices are counted (`flat`, `registered_only`, `leverage`; future: `ip_addr_only`, `no_bot`, `japan_ip_only`, `mynumber_verified`).
    *   **Leverage:** A system where users assign weights (−3〜+3) to followed users, creating a personalized view weighted by their social graph.

## Tech Stack

*   **Framework:** Next.js (with App Router)
*   **Backend:** Supabase (PostgreSQL + Auth)
*   **Deployment:** Vercel

## Initial Sprint Goals (MVP)

1.  **Database Schema:**
    *   Create SQL schema for: `Entity`, `Fact`, `Tag`, `Vote`, `Follow`, and basic `History`.
2.  **API Routes:**
    *   Implement the API routes as defined in the specification (section 5 of `metagumo_spec.md`).
3.  **Frontend - Tag Interaction:**
    *   Display a list of tags for a page.
    *   Implement view toggles for `flat`, `registered_only`, and `leverage` views.
    *   Implement sorting options (`score_desc`, `newest`).
4.  **Frontend - Leverage UI:**
    *   Create a user profile page.
    *   Display a list of followed users with a slider to adjust their leverage weight from -3 to +3.
5.  **Anti-Abuse Measures:**
    *   Implement CAPTCHA for anonymous users.
    *   Add a 30-second cooldown for anonymous votes/posts.
6.  **Moderation:**
    *   Implement a reporting system that automatically hides content after a certain threshold.
    *   Create a simple page for moderators to review reported content.

## Development Conventions & Constraints

*   **Leverage Formula:** Strictly implement the leverage weight formula as defined in section 4 of `metagumo_spec.md`.
*   **Testing:** Write tests for the scoring queries (`flat`, `registered_only`, `leverage`).
*   **Performance:** Avoid heavy database joins. Use materialized views if necessary to improve performance.
