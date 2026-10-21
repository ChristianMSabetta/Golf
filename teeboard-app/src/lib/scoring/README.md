# @teeboard/scoring

The single home of every WHS/USGA scoring computation in TeeBoard. **Pure TypeScript**: no I/O, no environment reads, no framework, database, or browser APIs — every course datum, handicap index, allowance, cap, payout split, and side-game setting is an explicit function parameter. All scoring math lives inside this package boundary (architectural rule C13); pages and components consume it, they never reimplement it.

## Contents

### Handicap layer (M3-T001)

- **Course Handicap** — Rules of Handicapping 5.1 (18 holes) and 5.2 (9 holes), including plus (better-than-scratch) players and Committee overrides (5.6).
- **Playing Handicap** — Rule 5.5: Course Handicap × allowance, rounded to a whole number, with per-competition allowance presets (`NET_COMPETITION_DEFAULT_ALLOWANCE` 95%, `FOUR_BALL_DEFAULT_ALLOWANCE` 85%).
- **Handicap Index conversions** — Rule 5.2: HI18 → HI9 (÷ 2) and HI9 → HI18 (× 2 + 0.4).
- **Per-hole stroke allocation** — from Playing Handicap and stroke index, handling 18-hole rounds, 9-hole rounds (dedicated 9-hole stroke indices, or the front/back nine of the 18-hole scale), plus handicaps, and players receiving strokes on every hole.

### Competition layer (M3-T002)

- **Scorecards** — per-hole gross/net results under a maximum-score rule: none, fixed cap, double par, or the WHS default net double bogey (Rules of Handicapping 3.3b: par + 2 + strokes received, `NET_DOUBLE_BOGEY_STROKES_OVER_PAR`).
- **Formats** — stroke play, scramble, best ball (four-ball), stableford, and shamble standings with gross/net/both bases, WHS allowance defaults (95% individual, 85% four-ball), and configurable team sizes (`DEFAULT_MIN_TEAM_SIZE`/`DEFAULT_MAX_TEAM_SIZE`, overridable per call). Scramble/shamble allowance percentages vary by local custom, so they are required inputs. Team handicap values are always derived through the handicap layer, never reimplemented.
- **Tiebreaks** — USGA card-off (last 9 → 6 → 3 → hole-by-hole backwards, `CARD_OFF_LAST_HOLES_STAGES`) for individuals and teams alike; identical cards tie deterministically, partial cards lose.
- **Flights** — assignment from explicit handicap thresholds with an open-top flight absorbing everyone above.
- **Payouts** — purse splits per position (`PAYOUT_PRESET_50_30_20` preset) with correct tie handling: a tie combines every spanned position's amount and splits it equally (`splitEvenly` largest-remainder redistribution — the combined amount is redistributed, never duplicated).
- **Side games** — skins (gross and net, carryover on tied holes), closest-to-pin, long drive, longest putt. Calcutta and parimutuel are excluded on legal-risk grounds (constraint C24) and must never appear in this package's API.

The dedicated verification suite (spec cases + 40+ edge cases, ≥95% coverage) is **M3-T003, complete** — see "Verification suite" below.

## Verification suite

`test/` holds the full verification suite — the proof of correctness for this package:

- `handicap.test.ts` — Course/Playing Handicap (RoH 5.1/5.2/5.5), rounding (.5 up), 9-hole conversions, plus players, Committee overrides (5.6)
- `strokes.test.ts` — per-hole allocation: scattered stroke indices, 9-hole modes (`full`/`front`/`back`), plus-handicap give-backs, multi-pass handicaps
- `scorecard.test.ts` — maximum-score rules (RoH 3.3b incl. net double bogey), pickups, partial cards, totals
- `stableford.test.ts` — the USGA/EGA point scale, extrapolation beyond the table, custom scales
- `tiebreak.test.ts` — card-off stages (last 9/6/3, hole-by-hole backwards), incomplete cards, teams
- `formats.test.ts` — the five formats: allowances (95%/85%), ranking bases, tiebreak wiring, team sizes
- `flights.test.ts` / `payouts.test.ts` — flight thresholds and tie splitting (combine + redistribute, largest-remainder cents)
- `sidegames.test.ts` — skins carryover chains, measured side games
- `edgecases.test.ts` — boundary inputs: out-of-scale ranks, degenerate standings, empty members, gapped point scales

Every expected value in the suite is derived by hand from the cited rule — the tests never mirror an implementation's output. The suite is fully self-contained: no environment variables, network, or database.

## Usage

