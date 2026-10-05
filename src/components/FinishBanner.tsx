import type { CSSProperties } from "react";

import type { FinishMessage } from "@/lib/client/finish-message";

/**
 * The game-over headline, shown over the board and under the confetti. It zooms and fades in, holds,
 * and fades out so that it is gone as the confetti ends; the parent unmounts it after `durationMs`.
 */
export function FinishBanner({ message, durationMs }: { message: FinishMessage; durationMs: number }) {
  return (
    <div
      className="finish-banner"
      data-won={message.won}
      style={{ "--banner-ms": `${durationMs}ms` } as CSSProperties}
      role="status"
      data-testid="finish-banner"
    >
      <p className="finish-banner-title">{message.title}</p>
      <p className="finish-banner-detail">{message.detail}</p>
    </div>
  );
}
