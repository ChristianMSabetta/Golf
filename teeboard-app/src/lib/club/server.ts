import "server-only";
import { cache } from "react";
import { getRequestSupabase } from "@/lib/supabase/server";
import { getStaff, type AuthenticatedStaff } from "@/lib/auth/authorization";
import { resolveClubBrand, type ClubBrand } from "@/lib/brand";

export type Club = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly logoUrl: string | null;
  readonly primaryColor: string | null;
  readonly timezone: string;
  readonly contactEmail: string | null;
  readonly brand: ClubBrand;
};

type ClubRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  primary_color: string | null;
  timezone: string;
  contact_email: string | null;
};

const CLUB_COLUMNS =
  "id, name, slug, logo_url, primary_color, timezone, contact_email";

function toClub(row: ClubRow): Club {
  return Object.freeze({
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    primaryColor: row.primary_color,
    timezone: row.timezone,
    contactEmail: row.contact_email,
    brand: resolveClubBrand({
      name: row.name,
      logoUrl: row.logo_url,
      primaryColor: row.primary_color,
      timezone: row.timezone,
    }),
  });
}

/**
 * Loads one club row through the request-bound client so PostgREST applies
 * RLS: an unauthenticated caller or a staff member of another club gets
 * nothing (the clubs policies are read-only for the owning club's staff).
 * Cached per request so the layout, dashboard, and settings page share one
 * read.
 */
export const getClub = cache(
  async (clubId: string): Promise<Club | null> => {
    const client = await getRequestSupabase();

    const { data, error } = await client
      .from("clubs")
      .select(CLUB_COLUMNS)
      .eq("id", clubId)
      .maybeSingle<ClubRow>();

    if (error) {
      throw new Error(`Failed to load club: ${error.message}`);
    }

    return data ? toClub(data) : null;
  },
);

export type ClubContext = {
  readonly staff: AuthenticatedStaff;
  readonly club: Club;
};

/**
 * Resolves the signed-in staff member's club (or null for a superadmin
 * without a club assignment and for staff not yet linked to a club).
 * Cached per request: the staff profile and club row are each fetched once
 * no matter how many admin components need them.
 */
export const getStaffClub = cache(
  async (): Promise<ClubContext | null> => {
    const staff = await getStaff();
    if (!staff || staff.clubId === null) return null;
    const club = await getClub(staff.clubId);
    if (!club) return null;
    return { staff, club };
  },
);