```ts
import {
  allocateStrokes,
  computeBestBallStandings,
  computePayouts,
  computeScrambleStandings,
  computeShambleStandings,
  computeSkins,
  computeStablefordStandings,
  computeStrokePlayStandings,
  defaultPayoutConfig,
  NET_COMPETITION_DEFAULT_ALLOWANCE,
} from "@/lib/scoring";

const result = computeHandicap({
  handicapIndex: 12.4,
  course,
  tee: course.tees["white"], // { courseRating: 71.2, slopeRating: 128 }
  allowance: { fraction: NET_COMPETITION_DEFAULT_ALLOWANCE }, // 0.95
});
// result.courseHandicap → 13, result.playingHandicap → 12

const allocation = allocateStrokes(result.playingHandicap, course);
// allocation.strokes[holeNumber] → strokes received (negative = strokes given back)

// Stroke play: gross and net standings with WHS 95% allowance default.
const standings = computeStrokePlayStandings({
  course,
  tee: course.tees["white"],
  players: [{ id, handicapIndex, scores: { 1: 5, 2: 4 } }],
  tiebreak: true, // USGA card-off on total ties
});

// Team formats: scramble takes one team score per hole plus members' indices;
// best ball/shamble score each member's own ball under their own allowance.
const scramble = computeScrambleStandings({
  course,
  tee,
  allowanceFraction: 0.25, // local custom — explicit input, never assumed
  teams: [{ id, scores: { 1: 4 }, members: [{ id, handicapIndex, scores }] }],
});

// Payouts: ties combine the positions they span and split equally.
const payouts = computePayouts({
  config: defaultPayoutConfig(30000), // 50 / 30 / 20 preset
  standings: [{ id: "x", position: 1 }, { id: "y", position: 1 }],
});

// Skins: gross or net, carryover on tied holes.
const skins = computeSkins({
  config: { variant: "net", holeValue: 1000, maxScoreRule: { kind: "net_double_bogey" } },
  holes: course.holeList,
  entries: [{ id, scores: { 1: 5 }, strokesByHole: allocation.strokes }],
});
```

Inputs are plain values (`Course`, `TeeRating`, `Allowance`, overrides, formats/side-game settings — see `src/types.ts` and the `FormatPlayer`/`SkinsConfig`/`PayoutConfig` shapes); there is no hidden configuration and nothing is read from the environment.

## WHS verification policy

The World Handicap System formulas this package implements are reputation-critical: an implementation that diverges from the rulebook is worse than none. Every formula constant is therefore **named** in `src/constants.ts` and every arithmetic expression in the scoring modules is a **literal transcription** of the cited clause, with the Rules of Handicapping rule number recorded in the source.

Derived expectations in tests must come from the published rules — never from this implementation. Authoritative sources:

- *Rules of Handicapping* (USGA/CONGU/EGA editions agree on the formula clauses below), in particular:
  - **Rule 5.1** — Course Handicap formula (18 holes) and the .5-rounds-up note
  - **Rule 5.2** — 9-hole Course Handicap, the −0.5 bonus adjustment, and HI9 ↔ HI18 conversions
  - **Rule 5.3** — the HI9 → HI18 × 2 + 0.4 dashed-line conversion (recorded in `constants.ts` as the smoothing term)
  - **Rule 5.5** — Playing Handicap and the 95% / 85% allowance defaults
  - **Rule 5.6** — Committee authority to set Course/Playing Handicaps for a competition (the override hooks)
  - **Rule 3.3b** — Maximum Score and net double bogey (`par + 2 + strokes received`)
  - **Appendix E** — 9-hole competition guidance (stroke allocation and Playing Handicap on a 9-hole course)
- USGA *Rules of Golf* Appendix I / competition guidance: four-ball (best ball) and team formats, team-size bounds (2–4 per side), Stableford point scales, and the card-off matching of cards (last 9 / last 6 / last 3 / hole-by-hole backwards).
- USGA *Recommendations to Committees* on prize allocation: tied players share the prizes of the positions they collectively occupy (the payout tie-splitting rule `payouts.ts` implements).

Change procedure: if a formula needs to change, update `src/constants.ts` (and its clause citation) together with the code, and update the verification suite (M3-T003) expectations from the published rules — never adjust an expected value to match an implementation's output.

## Development

```bash
npm run test:scoring           # run the verification suite (Vitest)
npm run test:scoring:watch     # watch mode
npm run test:scoring:coverage   # suite + v8 coverage (≥95% lines/branches enforced)
```

The verification suite (spec cases + edge cases) enforces ≥95% line and branch coverage of `src/` via the v8 provider (see `vitest.config.mts` thresholds); `npm run test:scoring:coverage` reproduces the full report from one command. `src/` has its own strict `tsconfig.json` (`extends` the app config) so the package type-checks standalone.
