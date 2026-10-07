"use client";

import { api } from "@/lib/client/api";
import { useFriends } from "@/lib/client/use-friends";
import { usePending } from "@/lib/client/use-pending";

import { InviteList } from "./InviteList";

/** Home page notice. Only invites live here; the rest of the friends UI is on the profile page. */
export function HomeInvites() {
  const { data, refresh } = useFriends();
  const pending = usePending();
  if (!data || data.invites.length === 0) return null;

  return (
    <section className="friends-card home-invites">
      <h2>Table invites</h2>
      <InviteList
        invites={data.invites}
        isDismissing={pending.isPending}
        onDismiss={(id) =>
          void pending.run(id, () =>
            api
              .dismissInvite(id)
              .then(refresh)
              .catch(() => {}),
          )
        }
      />
    </section>
  );
}
