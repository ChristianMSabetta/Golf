"use client";

import { useActionState } from "react";
import { Clock3, Crown, UserRoundCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  extendTrial,
  grantFoundingPlan,
  impersonateStaffMember,
  type SuperadminActionState,
} from "@/lib/superadmin/actions";

/**
 * Per-club super-admin actions (M4-T010): impersonate a staff member,
 * extend the trial, assign the Founding plan. Every action re-checks the
 * caller's `is_superadmin` flag server-side and writes an audit row — the
 * buttons here are conveniences, never the enforcement.
 */

const EMPTY_STATE = {} satisfies SuperadminActionState;

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  pilot: "Pilot (trial)",
  pro: "Pro / Founding",
};

export type ClubStaffView = {
  readonly clubId: string;
  readonly clubName: string;
  readonly plan: string;
  readonly billingStatus: string;
  readonly staff: readonly {
    readonly id: string;
    readonly fullName: string;
    readonly email: string;
    readonly role: string;
  }[];
};

function PlanBadge({ plan, billingStatus }: { plan: string; billingStatus: string }) {
  const founding = plan === "pro" && billingStatus === "active";
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        founding
          ? "bg-brand-gold/20 text-brand-gold"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {PLAN_LABELS[plan] ?? plan}
    </span>
  );
}

export function ClubActions({ club }: { club: ClubStaffView }) {
  const [trialState, trialAction, trialPending] = useActionState<
    SuperadminActionState,
    FormData
  >(extendTrial, EMPTY_STATE);
  const [foundingState, foundingAction, foundingPending] = useActionState<
    SuperadminActionState,
    FormData
  >(grantFoundingPlan, EMPTY_STATE);
  const [impersonateState, impersonateAction, impersonatePending] =
    useActionState<SuperadminActionState, FormData>(
      impersonateStaffMember,
      EMPTY_STATE,
    );

  const founding =
    club.plan === "pro" && club.billingStatus === "active";

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <PlanBadge plan={club.plan} billingStatus={club.billingStatus} />
        <span className="text-xs text-muted-foreground">
          {club.staff.length} staff member{club.staff.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <form action={trialAction} className="flex items-end gap-2">
          <input type="hidden" name="clubId" value={club.clubId} />
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Trial days
            <Input
              name="days"
              inputMode="numeric"
              defaultValue="30"
              className="w-20 tabular-nums"
              aria-label={`Trial days for ${club.clubName}`}
            />
          </label>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            disabled={trialPending}
          >
            <Clock3 className="size-3.5" aria-hidden />
            {trialPending ? "Extending…" : "Extend trial"}
          </Button>
        </form>

        <form action={foundingAction}>
          <input type="hidden" name="clubId" value={club.clubId} />
          <Button
            type="submit"
            variant={founding ? "outline" : "default"}
            size="sm"
            disabled={foundingPending || founding}
          >
            <Crown className="size-3.5" aria-hidden />
            {founding
              ? "Founding plan active"
              : foundingPending
                ? "Assigning…"
                : "Assign Founding plan"}
          </Button>
        </form>
      </div>

      {trialState.error ? (
        <p className="text-sm text-destructive" role="alert">
          {trialState.error}
        </p>
      ) : null}
      {trialState.saved && trialState.message ? (
        <p className="text-sm text-foreground" role="status">
          {trialState.message}
        </p>
      ) : null}
      {foundingState.error ? (
        <p className="text-sm text-destructive" role="alert">
          {foundingState.error}
        </p>
      ) : null}
      {foundingState.saved && foundingState.message ? (
        <p className="text-sm text-foreground" role="status">
          {foundingState.message}
        </p>
      ) : null}
      {impersonateState.error ? (
        <p className="text-sm text-destructive" role="alert">
          {impersonateState.error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Impersonate staff
        </p>
        {club.staff.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No staff linked to this club.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {club.staff.map((member) => (
              <li
                key={member.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {member.fullName}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email} · {member.role.replace(/_/g, " ")}
                  </p>
                </div>
                <form action={impersonateAction} className="shrink-0">
                  <input
                    type="hidden"
                    name="targetProfileId"
                    value={member.id}
                  />
                  <Button
                    type="submit"
                    variant="ghost"
                    size="sm"
                    disabled={impersonatePending}
                  >
                    <UserRoundCog className="size-3.5" aria-hidden />
                    Impersonate
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
