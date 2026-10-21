import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Event admin Groups tab (M4-T008): the read-only composition view of the
 * event's persisted groups — each group's members (with handicap index),
 * shotgun starting hole, and cart number. Editing stays in the wizard
 * (drafts); a published event's groups are the day&apos;s actual pairings.
 */
export function GroupsTab({
  groups,
  members,
}: {
  groups: readonly {
    readonly id: string;
    readonly name: string;
    readonly startingHole: number | null;
    readonly cartNumber: number | null;
  }[];
  members: readonly {
    readonly playerId: string;
    readonly fullName: string;
    readonly handicapIndex: number | null;
    readonly groupId: string | null;
  }[];
}) {
  const byGroup = new Map<string, (typeof members)[number][]>();
  const unassigned: (typeof members)[number][] = [];
  for (const member of members) {
    if (member.groupId === null) {
      unassigned.push(member);
      continue;
    }
    const bucket = byGroup.get(member.groupId);
    if (bucket === undefined) {
      byGroup.set(member.groupId, [member]);
    } else {
      bucket.push(member);
    }
  }

  if (groups.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No groups yet</CardTitle>
          <CardDescription>
            Groups are formed in the wizard&apos;s Groups &amp; teams step. Drafts can
            still be paired there; a published event reflects the day&apos;s
            actual pairings.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-4 sm:grid-cols-2">
        {groups.map((group) => {
          const roster = byGroup.get(group.id) ?? [];
          return (
            <li key={group.id}>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>{group.name}</CardTitle>
                  <CardDescription className="tabular-nums">
                    {group.startingHole !== null ? `Hole ${group.startingHole}` : "Tee times"}
                    {group.cartNumber !== null ? ` · Cart ${group.cartNumber}` : ""}
                    {" · "}
                    {roster.length} player{roster.length === 1 ? "" : "s"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {roster.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Empty group.</p>
                  ) : (
                    <ul className="grid gap-1">
                      {roster.map((member) => (
                        <li
                          key={member.playerId}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="min-w-0 truncate font-medium">
                            {member.fullName}
                          </span>
                          <span className="tabular-nums text-xs text-muted-foreground">
                            HI {member.handicapIndex === null ? "—" : member.handicapIndex}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>

      {unassigned.length > 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Unassigned</CardTitle>
            <CardDescription>
              {unassigned.length} player{unassigned.length === 1 ? "" : "s"} not
              placed in a group.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-1">
              {unassigned.map((member) => (
                <li key={member.playerId} className="text-sm">
                  <span className="min-w-0 truncate font-medium">{member.fullName}</span>
                  <span className="ml-2 tabular-nums text-xs text-muted-foreground">
                    HI {member.handicapIndex === null ? "—" : member.handicapIndex}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
