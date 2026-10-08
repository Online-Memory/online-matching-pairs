import { playerAction } from "@/server/actions";

export const POST = playerAction(async () => ({ type: "vote_kick" }));
