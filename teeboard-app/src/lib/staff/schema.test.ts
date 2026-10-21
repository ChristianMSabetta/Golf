import { describe, expect, it } from "vitest";
import {
  CLUB_PLAN_STAFF_LIMIT,
  INVITABLE_ROLES,
  INVITATION_EXPIRY_DAYS,
  checkSeatAvailability,
  fieldErrors,
  invitationAcceptPath,
  invitationExpiry,
  invitationUsable,
  inviteStaffSchema,
} from "./schema";

/**
 * Staff seat + invitation tests (M4-T010). The plan limit and the 7-day
 * expiry are the acceptance criteria: both are pure functions here so the
 * server actions only ever supply counts and a clock.
 */

const NOW = new Date("2026-01-15T12:00:00.000Z");

describe("inviteStaffSchema", () => {
  it("accepts an email plus a role from the enum", () => {
    const parsed = inviteStaffSchema.safeParse({
      email: "pro@club.example",
      role: "head_pro",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.email).toBe("pro@club.example");
      expect(parsed.data.role).toBe("head_pro");
    }
  });

  it("trims and validates the email", () => {
    const bad = inviteStaffSchema.safeParse({ email: "not-an-email", role: "head_pro" });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(fieldErrors(bad.error.issues).email).toContain("valid email");
    }
  });

  it("rejects owner and superadmin as invitable roles", () => {
    for (const role of ["owner", "superadmin"] as const) {
      const parsed = inviteStaffSchema.safeParse({ email: "x@example.com", role });
      expect(parsed.success).toBe(false);
    }
    expect(INVITABLE_ROLES).not.toContain("owner");
    expect(INVITABLE_ROLES).not.toContain("superadmin");
  });
});

describe("checkSeatAvailability", () => {
  it("blocks the seat when linked + pending reach the Club limit", () => {
    const decision = checkSeatAvailability("pilot", { linked: 2, pending: 1 });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.reason).toBe("plan_limit");
      expect(decision.limit).toBe(CLUB_PLAN_STAFF_LIMIT);
      expect(decision.current).toBe(3);
    }
  });

  it("counts pending invitations against the limit at invite time", () => {
    // 1 owner linked + 2 pending = 3 seats claimed: the next invite fails.
    expect(
      checkSeatAvailability("free", { linked: 1, pending: 2 }).ok,
    ).toBe(false);
    // 1 linked + 1 pending leaves room for exactly one more.
    const room = checkSeatAvailability("free", { linked: 1, pending: 1 });
    expect(room.ok).toBe(true);
    if (room.ok) {
      expect(room.remaining).toBe(1);
    }
  });

  it("grants unlimited seats on the Founding plan marker", () => {
    const decision = checkSeatAvailability("pro", { linked: 50, pending: 20 });
    expect(decision.ok).toBe(true);
  });

  it("allows the owner plus two staff on a fresh club", () => {
    const decision = checkSeatAvailability("free", { linked: 1, pending: 0 });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.remaining).toBe(CLUB_PLAN_STAFF_LIMIT - 1);
    }
  });
});

describe("invitationUsable", () => {
  it("accepts a fresh pending invitation inside the window", () => {
    expect(
      invitationUsable(
        { status: "pending", expiresAt: "2026-01-20T00:00:00.000Z" },
        NOW,
      ),
    ).toEqual({ usable: true });
  });

  it("rejects an expired invitation exactly at its expiry", () => {
    const decision = invitationUsable(
      { status: "pending", expiresAt: "2026-01-15T12:00:00.000Z" },
      NOW,
    );
    expect(decision.usable).toBe(false);
    if (!decision.usable) {
      expect(decision.reason).toBe("expired");
    }
  });

  it("rejects revoked and accepted invitations", () => {
    expect(
      invitationUsable({ status: "revoked", expiresAt: "2026-01-20T00:00:00.000Z" }, NOW),
    ).toEqual({ usable: false, reason: "revoked" });
    expect(
      invitationUsable({ status: "accepted", expiresAt: "2026-01-20T00:00:00.000Z" }, NOW),
    ).toEqual({ usable: false, reason: "accepted" });
  });
});

describe("invitationExpiry", () => {
  it("is exactly 7 days after creation", () => {
    const expiry = invitationExpiry(NOW);
    const diffDays =
      (expiry.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(INVITATION_EXPIRY_DAYS);
  });
});

describe("invitationAcceptPath", () => {
  it("embeds the club slug and token", () => {
    expect(invitationAcceptPath("club-a", "abc123")).toBe(
      "/staff/accept?club=club-a&token=abc123",
    );
  });

  it("percent-encodes unsafe slug characters", () => {
    expect(invitationAcceptPath("club a/b", "t")).toBe(
      "/staff/accept?club=club%20a%2Fb&token=t",
    );
  });
});
