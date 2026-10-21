/**
 * Prompt construction for the Claude Haiku event-parse (M4-T004). Kept
 * free of I/O and environment reads so the exact strings are unit-testable
 * and shareable between the adapter and its tests.
 */

import type { WizardFormat } from "@/lib/events/schema";

/** Label shown to the model for each wizard format. */
export const FORMAT_LABELS: Record<WizardFormat, string> = {
  stroke_play: "stroke_play (individual stroke play)",
  scramble: "scramble (team scramble — one best ball per hole)",
  best_ball: "best_ball (team best ball / four-ball)",
  stableford: "stableford (individual Stableford points)",
  shamble: "shamble (team shamble — drive plus best ball)",
};

/** One-line description per format for the prompt. */
export const FORMAT_DESCRIPTIONS: Record<WizardFormat, string> = {
  stroke_play: "individual medal play",
  scramble: "all teammates tee off, one ball is played",
  best_ball: "each teammate plays their own ball, best score counts",
  stableford: "points per hole against par",
  shamble: "team drive, then best ball from there",
};

export const SYSTEM_PROMPT = `You parse one-sentence golf event descriptions for a club event wizard.
Extract only what the text states. Output a JSON object with ONLY these optional keys:
name (string), startDate (YYYY-MM-DD), holesCount (9 or 18), nineOption ("front"|"back"), rounds (1 or 2),
startType ("tee_times"|"shotgun"), format ("stroke_play"|"scramble"|"best_ball"|"stableford"|"shamble"),
teamSize (integer 1-4), scoringBasis ("gross"|"net"|"both"), handicapAllowancePct (number 0-100),
maxScoreRule ("none"|"fixed"|"double_par"|"net_double_bogey"), maxScoreFixedCap (integer 2-20),
tiebreakMethod ("card_off"|"none").
Rules:
- Omit any key the description does not state. Never invent values.
- "scramble" implies format "scramble"; "best ball" implies "best_ball"; "shamble" implies "shamble";
  plain stroke/playoff language implies "stroke_play"; points language implies "stableford".
- "net" without gross mention means scoringBasis "net"; "gross" alone means "gross"; both or neither means omit.
- A percentage after "net" (like "net 80%") is handicapAllowancePct.
- Team size phrasing like "4-man" or "two-man" maps to teamSize.
- Resolve relative dates ("next Saturday", "tomorrow") against the provided current date into startDate.
- Nine-hole events state which nine; otherwise omit nineOption.
- Respond with ONLY the JSON object. No prose, no code fences.`;

/**
 * Builds the user message for a parse request. The current date is
 * provided (ISO) so relative wording can be resolved deterministically
 * at temperature 0.
 */
export function buildUserPrompt(
  text: string,
  labels: Record<WizardFormat, string>,
  descriptions: Record<WizardFormat, string>,
  now: Date,
): string {
  const formatLines = (Object.keys(labels) as WizardFormat[])
    .map((key) => `- ${labels[key]}: ${descriptions[key]}`)
    .join("\n");
  return `Formats:\n${formatLines}\n\nCurrent date (ISO): ${now.toISOString()}\n\nEvent description:\n${text}`;
}
