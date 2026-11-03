-- NFL Research Dashboard — Supabase schema
-- Lives in the `nfl` schema of a Supabase project shared with the other sport
-- dashboards (MLB uses public, WNBA uses a wnba schema). Applied as
-- the `nfl_schema_init` migration. Idempotent: safe to re-run in the SQL editor.
--
-- After changing exposed schemas, PostgREST must serve `nfl`:
--   alter role authenticator set pgrst.db_schemas = 'public, graphql_public, nfl';
--   notify pgrst, 'reload config';
-- (also add `nfl` under Dashboard → Settings → API → Exposed schemas so it
--  survives a managed config reload.)

create schema if not exists nfl;

create table if not exists nfl.teams (
  team_abbr text primary key,
  full_name text, color text, color2 text, logo text
);

create table if not exists nfl.games (
  game_id text primary key,
  season integer, week integer, game_type text, gameday date, gametime text,
  home_team text, away_team text, home_qb text, away_qb text,
  spread_line numeric, total_line numeric,
  home_moneyline integer, away_moneyline integer,
  home_implied numeric, away_implied numeric,
  roof text, surface text, temp numeric, wind numeric,
  home_rest integer, away_rest integer, div_game boolean, stadium text
);

create table if not exists nfl.players (
  player_id text primary key,
  full_name text, position text, team_abbr text, headshot_url text, status text
);

create table if not exists nfl.team_offense_profile (
  team_abbr text, season integer, through_week integer,
  plays_per_game numeric, pass_rate numeric, proe numeric,
  pass_att_pg numeric, rush_att_pg numeric,
  off_pass_epa numeric, off_rush_epa numeric, off_success_rate numeric,
  primary key (team_abbr, season)
);

create table if not exists nfl.team_defense_scheme (
  team_abbr text, season integer, through_week integer,
  pass_plays integer, rush_plays integer,
  man_rate numeric, zone_rate numeric,
  cover0_rate numeric, cover1_rate numeric, cover2_rate numeric, cover3_rate numeric,
  cover4_rate numeric, cover6_rate numeric, cover2man_rate numeric,
  blitz_rate numeric, avg_pass_rushers numeric,
  light_box_rate numeric, heavy_box_rate numeric, avg_box numeric,
  pressure_rate numeric,
  def_pass_epa numeric, def_rush_epa numeric, def_success_rate numeric,
  explosive_pass_rate numeric, explosive_rush_rate numeric,
  epa_vs_wr numeric, ypt_vs_wr numeric, tgt_vs_wr integer,
  epa_vs_te numeric, ypt_vs_te numeric, tgt_vs_te integer,
  epa_vs_rb numeric, ypt_vs_rb numeric, tgt_vs_rb integer,
  primary key (team_abbr, season)
);

create table if not exists nfl.player_scheme_splits (
  player_id text, season integer,
  man_targets integer, man_rec integer, man_yards numeric, man_ypt numeric, man_success numeric,
  zone_targets integer, zone_rec integer, zone_yards numeric, zone_ypt numeric, zone_success numeric,
  light_box_att integer, heavy_box_att integer, light_box_ypc numeric, heavy_box_ypc numeric,
  primary key (player_id, season)
);

create table if not exists nfl.player_week_stats (
  player_id text, season integer, week integer,
  team_abbr text, opponent text, position text,
  targets integer, receptions integer, rec_yards numeric, rec_tds integer,
  air_yards numeric, target_share numeric,
  carries integer, rush_yards numeric, rush_tds integer,
  pass_att integer, completions integer, pass_yards numeric, pass_tds integer,
  ints integer, sacks numeric, epa numeric,
  primary key (player_id, season, week)
);

create table if not exists nfl.player_season_agg (
  player_id text, season integer, through_week integer,
  position text, team_abbr text, games integer,
  target_share numeric, targets_pg numeric, rec_pg numeric, rec_yards_pg numeric,
  ypt numeric, adot numeric, catch_rate numeric, rec_td_pg numeric,
  carries_pg numeric, rush_yards_pg numeric, ypc numeric, rush_td_pg numeric,
  pass_att_pg numeric, comp_pct numeric, cpoe numeric, ypa numeric,
  pass_yards_pg numeric, pass_td_pg numeric, int_rate numeric,
  separation numeric, cushion numeric, yac_oe numeric, ryoe_pg numeric,
  time_to_throw numeric, aggressiveness numeric,
  rz_carries_pg numeric, rz_targets_pg numeric, gl_carries_pg numeric, gl_targets_pg numeric,
  total_td_pg numeric,
  primary key (player_id, season)
);

