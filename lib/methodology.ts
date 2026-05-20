/**
 * The Michelin Method — single source of truth for stages, checkpoints,
 * and FEEDBACK lenses. Used by both the UI and the cron jobs.
 */

export type StageId =
  | "on_order" | "prep_table" | "front_burner"
  | "back_burner" | "pass_qa" | "served";

export const STAGE_PROGRESS: Record<StageId, number> = {
  on_order:     0,
  prep_table:   20,
  front_burner: 40,
  back_burner:  60,
  pass_qa:      80,
  served:       100,
};

export const STAGES: {
  id: StageId; name: string; color: string; bg: string; desc: string; range: [number, number]; progress: number;
}[] = [
  { id: "on_order",     name: "On Order",     color: "#0EA5E9", bg: "#E0F2FE", desc: "Captured. Sanity-check scope.",       range: [0, 10],   progress: 0   },
  { id: "prep_table",   name: "Prep Table",   color: "#06B6D4", bg: "#CFFAFE", desc: "Scope drafted. Gaps identified.",     range: [10, 40],  progress: 20  },
  { id: "front_burner", name: "Front Burner", color: "#F97316", bg: "#FFEDD5", desc: "Active build. Draft. Team review.",   range: [40, 80],  progress: 40  },
  { id: "back_burner",  name: "Back Burner",  color: "#64748B", bg: "#F1F5F9", desc: "About 60% done. Parked for later work.", range: [50, 70],  progress: 60  },
  { id: "pass_qa",      name: "Pass — QA",    color: "#A855F7", bg: "#F3E8FF", desc: "Soft-launch. Polish. Final check.",   range: [80, 95],  progress: 80  },
  { id: "served",       name: "Completed",    color: "#22C55E", bg: "#DCFCE7", desc: "Done and retained for reference.",      range: [95, 100], progress: 100 },
];

export const stageById = (id: StageId) => STAGES.find(s => s.id === id)!;

export const CHECKPOINTS = [
  { pct: 10, label: "Concept", focus: "Big-picture validation" },
  { pct: 30, label: "Outline", focus: "Structure critique" },
  { pct: 50, label: "Draft",   focus: "Clarity & completeness" },
  { pct: 70, label: "Refined", focus: "Style, tone, polish" },
  { pct: 90, label: "Final",   focus: "Typos, consistency" },
] as const;

export const LENSES = [
  { letter: "F", word: "Feasible" },     { letter: "E", word: "Execution" },
  { letter: "E", word: "Enhancement" },  { letter: "D", word: "Deliverables" },
  { letter: "B", word: "Behaviors" },    { letter: "A", word: "Assumptions" },
  { letter: "C", word: "Clarity" },      { letter: "K", word: "Key Next Step" },
] as const;

export const PRIORITIES = {
  high:   { label: "High",   color: "#DC2626", bg: "#FEE2E2" },
  medium: { label: "Medium", color: "#D97706", bg: "#FEF3C7" },
  low:    { label: "Low",    color: "#0891B2", bg: "#CFFAFE" },
} as const;

/** Returns the next checkpoint a card needs feedback for, or null if all clear. */
export function nextCheckpoint(progress: number, lastFeedback: number | null) {
  return CHECKPOINTS.find(
    c => c.pct > (lastFeedback ?? -1) && c.pct >= progress - 10
  ) || CHECKPOINTS.find(c => c.pct > (lastFeedback ?? -1));
}

/** Should we send a checkpoint nudge? True if a checkpoint has been crossed but no feedback logged. */
export function needsFeedback(card: { progress: number; last_feedback: number | null; stage: StageId }) {
  if (card.stage === "served") return false;
  const next = nextCheckpoint(card.progress, card.last_feedback);
  if (!next) return false;
  return card.progress >= next.pct;
}
