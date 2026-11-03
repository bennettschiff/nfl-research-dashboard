# NFL Research Dashboard

A weekly NFL player and game research dashboard: volume and efficiency
projections for every skill player, game-script context from the betting
line, odds across books, and a ledger that grades every projection after the
game.

**Live:** https://nfl.schiffpicks.com · React 19 · Vite · Supabase (Postgres + RLS) · Vercel · GitHub Actions

> **About this repository.** This is a public showcase copy of a private repo.
> It contains the real UI, API routes, schema, scheduled jobs, and tests.
> **The production projection model and its calibration are private.**
> `src/lib/models.js` here is a structural stand-in: same exports and output
> shapes, simple textbook math (opportunity × shrunk efficiency, Normal /
> lognormal / Poisson pricing) and illustrative constants. The data files in
> `scripts/out/` keep their real shape, but every fitted value in them is
> randomized. Research, calibration scripts and git history are not included.

<!-- Screenshot: add docs/screenshot.png and uncomment
![NFL Research Dashboard](docs/screenshot.png)
-->

## What it does

- **Week slate.** Every game with spread, total and implied team totals, and a
  board of player projections: receiving, rushing and passing yards,
  receptions, attempts, completions, passing and anytime TDs.
- **Player panel.** Season and recent form, snap counts, role on the depth
  chart, matchup context, and a step-by-step breakdown of how the projection
  was built.
- **Team opportunity budgets.** Individual per-game rates are capped so a
  roster's projected targets and carries can't exceed what the team will
  actually run. When the injury report rules a starter out, the backup is
  promoted onto the board with a starter's workload.
- **Defense and pass-rush views,** including a sack projection board.
- **Results ledger.** Projections are snapshotted before kickoff, graded from
  official stats, and summarized by market and by week.

## Architecture

```
 GitHub Actions ──► scripts/  pull odds · injuries · rosters · snapshot · grade
       │                             │
       │ workflow_dispatch           ▼ service role
 pg_cron (Postgres) ─────────► Supabase Postgres (nfl schema, RLS on)
                                     ▲ publishable key (read-only)
 Browser (React SPA) ── Vercel ──────┘   + /api/picks · /api/season · /api/lab
```

Jobs are dispatched from Postgres (`pg_cron` → GitHub `workflow_dispatch`)
rather than GitHub's own scheduler, which can start runs late. That keeps odds
pulls aligned to kickoff windows and lets all five sport dashboards share one
odds-API credit budget. (The dispatch SQL is not included in this copy.)

## Where to look

| Area | Files |
|---|---|
| Projection pipeline and its breakdown UI | `src/lib/models.js` (stand-in), `src/lib/breakdown.js`, `src/components/ModelBreakdown.jsx` |
| Team volume caps and depth-chart promotion | `src/lib/models.js` `teamOpportunityBudget`, `src/lib/depthPromotion.js` |
| Odds ingestion, de-vigging and best-price selection | `scripts/pull_live_odds.mjs`, `src/lib/odds.js` |
| Snapshot and grading | `scripts/snapshot_picks.mjs`, `scripts/grade_picks.mjs`, `src/lib/pickLedger.js` |
| Retention: keep the live odds table one slate wide | `scripts/prune_live_odds.mjs`, `.github/workflows/prune-live-odds.yml` |
| Failure alerting | `.github/workflows/ops-alert.yml` |

## Running it

```bash
npm ci
npm test        # 450+ unit tests, no network or keys needed
npm run build
npm run dev     # http://localhost:5173
```

To load live data, copy `.env.example` to `.env.local` and point it at a
Supabase project with `db/schema.sql` applied.

## License

All rights reserved. The code is published for viewing and evaluation; see [LICENSE](LICENSE).
