import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth/authorization";
import { getStaffClub } from "@/lib/club/server";
import {
  listPlayers,
  findDuplicateGroups,
} from "@/lib/players/server";
import {
  playerListParamsSchema,
  type PlayerListParams,
} from "@/lib/players/schema";
import { PlayersTable } from "@/components/admin/players/players-table";
import { PlayersImport } from "@/components/admin/players/players-import";
import { DuplicatesPanel } from "@/components/admin/players/duplicates-panel";

export const metadata: Metadata = {
  title: "Players",
};

// Session-dependent: never prerendered at build time.
export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readSearchParams(
  searchParams: Record<string, string | string[] | undefined>,
): PlayerListParams {
  const result = playerListParamsSchema.safeParse({
    search: first(searchParams.q),
    sort: first(searchParams.sort),
    direction: first(searchParams.dir),
  });
  // Query strings are user-controlled — a bad value falls back to the
  // defaults instead of throwing.
  return result.success ? result.data : playerListParamsSchema.parse({});
}

/**
 * The club player database (M4-T002): a searchable, sortable table (name,
 * email, HI, last event, event count) with server-side filtering through
 * the request-bound client so RLS applies, inline handicap-index edits,
 * CSV import/export, and one-click duplicate merging. Search and sort ride
 * the URL query so filtering is server-rendered per navigation.
 */
export default async function PlayersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireStaff();
  const context = await getStaffClub();

  if (!context) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Players
        </h1>
        <p className="text-sm text-muted-foreground">
          No club is linked to your account yet — ask your club owner to
          invite you.
        </p>
      </div>
    );
  }

  const params = readSearchParams(await searchParams);

  const clubId = context.club.id;
  const [players, duplicates] = await Promise.all([
    listPlayers(clubId, params),
    findDuplicateGroups(clubId),
  ]);

  const canEdit =
    context.staff.isSuperadmin ||
    ["owner", "head_pro", "event_manager"].includes(context.staff.role);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          Players
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The club database for {context.club.name}&apos;s golfers — search,
          edit handicaps inline, import/export CSV, and merge duplicates.
        </p>
      </div>

      <DuplicatesPanel duplicates={duplicates} canEdit={canEdit} />

      <PlayersTable
        players={players}
        duplicates={duplicates}
        canEdit={canEdit}
      />

      {canEdit ? <PlayersImport /> : null}
    </div>
  );
}
