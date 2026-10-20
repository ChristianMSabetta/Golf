import "server-only";
import { getServerSupabase, type ProfileRow } from "@/lib/supabase/server";
import type { OwnerSignUp } from "@/lib/auth/schema";

export type FirstRunResult = {
  readonly clubId: string;
  readonly profileId: string;
};

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function withUniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const slug = slugify(base) || "club";
  if (!(await isTaken(slug))) return slug;

  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const candidate = `${slug}-${Math.random().toString(36).slice(2, 7)}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  throw new Error("Could not allocate a club slug; please try again.");
}

/**
 * First-run provisioning for a brand-new owner: creates the club and links
 * the owner profile to it. Runs entirely with the service-role client
 * (clubs is read-only for staff by RLS; tenant roots are created
 * server-side) and is idempotent: a user that already has a club profile is
 * returned as-is.
 *
 * Role assignment happens here, server-side — a client payload can never
 * choose another member's role, and `owner` is only granted to the member
 * that provisions the club (the per-club unique partial index enforces that
 * at the database level too).
 */
export async function provisionFirstRun(
  user: { id: string; email: string },
  input: Pick<OwnerSignUp, "fullName" | "clubName" | "timezone">,
): Promise<FirstRunResult> {
  const client = getServerSupabase();

  const { data: existing, error: existingError } = await client
    .from("profiles")
    .select("id, club_id")
    .eq("user_id", user.id)
    .maybeSingle<Pick<ProfileRow, "id" | "club_id">>();

  if (existingError) {
    throw new Error(`Failed to load existing profile: ${existingError.message}`);
  }

  if (existing?.club_id) {
    return { clubId: existing.club_id, profileId: existing.id };
  }

  const slug = await withUniqueSlug(input.clubName, async (candidate) => {
    const { data } = await client
      .from("clubs")
      .select("id")
      .eq("slug", candidate)
      .maybeSingle<{ id: string }>();
    return Boolean(data);
  });

  const { data: club, error: clubError } = await client
    .from("clubs")
    .insert({
      name: input.clubName,
      slug,
      timezone: input.timezone,
      contact_email: user.email,
    })
    .select("id")
    .single<{ id: string }>();

  if (clubError) {
    throw new Error(`Failed to create club: ${clubError.message}`);
  }

  if (existing) {
    const { error: linkError } = await client
      .from("profiles")
      .update({
        club_id: club.id,
        full_name: input.fullName,
        role: "owner",
      })
      .eq("id", existing.id);

    if (linkError) {
      throw new Error(`Failed to link owner profile: ${linkError.message}`);
    }

    return { clubId: club.id, profileId: existing.id };
  }

  const { data: profile, error: profileError } = await client
    .from("profiles")
    .insert({
      user_id: user.id,
      club_id: club.id,
      full_name: input.fullName,
      email: user.email,
      role: "owner",
    })
    .select("id")
    .single<Pick<ProfileRow, "id">>();

  if (profileError) {
    throw new Error(`Failed to create owner profile: ${profileError.message}`);
  }

  return { clubId: club.id, profileId: profile.id };
}

/**
 * Ensures a profile row exists for a signed-in staff user (magic-link and
 * password sign-in both land here when no profile was provisioned yet —
 * e.g. an invited staff member, whose invitation flow arrives in Phase 3).
 * Returns the profile; club linkage stays null until an owner provisions it.
 */
export async function ensureProfile(
  user: { id: string; email: string; fullName?: string },
): Promise<ProfileRow> {
  const client = getServerSupabase();

  const { data: existing } = await client
    .from("profiles")
    .select(
      "id, user_id, club_id, full_name, email, role, is_superadmin",
    )
    .eq("user_id", user.id)
    .maybeSingle<ProfileRow>();

  if (existing) return existing;

  const { data: profile, error } = await client
    .from("profiles")
    .insert({
      user_id: user.id,
      club_id: null,
      full_name: user.fullName ?? user.email,
      email: user.email,
      role: "event_manager",
    })
    .select(
      "id, user_id, club_id, full_name, email, role, is_superadmin",
    )
    .single<ProfileRow>();

  if (error) {
    throw new Error(`Failed to create profile: ${error.message}`);
  }

  return profile;
}
