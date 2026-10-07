import { CHEAT_CODES, CHEAT_HEADER, type CheatCode } from "@/lib/protocol";

/** Cheat codes switched on in the page URL, e.g. `?cheatmode=true`. */
export function activeCheats(search: string = typeof window === "undefined" ? "" : window.location.search) {
  const params = new URLSearchParams(search);
  return CHEAT_CODES.filter((code) => params.get(code) === "true") as CheatCode[];
}

/** The request header that forwards the active codes to the server; empty when there are none. */
export function cheatHeader(search?: string): Record<string, string> {
  const codes = activeCheats(search);
  return codes.length ? { [CHEAT_HEADER]: codes.join(",") } : {};
}
