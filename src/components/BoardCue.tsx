import type { IdleLevel } from "@/lib/client/use-idle-level";

const TEXT: Record<IdleLevel, string> = {
  0: "It's your turn",
  1: "Your turn is about to end",
  2: "Make your move before the turn timer runs out!",
};

/** Sits over the board while it is the viewer's turn and grows louder the longer they do nothing. */
export function BoardCue({ level }: { level: IdleLevel }) {
  // The status line already announces "Your turn"; only the warnings are worth interrupting for.
  const announce = level > 0 ? { "aria-live": "polite" as const } : { "aria-hidden": true };
  return (
    <p className="board-cue" data-level={level} data-testid="board-cue" {...announce}>
      {TEXT[level]}
    </p>
  );
}
