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

- Main stack: npm workspaces monorepo, `apps/web` Next.js App Router + TypeScript, Supabase/PostgreSQL backend, shared packages under `packages/*`.
- Main commands: `npm run dev`, `npm run build`, `npm run lint`; root scripts delegate to `apps/web`.
- Deployment target: Vercel is documented as the current target; confirm before changing deploy configuration.
- Important constraints: MVP currently allows anonymous API routes; implement R1 tasks against `metagmo_spec.md`; preserve the 3-view filter model (recent week, consensus, controversy); keep workspace boundaries between `apps/*` and `packages/*`.
- Known risks: README mentions Yarn 1.x but `package.json` declares `npm@10.8.2`; resolve package-manager ambiguity before dependency work. Current active work is API routes and word-cloud UI.
