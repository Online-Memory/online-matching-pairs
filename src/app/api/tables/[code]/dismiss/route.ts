import { playerAction } from "@/server/actions";

export const POST = playerAction(async () => ({ type: "dismiss" }));
