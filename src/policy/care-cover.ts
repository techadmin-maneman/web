// Who answers for a Care person who is off (docs/decisions/0134-care-cover.md): a weekly day off or leave over the day
// puts them off, and the member on with the fewest clients covers them. Each cover takes on the clients of who they
// cover before the next is placed, so two people off go to two people where the team allows.

export interface OffDays {
  /** 0 Sunday to 6 Saturday. */
  readonly weekly: readonly number[];
  /** Inclusive India dates. */
  readonly leave: readonly { readonly from: string; readonly to: string }[];
}

/** India's weekday on a date: 0 for Sunday. */
export const weekdayOf = (date: string): number => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Whether someone with these days off is off on an India date. */
export const isOff = (date: string, off: OffDays): boolean =>
  off.weekly.includes(weekdayOf(date)) || off.leave.some((each) => each.from <= date && date <= each.to);

/** For each member off, the member who covers them; nobody where the whole team is off. */
export function coversOf(
  team: readonly { readonly email: string; readonly clients: number }[],
  off: ReadonlySet<string>,
): Map<string, string> {
  const on = team.filter((member) => !off.has(member.email)).map((member) => ({ ...member }));
  const covers = new Map<string, string>();
  for (const member of team.filter((each) => off.has(each.email))) {
    const [cover] = [...on].sort((one, other) => one.clients - other.clients || one.email.localeCompare(other.email));
    if (cover === undefined) break;
    covers.set(member.email, cover.email);
    cover.clients += member.clients;
  }
  return covers;
}