-- Results tracking — saved model picks, graded against game outcomes.
-- Writes go through /api/picks.js (service-role, bypasses RLS); the client only
-- reads via the anon key. Mirrors the MLB lab's mlb_picks.
-- Per-player research profile: routes/TPRR/YPRR, snap share, red-zone role and
-- FTN target quality, collapsed to one row per (player, season) with
-- POSITION-RELATIVE percentiles precomputed (scripts/build_player_profiles.py).
--
-- `data` and `pct` are jsonb rather than columns on purpose. The metric set is
-- research output that keeps growing, explicit columns would mean a migration
-- per new measurement, and the app reads a whole profile for one player at a
-- time rather than filtering on individual metrics.
create table if not exists nfl.player_profiles (
  player_id text not null,
  season integer not null,
  position text,
  team_abbr text,
  games integer,
  qualified boolean default false,
  data jsonb not null default '{}'::jsonb,
  pct jsonb not null default '{}'::jsonb,
  primary key (player_id, season)
);
create index if not exists player_profiles_season_pos on nfl.player_profiles (season, position);

create table if not exists nfl.nfl_picks (
  id            bigint generated always as identity primary key,
  pick_date     date not null default current_date,
  season        integer,
  week          integer,
  game_id       text,
  player_id     text,
  player_name   text,
  team          text,
  opp           text,
  position      text,
  prop_type     text not null,         -- rec_yards | rush_yards | pass_yards | receptions | rush_att | completions | pass_tds | anytime_td
  line          numeric,
  direction     text not null default 'over',  -- the model's SIDE: over | under
  proj_mean     numeric,
  prob_over     numeric,
  fair_line     integer,
  matchup_tilt  numeric,               -- scheme multiplier at pick time (score-space gate signal)
  model_version text,                  -- '<market>@<date>' from src/modelVersions.js
  book          text,                  -- best price for the SIDE on the row's line
  book_odds     integer,
  outcome       text not null default 'pending',  -- pending | win | loss | push | void
  actual        numeric,
  signals       jsonb,                 -- factors, depth, carryover, every book's two-sided price
  created_at    timestamptz not null default now()
);
-- The automatic ledger (2026-09-13): scripts/snapshot_picks.mjs freezes every
-- priced board row before kickoff, scripts/grade_picks.mjs scores it. See
-- src/lib/pickLedger.js. `source` separates the live record ('auto') from games
-- priced after the fact ('backfill') and hand-tracked rows ('manual').
alter table nfl.nfl_picks
  add column if not exists pick_key      text,          -- season|game_id|player_id|prop_type; upsert target
  add column if not exists source        text not null default 'manual',
  add column if not exists kickoff_at    timestamptz,   -- the freeze: no snapshot touches a game after this
  add column if not exists captured_at   timestamptz,   -- last pre-kickoff snapshot that wrote the row
  add column if not exists odds_at       timestamptz,   -- when the lines it was priced at were pulled
  add column if not exists sigma         numeric,
  add column if not exists side_prob     numeric,       -- model P(the side), at the book's line
  add column if not exists mkt_prob      numeric,       -- book's P(the side), de-vigged when two-sided
  add column if not exists devigged      boolean,
  add column if not exists edge          numeric,       -- side_prob - mkt_prob, probability points
  add column if not exists ev            numeric,       -- per unit staked at book_odds
  add column if not exists conf_tier     text,
  add column if not exists conf_score    numeric,
  add column if not exists avail         text,          -- injury designation at capture
  add column if not exists close_line    numeric,
  add column if not exists close_odds    integer,
  add column if not exists close_prob    numeric,
  add column if not exists clv_prob      numeric,       -- close_prob - mkt_prob, same line only
  add column if not exists clv_line      numeric,       -- line move in the pick's favour
  add column if not exists profit        numeric,       -- units on a 1u stake; 0 on push/void
  add column if not exists graded_at     timestamptz;
