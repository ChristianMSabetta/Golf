import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthContext, getServerSupabase } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/auth/first-run";
import { invitationUsable } from "@/lib/staff/schema";
import { acceptInvitation } from "@/lib/staff/server";

export const metadata: Metadata = {
  title: "Accept staff invitation",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

type AcceptSearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Staff invitation accept route (M4-T010): a signed-in invitee follows the
 * emailed link, the invitation's expiry/revocation is re-checked
 * **server-side** (never trusted from the link), and the staff profile is
 * linked to the club with the invitation's role. Not signed in → the
 * sign-in page with a `next` bounce-back to this exact URL, so the accept
 * completes after authentication (magic link or password).
 */
export default async function StaffAcceptPage({
  searchParams,
}: {
  searchParams: AcceptSearchParams;
}) {
  const params = await searchParams;
  const clubSlug = firstParam(params.club) ?? "";
  const token = firstParam(params.token) ?? "";

  if (clubSlug === "" || token === "") {
    return <InvalidInvitation message="This invitation link is incomplete." />;
  }

  const { user } = await getAuthContext();
  if (!user) {
    const next = encodeURIComponent(
      `/staff/accept?club=${encodeURIComponent(clubSlug)}&token=${encodeURIComponent(token)}`,
    );
    redirect(`/sign-in?next=${next}`);
  }

  const client = getServerSupabase();
  const { data: invitation } = await client
    .from("staff_invitations")
    .select("id, club_id, email, role, token, status, expires_at, accepted_at, created_at")
    .eq("token", token)
    .maybeSingle<{
      id: string;
      club_id: string;
      email: string;
      role: string;
      token: string;
      status: string;
      expires_at: string;
      accepted_at: string | null;
      created_at: string;
    }>();

  if (!invitation) {
    return (
      <InvalidInvitation message="This invitation does not exist — ask your club owner to send a new one." />
    );
  }

  const { data: club } = await client
    .from("clubs")
    .select("id, slug, name")
    .eq("id", invitation.club_id)
    .maybeSingle<{ id: string; slug: string; name: string }>();

  if (!club || club.slug !== clubSlug) {
    return <InvalidInvitation message="This invitation link is not valid." />;
  }

  const profile = await ensureProfile({
    id: user.id,
    email: user.email ?? "",
    fullName: user.user_metadata?.full_name,
  });

  const usable = invitationUsable(
    {
      status: invitation.status as Parameters<typeof invitationUsable>[0]["status"],
      expiresAt: invitation.expires_at,
    },
    new Date(),
  );

  if (!usable.usable) {
    const reason =
      usable.reason === "revoked"
        ? "This invitation was revoked by the club."
        : usable.reason === "accepted"
          ? "This invitation was already used."
          : "This invitation has expired — ask your club owner to send a new one.";
    return <InvalidInvitation message={reason} clubName={club.name} />;
  }

  if (invitation.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
    return (
      <InvalidInvitation
        message={`This invitation was sent to ${invitation.email}. Sign in with that email address to accept it.`}
        clubName={club.name}
      />
    );
  }

  const result = await acceptInvitation({
    clubSlug,
    token,
    userId: user.id,
    email: user.email ?? "",
    fullName: profile.full_name,
  });

  if (!result.ok) {
    return (
      <InvalidInvitation
        message="This invitation could not be accepted — ask your club owner to send a new one."
        clubName={club.name}
      />
    );
  }

  redirect("/admin");
}

function InvalidInvitation({
  message,
  clubName,
}: {
  message: string;
  clubName?: string;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-3">
      <h1 className="font-heading text-2xl font-semibold text-foreground">
        {clubName ? `Invitation — ${clubName}` : "Staff invitation"}
      </h1>
      <p className="text-sm text-muted-foreground" role="alert">
        {message}
      </p>
    </main>
  );
}
