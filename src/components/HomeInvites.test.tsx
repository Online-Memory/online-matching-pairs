// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/client/api";
import * as meModule from "@/lib/client/use-me";
import type { FriendsResponse } from "@/lib/protocol";

import { HomeInvites } from "./HomeInvites";

const withInvite: FriendsResponse = {
  handle: "alice",
  friends: [{ userId: "b", handle: "bob", name: "Bob", online: true, lastSeenAt: new Date().toISOString() }],
  incoming: [{ userId: "d", handle: "dave", name: "Dave" }],
  outgoing: [],
  invites: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      tableCode: "ABC234",
      fromName: "Bob",
      fromHandle: "bob",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  ],
};

beforeEach(() => {
  vi.spyOn(meModule, "useMe").mockReturnValue({
    authEnabled: true,
    user: { id: "a", name: "Alice", email: null, image: null },
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HomeInvites", () => {
  it("shows only the invites, with a way in and a way to dismiss", async () => {
    vi.spyOn(api, "friends").mockResolvedValue(withInvite);
    const dismiss = vi.spyOn(api, "dismissInvite").mockResolvedValue({ ok: true });
    render(<HomeInvites />);
    expect(await screen.findByRole("link", { name: /Join ABC234/ })).toHaveAttribute(
      "href",
      "/table/ABC234?join=1",
    );
    expect(screen.queryByText(/Dave/)).toBeNull();
    expect(screen.queryByLabelText(/friend's handle/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(dismiss).toHaveBeenCalledWith(withInvite.invites[0]!.id));
  });

  it("renders nothing when there are no invites", async () => {
    vi.spyOn(api, "friends").mockResolvedValue({ ...withInvite, invites: [] });
    const { container } = render(<HomeInvites />);
    await waitFor(() => expect(api.friends).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
