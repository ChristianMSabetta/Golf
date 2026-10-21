/**
 * @teeboard/scoring — the single home of every WHS/USGA scoring computation
 * in TeeBoard. Pure TypeScript: no I/O, no environment reads, no framework,
 * database, or browser APIs.
 *
 * - Handicap layer (M3-T001): Course/Playing Handicap computation and
 *   per-hole stroke allocation.
 * - Competition layer (M3-T002): scorecards under maximum-score rules,
 *   the five formats (stroke play, scramble, best ball, stableford,
 *   shamble), USGA card-off tiebreaks, flights, payouts with tie
 *   splitting, and side games (skins, closest-to-pin, long drive,
 *   longest putt).
 */
export {
  CARD_OFF_LAST_HOLES_STAGES,
  COURSE_HANDICAP_FORMULA_18,
  COURSE_HANDICAP_FORMULA_9,
  DEFAULT_MAX_TEAM_SIZE,
  DEFAULT_MIN_TEAM_SIZE,
  FOUR_BALL_DEFAULT_ALLOWANCE,
  HALF_ROUNDS_UP,
  HI_9_TO_18_MULTIPLIER,
  HI_9_TO_18_SMOOTHING,
  NET_COMPETITION_DEFAULT_ALLOWANCE,
  NET_DOUBLE_BOGEY_STROKES_OVER_PAR,
  NINE_HOLE_CR_PAR_BONUS_ADJUSTMENT,
  NINE_HOLE_HI_CONVERSION_DIVISOR,
  NINE_HOLE_PLAYING_HANDICAP_RULE,
  PAYOUT_PRESET_50_30_20,
  SLOPE_RATING_NEUTRAL,
} from "./constants";
export { roundHalfUpAwayFromZero } from "./rounding";
export {
  computeHandicap,
  courseHandicap,
  courseHandicapExact,
  fullAllowance,
  handicapIndex18To9,
  handicapIndex9To18,
} from "./handicap";
export { allocateStrokes } from "./strokes";
export {
  capStrokes,
  computeScorecard,
  maxScoreCap,
  pickupScore,
  toHoleScores,
  totalGross,
  totalNet,
} from "./scorecard";
export {
  STANDARD_STABLEFORD_SCALE,
  computeStablefordScorecard,
  stablefordPointsForHole,
  totalStablefordPoints,
} from "./stableford";
export {
  breakTiesByCardOff,
  cardOffBreakdown,
  compareCardOff,
  lastNHolesTotal,
} from "./tiebreak";
export { assignFlights } from "./flights";
export {
  computePayouts,
  defaultPayoutConfig,
  splitEvenly,
} from "./payouts";
export {
  computeClosestToPin,
  computeLongDrive,
  computeLongestPutt,
  computeSkins,
  resolveSkinHole,
} from "./sidegames";
export type { SkinsEntry } from "./sidegames";
export {
  computeBestBallStandings,
  computePlayerCard,
  computeScrambleStandings,
  computeShambleStandings,
  computeStablefordStandings,
  computeStrokePlayStandings,
  validateTeamSize,
} from "./formats";
export type {
  Allowance,
  BestBallStanding,
  CardOffBreakdown,
  Course,
  CourseHandicapOverride,
  Flight,
  FlightAssignment,
  FlightPlayer,
  HandicapResult,
  Hole,
  HoleCount,
  HoleScores,
  HoleStrokes,
  MaxScoreRule,
  MeasuredSideGameEntry,
  MeasuredSideGameResult,
  PayoutConfig,
  PayoutEntry,
  PayoutPosition,
  PayoutSlot,
  PayoutSummary,
  PlayingHandicapOverride,
  ScorecardHole,
  ScorecardHoleResult,
  ScoringBasis,
  ScrambleMemberHandicap,
  ScrambleStanding,
  ShambleStanding,
  SideGameValue,
  SkinsConfig,
  SkinsHoleResult,
  SkinsResult,
  SkinsVariant,
  StablefordHoleResult,
  StablefordPointScale,
  StablefordScaleEntry,
  StablefordStanding,
  StrokePlayStanding,
  StrokesByHole,
  StrokeAllocationResult,
  StrokeIndexSelectionMode,
  TeamMemberStanding,
  TeeRating,
} from "./types";
export type {
  FormatPlayer,
  FormatTeam,
  PlayerCard,
  ScrambleTeam,
  TeamSizeBounds,
} from "./formats";
