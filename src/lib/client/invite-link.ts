/** Where accepting a table invite goes: the table page, which seats the invitee on arrival (`?join=1`). */
export function inviteHref(tableCode: string): string {
  return `/table/${tableCode}?join=1`;
}