-- Official picks (2026-09-16): the subset the engine stands behind, decided by
-- src/lib/officialPicks.js and frozen onto the pick with everything else before
-- kickoff. Every pick is still graded; official only marks which ones count on
-- the official record. basis: 'pre-kickoff' (stamped by the snapshot) | 'retro'
-- (the rule applied afterwards to an already-frozen week, kept apart).
alter table nfl.nfl_picks
  add column if not exists official       boolean,
  add column if not exists official_score numeric,       -- |proj − line| in spread units (score space)
  add column if not exists official_note  text,          -- why not, when not
  add column if not exists official_rule  text,          -- OFFICIAL_RULE version
  add column if not exists official_basis text;
-- When the closing price was pulled (2026-10-07). A close is only a close if it
-- postdates odds_at: until then the last pre-kickoff pull both priced the pick
-- and served as its close, and every CLV was 0. See pickLedger.js closeIsCapture.
alter table nfl.nfl_picks
  add column if not exists close_at       timestamptz;
create index if not exists nfl_picks_official_idx on nfl.nfl_picks (season, week) where official;
create unique index if not exists nfl_picks_pick_key_uidx on nfl.nfl_picks (pick_key);
create index if not exists nfl_picks_game_idx on nfl.nfl_picks (game_id);
create index if not exists nfl_picks_season_week_idx on nfl.nfl_picks (season, week);
-- Every reader walks a season in id order (api/picks.js, src/lib/picks.js
-- walkPicks, scripts' selectAll). Without this, `season = $1 order by id` was a
-- seq scan plus a sort of every row in the season — and because the snapshot
-- rewrites each row every run, id has no physical order left (correlation −0.07)
-- for the pkey to exploit. Under OFFSET paging that sort held offset+1000 rows
-- of ~1.2 KB, outgrew work_mem from the third page and spilled ~5 MB to temp per
-- request: 1.4 s a page, 5.7 s under load, the anon role's 3 s timeout
-- (measured 2026-10-12). The index alone does NOT fix OFFSET — the planner still
-- flips some offset pages back to the spilling sort — so those walks page by
-- `id > last`, which bounds every sort to 1000 rows. Never rewrite them as OFFSET.
create index if not exists nfl_picks_season_id_idx on nfl.nfl_picks (season, id);
create index if not exists nfl_picks_date_idx on nfl.nfl_picks (pick_date);
create index if not exists nfl_picks_outcome_idx on nfl.nfl_picks (outcome);

-- ── Live odds ────────────────────────────────────────────────────────────────
-- The Odds API's own event ids, mapped to our game_id. The /events endpoint is
-- FREE (measured 2026-09-08: x-requests-last = 0 for all 272 events), so this
-- map is refreshed on every pull and never costs a credit. Keeping it in a table
-- rather than re-deriving it means a pull that only needs odds for three games
-- doesn't have to reason about the other 269.
create table if not exists nfl.odds_events (
  event_id      text primary key,
  game_id       text,                  -- null = an event we could not match to nfl.games
  season        smallint,
  week          smallint,
  commence_time timestamptz,
  home_team     text,                  -- our abbreviation, not the API's full name
  away_team     text,
  refreshed_at  timestamptz not null default now(),
  -- When this event was last actually PRICED, per snapshot kind. The re-run
  -- guard in pull_live_odds.mjs reads these so a workflow that died halfway pays
  -- only for what it did not already get. They live here, one row per event,
  -- rather than being derived from live_odds — asking a ~10k-row outcome table
  -- "which of these 16 games did we price" runs into PostgREST's 1000-row cap
  -- and silently answers for whichever games those first 1000 rows covered.
  last_live_at  timestamptz,
  last_close_at timestamptz
);
create index if not exists odds_events_game_idx on nfl.odds_events (game_id);
create index if not exists odds_events_commence_idx on nfl.odds_events (commence_time);

-- One row per (game, book, market, player, side, line, snapshot kind).
--
-- 'close' rows accumulate by design, at ~1 per game per book per prop. Measured
-- cost of a full 16-game slate across both US regions is ~11.8k rows ≈ 3.5 MB,
-- so a full season of closing lines is ~63 MB — affordable against the free
-- plan's 500 MB, which the MLB side leaves ~255 MB of.
--
-- 'live' ROWS ACCUMULATE TOO, and this comment used to say they did not: "the
-- live surface stays the size of one slate however often we refresh it". That
-- is true WITHIN a slate and false ACROSS them, and the difference stayed
-- invisible for exactly as long as nobody counted. row_key carries the LINE, so
-- a line move does not update a row, it writes a new one — and a played week is
-- never cleaned up, so the live surface is every week of the season at once.
-- Measured 2026-09-22, two weeks in: 48,379 live rows, 11,656 of them in the
-- three books the board reads, every one for a game that had already finished,
-- all of it paged by the browser on every board load.
--
-- scripts/prune_live_odds.mjs is what bounds it now, on the schedule in
-- .github/workflows/prune-live-odds.yml: it drops the live rows for games that
-- are over, but ONLY where a 'close' row already covers the same (game_id,
-- book, prop_type, player_name, name). 777 outcomes on that date existed only
-- in live because a close pull never reached them — those are the only record
-- of a market bought with Odds API credits, and they stay — until every pick on
-- the game is graded, when the same job moves ALL of its rows
-- (close and live) to Drive. Kept close rows grew ~20k a week and would have
-- carried this shared free-plan database past its 500 MB cap by the Super Bowl.
--
-- row_key is computed by the writer rather than being a generated column so that
-- PostgREST can upsert with on_conflict=row_key. `line` is null for anytime-TD
-- (a yes/no market with no point), which is why it cannot be part of a plain PK.
create table if not exists nfl.live_odds (
  row_key       text primary key,
  game_id       text not null,
  season        smallint,
  week          smallint,
  book          text not null,         -- fanduel | hardrockbet | draftkings | …
  prop_type     text not null,         -- the Odds API market key
  player_name   text not null,
  name          text not null,         -- Over | Under | Yes | No
  line          numeric,               -- outcome point; null for anytime_td
  odds          integer not null,      -- American
  -- Deep link to the book's bet slip with this outcome already on it, and the
  -- book's own id for the outcome. Both come free with the odds call
  -- (includeLinks/includeSids are query flags, not billed markets), and roughly
  -- 85% of rows carry them. FanDuel's and DraftKings' links are used as given;
  -- Hard Rock's points at its app host and does not open the slip from a
  -- browser, so the app rebuilds it from `sid`. See src/lib/betslip.js.
  link          text,
  sid           text,
  snapshot_kind text not null,         -- 'live' (upserted in place) | 'close' (kept until archived)
  commence_time timestamptz,
  captured_at   timestamptz not null default now()
);
create index if not exists live_odds_game_idx on nfl.live_odds (game_id, snapshot_kind);
create index if not exists live_odds_lookup_idx on nfl.live_odds (season, week, book, prop_type);
create index if not exists live_odds_player_idx on nfl.live_odds (player_name);
-- The board's own read: (season, snapshot_kind) filtered, ordered by row_key.
-- It existed in the live database but not in this file, which is how a rebuild
-- from schema.sql would have quietly reintroduced the seq scan.
--
-- IT ONLY WORKS IF THE READER PAGES BY KEY. `order by row_key offset N` cannot
-- use it — the planner costs a Seq Scan plus a top-N sort of all 11.6k matching
-- rows cheaper than skipping N index entries, and takes it: measured
-- 2026-09-22, offset paging ran 419 ms mean / 1,532 ms worst per page and
-- answered `57014 canceling statement due to statement timeout` on the live
-- board. The same page written as `row_key > $last` is an Index Scan with no
-- sort at all: 26 ms mean / 93 ms worst, alternating runs so neither form kept
-- the warmer cache. src/lib/loadLiveOdds keys off the last row_key for exactly
-- this reason — an OFFSET rewrite would silently put the seq scan back.
create index if not exists live_odds_season_kind_rowkey_idx
  on nfl.live_odds (season, snapshot_kind, row_key);

-- Game lines: spreads and totals, one row per (game, book, market, side, line).
--
-- These come from the SPORT-level odds endpoint, which is billed PER REQUEST
-- rather than per event — spreads AND totals for a whole 16-game slate cost
-- markets × regions, i.e. 2 credits at one region. That makes this the cheapest
-- table in the schema to keep current, and the most load-bearing: the totals /
-- spread model in src/lib/gameLines.js and every implied-team-points input the
-- touchdown props hang off are computed from it.
--
-- `outcome` holds OUR team abbreviation for spreads (the API names the side with
-- the book's full team name, e.g. "Seattle Seahawks", which joins to nothing) and
-- Over/Under for totals. Same snapshot_kind discipline as live_odds: 'live'
-- upserts in place and stays the size of one slate, 'close' accumulates.
create table if not exists nfl.game_lines (
  row_key       text primary key,
  game_id       text not null,
  season        smallint,
  week          smallint,
  book          text not null,
  market        text not null,          -- spreads | totals | h2h | team_totals
  outcome       text not null,          -- team abbr for spreads/h2h; Over/Under for totals/team_totals
  line          numeric,
  odds          integer,
  snapshot_kind text not null,          -- 'live' (upserted in place) | 'close' (kept)
  commence_time timestamptz,
  captured_at   timestamptz not null default now()
);
-- Moneylines (h2h) and team totals joined spreads and totals on 2026-10-14, when
-- the game engine started pricing them (src/lib/gameMarkets.js). A moneyline's
-- outcome is our team abbreviation like a spread's; a team total is Over/Under
-- with the TEAM in its own column, which is why `team` exists. link/sid are the
-- bet-slip deep links, free in the same response exactly as on live_odds.
alter table nfl.game_lines
  add column if not exists team text,
  add column if not exists link text,
  add column if not exists sid  text;
create index if not exists game_lines_game_idx on nfl.game_lines (game_id, snapshot_kind);
-- The board's read: this season's live rows for games kicking off from a few
-- days ago on (src/lib/loadData.js loadGameLines).
create index if not exists game_lines_season_kind_commence_idx on nfl.game_lines (season, snapshot_kind, commence_time);
create index if not exists game_lines_lookup_idx on nfl.game_lines (season, week, market);

-- Weekly injury report — the club's filed practice participation and game-status
-- designation, mirrored from nflverse by scripts/pull_injuries.mjs.
--
-- WHY IT IS ITS OWN TABLE rather than a column on player_season_agg: the report
-- is a fact about ONE WEEK and it changes three times inside that week, while an
-- aggregate is a fact about a season. Folding a Friday designation into a season
-- row would either overwrite history or need a second timestamp column doing the
-- job a week key already does.
--
-- `report_status` is null for most rows and that null is MEANINGFUL: a player can
-- appear on the report as a limited practice participant and carry no game-status
-- designation at all, which is the league's way of saying he is expected to play.
-- Treat null as "no designation", never as "no data".
create table if not exists nfl.player_injuries (
  player_id       text not null,
  season          smallint not null,
  week            smallint not null,
  team_abbr       text,
  position        text,
  full_name       text,
  report_status   text,                 -- Out | Doubtful | Questionable | null
  practice_status text,                 -- Did Not Participate / Limited / Full
  injury          text,                 -- body part, as filed
  updated_at      timestamptz not null default now(),
  primary key (player_id, season, week)
);
create index if not exists player_injuries_week_idx on nfl.player_injuries (season, week);

-- Grants: anon/authenticated read-only (RLS-gated), service_role full (bypasses RLS).
grant usage on schema nfl to anon, authenticated, service_role;
grant select on all tables in schema nfl to anon, authenticated;
grant all on all tables in schema nfl to service_role;
alter default privileges in schema nfl grant select on tables to anon, authenticated;
alter default privileges in schema nfl grant all on tables to service_role;

-- Row-level security: anon SELECT allowed on every table; writes only via service role.
do $$
declare t text;
begin
  foreach t in array array[
    'teams','games','players','team_offense_profile','team_defense_scheme',
    'player_scheme_splits','player_week_stats','player_season_agg','nfl_picks',
    'odds_events','live_odds','game_lines','player_injuries'
  ]
  loop
    execute format('alter table nfl.%I enable row level security;', t);
    execute format('drop policy if exists %I on nfl.%I;', t||'_anon_read', t);
    execute format('create policy %I on nfl.%I for select to anon using (true);', t||'_anon_read', t);
  end loop;
end $$;
