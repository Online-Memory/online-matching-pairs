import { AWARD_LABEL, type Award } from "@/lib/client/awards";

export function AwardChips({ awards }: { awards: readonly Award[] }) {
  if (awards.length === 0) return null;
  return (
    <span className="award-chips">
      {awards.map((a) => (
        <span key={a} className="award-chip" data-award={a}>
          {AWARD_LABEL[a]}
        </span>
      ))}
    </span>
  );
}
