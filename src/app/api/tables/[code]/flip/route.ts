import { flipRequestSchema } from "@/lib/protocol";
import { playerAction } from "@/server/actions";
import { readJson } from "@/server/http";

export const POST = playerAction(async (request) => {
  const { tileId } = await readJson(request, flipRequestSchema);
  return { type: "flip", tileId };
});
