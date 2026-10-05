"use client";

import { api } from "@/lib/client/api";
import { useFriends } from "@/lib/client/use-friends";

import { InviteList } from "./InviteList";

/** Home page notice. Only invites live here; the rest of the friends UI is on the profile page. */
export function HomeInvites() {
  const { data, refresh } = useFriends();
  if (!data || data.invites.length === 0) return null;

  return (
    <section className="friends-card home-invites">
      <h2>Table invites</h2>
      <InviteList
        invites={data.invites}
        onDismiss={(id) => void api.dismissInvite(id).then(refresh, () => {})}
      />
    </section>
  );
}
