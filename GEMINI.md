
# Meta-Gumo (メタグモ) Development Context

You are a senior full-stack engineer. Your goal is to implement the Meta-Gumo MVP as specified in `metagumo_spec.md`.

## Project Overview

Meta-Gumo is a social media platform that aims to visualize subjectivity by allowing users to add tags to "fact" pages. Users can switch between different "views" (filters) to see how perceptions differ.

*   **Core Concept:** A Wiki-like platform for objective facts, enriched with a social layer of subjective tags and viewpoints.
*   **Key Features:**
    *   **Pages (Entities):** Neutral, fact-based articles.
    *   **Facts:** Verifiable facts with required sources.
    *   **Tags:** Subjective labels (evaluations, associations, opinions) with up/down voting.
    *   **Views (Visions):** Different ways to aggregate and display tag scores (`flat`, `registered_only`, `leverage`).
    *   **Leverage:** A system where users can assign weights to other users' influence on their personalized "leverage" view.

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
