// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import { refreshFriends } from "@/lib/client/use-friends";
import * as meModule from "@/lib/client/use-me";
import type { FriendsResponse, InviteEntry, MeResponse } from "@/lib/protocol";

import { InviteBanner } from "./InviteBanner";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const signedIn: MeResponse = {
  authEnabled: true,
  user: { id: "a", name: "Alice", email: null, image: null },
};
const base: FriendsResponse = { handle: "alice", friends: [], incoming: [], outgoing: [], invites: [] };
const invite = (id: string, tableCode: string): InviteEntry => ({
  id,
  tableCode,
  fromName: "Dave",
  fromHandle: "dave",
  expiresAt: "2099-01-01T00:00:00Z",
});

beforeEach(() => {
  pathname = "/";
  vi.spyOn(meModule, "useMe").mockReturnValue(signedIn);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("InviteBanner", () => {
  it("offers to join the invited table from any page", async () => {
    pathname = "/profile";
    vi.spyOn(api, "friends").mockResolvedValue({ ...base, invites: [invite("i1", "ABCD")] });
    render(<InviteBanner />);

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Dave");
    expect(screen.getByRole("link", { name: "Join ABCD" })).toHaveAttribute("href", "/table/ABCD?join=1");
  });

  it("dismisses the invite on the server", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({ ...base, invites: [invite("i1", "ABCD")] });
    const dismiss = vi.spyOn(api, "dismissInvite").mockResolvedValue({ ok: true });
    render(<InviteBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith("i1"));
  });

  it("stays away after Later, even when a new poll lands", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({ ...base, invites: [invite("i1", "ABCD")] });
    render(<InviteBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    expect(screen.queryByRole("status")).toBeNull();

    await act(() => refreshFriends());
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("comes back after a reload while the invite is still pending", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({ ...base, invites: [invite("i1", "ABCD")] });
    const first = render(<InviteBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Later" }));
    first.unmount();

    render(<InviteBanner />);
    expect(await screen.findByRole("status")).toHaveTextContent("Dave");
  });

  it("hides an invite to the table you are already on", async () => {
    pathname = "/table/ABCD";
    const friends = vi.spyOn(api, "friends").mockResolvedValue({ ...base, invites: [invite("i1", "ABCD")] });
    render(<InviteBanner />);
    await waitFor(() => expect(friends).toHaveBeenCalled());
    expect(screen.queryByRole("status")).toBeNull();
  });
});
