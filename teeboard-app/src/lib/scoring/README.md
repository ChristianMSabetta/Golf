# @teeboard/scoring

The single home of every WHS/USGA scoring computation in TeeBoard. **Pure TypeScript**: no I/O, no environment reads, no framework, database, or browser APIs — every course datum, handicap index, allowance, and Committee override is an explicit function parameter. All scoring math lives inside this package boundary (architectural rule C13); pages and components consume it, they never reimplement it.

## Contents (Phase 2, M3-T001 — handicap layer)

- **Course Handicap** — Rules of Handicapping 5.1 (18 holes) and 5.2 (9 holes), including plus (better-than-scratch) players and Committee overrides (5.6).
- **Playing Handicap** — Rule 5.5: Course Handicap × allowance, rounded to a whole number, with per-competition allowance presets (`NET_COMPETITION_DEFAULT_ALLOWANCE` 95%, `FOUR_BALL_DEFAULT_ALLOWANCE` 85%).
- **Handicap Index conversions** — Rule 5.2: HI18 → HI9 (÷ 2) and HI9 → HI18 (× 2 + 0.4).
- **Per-hole stroke allocation** — from Playing Handicap and stroke index, handling 18-hole rounds, 9-hole rounds (dedicated 9-hole stroke indices, or the front/back nine of the 18-hole scale), plus handicaps, and players receiving strokes on every hole.

Competition formats, maximum scores, tiebreaks, flights, payouts, and side games arrive with the later tasks of this milestone (M3-T002). Calcutta and parimutuel side games are excluded on legal-risk grounds and must never appear in this package's API.

## Usage

```ts
import {
  allocateStrokes,
  computeHandicap,
  NET_COMPETITION_DEFAULT_ALLOWANCE,
} from "@/lib/scoring/src";

const result = computeHandicap({
  handicapIndex: 12.4,
  course,
  tee: course.tees["white"], // { courseRating: 71.2, slopeRating: 128 }
  allowance: { fraction: NET_COMPETITION_DEFAULT_ALLOWANCE }, // 0.95
});
// result.courseHandicap → 13, result.playingHandicap → 12

const allocation = allocateStrokes(result.playingHandicap, course);
// allocation.strokes[holeNumber] → strokes received (negative = strokes given back)
```

Inputs are plain values (`Course`, `TeeRating`, `Allowance`, overrides — see `src/types.ts`); there is no hidden configuration and nothing is read from the environment.

## WHS verification policy

The World Handicap System formulas this package implements are reputation-critical: an implementation that diverges from the rulebook is worse than none. Every formula constant is therefore **named** in `src/constants.ts` and every arithmetic expression in `src/handicap.ts` / `src/strokes.ts` is a **literal transcription** of the cited clause, with the Rules of Handicapping rule number recorded in the source.

Derived expectations in tests must come from the published rules — never from this implementation. Authoritative sources:

- *Rules of Handicapping* (USGA/CONGU/EGA editions agree on the formula clauses below), in particular:
  - **Rule 5.1** — Course Handicap formula (18 holes) and the .5-rounds-up note
  - **Rule 5.2** — 9-hole Course Handicap, the −0.5 bonus adjustment, and HI9 ↔ HI18 conversions
  - **Rule 5.3** — the HI9 → HI18 × 2 + 0.4 dashed-line conversion (recorded in `constants.ts` as the smoothing term)
  - **Rule 5.5** — Playing Handicap and the 95% / 85% allowance defaults
  - **Rule 5.6** — Committee authority to set Course/Playing Handicaps for a competition (the override hooks)
  - **Appendix E** — 9-hole competition guidance (stroke allocation and Playing Handicap on a 9-hole course)
- USGA Course Rating & Slope Rating primers (the meaning of SR 113 and CR − par).

Change procedure: if a formula needs to change, update `src/constants.ts` (and its clause citation) together with the code, and update the verification suite (M3-T003) expectations from the published rules — never adjust an expected value to match an implementation's output.

## Development

```bash
npm run test:scoring        # run the verification suite (Vitest)
npm run test:scoring:watch  # watch mode
```

The dedicated verification suite (spec cases + 40+ edge cases, ≥95% coverage) is built in M3-T003; the package ships with a minimal smoke test so the Vitest wiring is proven from day one. `src/` has its own strict `tsconfig.json` (`extends` the app config) so the package type-checks standalone.
