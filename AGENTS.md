# Project Agent Guide

This project is managed from the portfolio workspace at `C:\dev\portfolio`.
Coding sessions should normally start in this project folder. This file is the
local entrypoint for agents working on this project.

## Shared Portfolio Rules

Use these shared files as the source of truth for cross-project behavior:

- Common guide: `C:\dev\portfolio\AGENTS.md`
- Shared routines: `C:\dev\portfolio\docs\skills\`
- Portfolio playbooks: `C:\dev\portfolio\playbooks\`

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

- `bynote`: `C:\dev\portfolio\docs\skills\bynote.md`
- `bythink`: `C:\dev\portfolio\docs\skills\bythink.md`
- `bycheck`: `C:\dev\portfolio\docs\skills\bycheck.md`
- `bygit`: `C:\dev\portfolio\docs\skills\bygit.md`
- `bystitch`: `C:\dev\portfolio\docs\skills\bystitch.md`
- `bysearch`: `C:\dev\portfolio\docs\skills\bysearch.md`

If the shared file cannot be read, continue with the same intent using local
primary sources and mention the unavailable shared file in the result.

## Project-Specific Notes

- Main stack: npm workspaces monorepo, `apps/web` Next.js App Router + TypeScript, Supabase/PostgreSQL backend, shared packages under `packages/*`.
- Main commands: `npm run dev`, `npm run build`, `npm run lint`; root scripts delegate to `apps/web`.
- Deployment target: Vercel is documented as the current target; confirm before changing deploy configuration.
- Important constraints: MVP currently allows anonymous API routes; implement R1 tasks against `metagmo_spec.md`; preserve the 3-view filter model (recent week, consensus, controversy); keep workspace boundaries between `apps/*` and `packages/*`.
- Known risks: README mentions Yarn 1.x but `package.json` declares `npm@10.8.2`; resolve package-manager ambiguity before dependency work. Current active work is API routes and word-cloud UI.
