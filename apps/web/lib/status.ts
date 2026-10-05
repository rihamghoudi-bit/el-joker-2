const MISSION_CHIP: Record<string, string> = {
  NEEDS_INFORMATION: "NEEDS INFORMATION",
  CREATED: "CREATED",
  RESEARCHING: "AI ANALYZING",
  VERIFYING: "VERIFYING",
  EVALUATING: "EVALUATING",
  HUMAN_REVIEW: "HUMAN REVIEW",
  APPROVED: "APPROVED",
  PAYING: "PAYING",
  PAID: "PAID",
  BLOCKED: "BLOCKED",
  REJECTED: "REJECTED",
  PAYMENT_FAILED: "PAYMENT FAILED",
  FAILED: "ERROR",
};

/** Human label for a mission status (used by every status chip). */
export const missionChip = (status: string) => MISSION_CHIP[status] ?? status;

export const ACTIVE_STATUSES = ["CREATED", "RESEARCHING", "VERIFYING", "EVALUATING", "APPROVED", "PAYING"];
