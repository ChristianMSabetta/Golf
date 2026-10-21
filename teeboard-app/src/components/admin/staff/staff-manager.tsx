"use client";

import { useActionState } from "react";
import { Mail, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FieldError } from "@/components/admin/event-wizard/field-error";
import {
  inviteStaffMember,
  revokeStaffInvitation,
} from "@/lib/staff/actions";
import {
  INVITABLE_ROLES,
  ROLE_LABELS,
  type InvitableRole,
  type InvitationStatus,
  type StaffActionState,
} from "@/lib/staff/schema";

/**
 * Staff management card (M4-T010): the linked staff list, the invitation
 * form (email + role), and pending invitations with their revoke buttons.
 * Validation mirrors the server contract (inviteStaffSchema) — the server
 * action re-validates and re-checks both the role gate and the Club plan
 * seat limit, so a tampered form can never add a 4th staff member.
 */

const STRING_SELECT_CLASS =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

const STATUS_BADGES: Record<InvitationStatus, string> = {
  pending: "bg-brand/10 text-brand",
  accepted: "bg-muted text-muted-foreground",
  expired: "bg-destructive/10 text-destructive",
  revoked: "bg-muted text-muted-foreground line-through",
};

export type StaffMemberView = {
  readonly id: string;
  readonly fullName: string;
  readonly email: string;
  readonly role: "owner" | "head_pro" | "event_manager" | "superadmin";
};

export type InvitationView = {
  readonly id: string;
  readonly email: string;
  readonly role: InvitableRole;
  readonly status: InvitationStatus;
  readonly expiresAt: string;
};

const EMPTY_STATE = {} satisfies StaffActionState;

function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${month}/${day}/${year}`;
}

export function StaffManager({
  staff,
  invitations,
  seatLimit,
  seatsUsed,
  canInvite,
}: {
  staff: readonly StaffMemberView[];
  invitations: readonly InvitationView[];
  seatLimit: number | null;
  seatsUsed: number;
  canInvite: boolean;
}) {
  const [inviteState, inviteAction, invitePending] = useActionState<
    StaffActionState,
    FormData
  >(inviteStaffMember, EMPTY_STATE);
  const [revokeState, revokeAction, revokePending] = useActionState<
    StaffActionState,
    FormData
  >(revokeStaffInvitation, EMPTY_STATE);

  const inviteErrors = inviteState.fields ?? {};

  return (
    <div className="flex flex-col gap-6">
      {seatLimit !== null ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          {seatsUsed} of {seatLimit} staff seats used (owner included) — the
          Club plan includes {seatLimit} seats.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground tabular-nums">
          {seatsUsed} staff seats used — the Founding plan has no seat limit.
        </p>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">
          Staff ({staff.length})
        </h3>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {staff.map((member) => (
            <li
              key={member.id}
              className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {member.fullName}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {member.email}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {ROLE_LABELS[member.role]}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-medium text-foreground">
          Invitations ({invitations.length})
        </h3>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No open invitations. Invite a staff member below.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {invitation.email}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABELS[invitation.role]} · expires{" "}
                    <span className="tabular-nums">
                      {formatDate(invitation.expiresAt)}
                    </span>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGES[invitation.status]}`}
                  >
                    {invitation.status}
                  </span>
                  {invitation.status === "pending" && canInvite ? (
                    <form action={revokeAction}>
                      <input
                        type="hidden"
                        name="invitationId"
                        value={invitation.id}
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        size="sm"
                        disabled={revokePending}
                      >
                        <ShieldOff className="size-3.5" aria-hidden />
                        Revoke
                      </Button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {revokeState.error ? (
          <FieldError message={revokeState.error} />
        ) : null}
        {revokeState.saved && revokeState.message ? (
          <p className="text-sm text-foreground" role="status">
            {revokeState.message}
          </p>
        ) : null}
      </div>

      {canInvite ? (
        <form
          action={inviteAction}
          noValidate
          className="flex flex-col gap-4 border-t border-border pt-6"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-email">Email address</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                inputMode="email"
                placeholder="name@yourclub.com"
                aria-invalid={Boolean(inviteErrors.email)}
              />
              <FieldError message={inviteErrors.email} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-role">Role</Label>
              <select
                id="invite-role"
                name="role"
                defaultValue="event_manager"
                aria-invalid={Boolean(inviteErrors.role)}
                className={STRING_SELECT_CLASS}
              >
                {INVITABLE_ROLES.map((role) => (
                  <option key={role} value={role} className="bg-card">
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              <FieldError message={inviteErrors.role} />
            </div>
          </div>

          {inviteState.error ? (
            <FieldError message={inviteState.error} />
          ) : null}
          {inviteState.saved && inviteState.message ? (
            <p className="text-sm text-foreground" role="status">
              {inviteState.message}
            </p>
          ) : null}

          <div>
            <Button type="submit" size="lg" disabled={invitePending}>
              <Mail className="size-4" aria-hidden />
              {invitePending ? "Sending…" : "Send invitation"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground">
          Only the club owner and head pro can invite staff.
        </p>
      )}
    </div>
  );
}
