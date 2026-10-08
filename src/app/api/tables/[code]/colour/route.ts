import { chooseColourRequestSchema } from "@/lib/protocol";
import { playerAction } from "@/server/actions";
import { readJson } from "@/server/http";

/** Switch to a free colour while the table is still a lobby. */
export const POST = playerAction(async (request) => ({
  type: "choose_colour",
  colour: (await readJson(request, chooseColourRequestSchema)).colour,
}));
