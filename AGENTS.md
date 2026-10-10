# Project Agent Guide

This project is managed from the portfolio workspace at `D:\dev`.
Coding sessions should normally start in this project folder. This file is the
local entrypoint for agents working on this project.

## Shared Portfolio Rules

Use these shared files as the source of truth for cross-project behavior:

- Common guide: `D:\dev\AGENTS.md`
- Shared routines: `D:\dev\docs\skills\`

Keep this file focused on project-specific context. Do not copy the full shared
routine bodies into this project.

## Local Read Order

Read local files in this order:

1. `task.md` for the current work and handoff notes
2. `metagmo_spec.md` for product scope, data model, and MVP behavior
3. `GEMINI.md` for project overview and development direction
4. `RoadMap.md` for roadmap items
5. `README.md` for setup and commands

## Routine Invocation

When the user invokes one of these names, read the matching portfolio routine:

- `bynote`: `D:\dev\docs\skills\bynote.md`
- `bythink`: `D:\dev\docs\skills\bythink.md`
- `bycheck`: `D:\dev\docs\skills\bycheck.md`
- `bygit`: `D:\dev\docs\skills\bygit.md`
- `bystitch`: `D:\dev\docs\skills\bystitch.md`
- `bysearch`: `D:\dev\docs\skills\bysearch.md`

If the shared file cannot be read, continue with the same intent using local
primary sources and mention the unavailable shared file in the result.

## Project-Specific Notes

- Main stack: npm workspaces monorepo. `apps/worker` is a Cloudflare Worker (TypeScript) backed by D1; the Worker serves both the API and the HTML pages. Shared packages live under `packages/*`. Decision record: `spec.md` §7 (2026-10-10). The Next.js scaffold `apps/web` from the previous plan was removed on 2026-10-11 (Q-008).
- Main commands: `npm test` (vitest against a local D1), `npm run typecheck` and `npm run lint` (eslint + typescript-eslint) all delegate to `apps/worker`. Local dev server: `npm --workspace apps/worker run dev`.
- Deployment target: Cloudflare Workers + D1. The production D1 is not created yet (`apps/worker/wrangler.jsonc` holds a placeholder id); deploying is a human-attended step.
- Schema: `apps/worker/migrations/` is the source of truth. Add a new numbered migration instead of editing an applied one.
- Important constraints: MVP currently allows anonymous API routes; implement R1 tasks against `metagmo_spec.md`; preserve the 3-view filter model (recent week, consensus, controversy); keep workspace boundaries between `apps/*` and `packages/*`.
- Package manager: npm only (`packageManager: npm@10.8.2`, `package-lock.json`); dependency versions are pinned exactly, do not use `latest`. Current active work is API routes and word-cloud UI.
