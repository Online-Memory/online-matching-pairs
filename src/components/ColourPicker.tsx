"use client";

import { PALETTE } from "@/lib/protocol";

type Props = {
  label: string;
  /** The picked colour, or null when none is picked yet. */
  value: number | null;
  /** Colours that cannot be picked (held by someone else, or already used in another slot). */
  taken: ReadonlySet<number>;
  onPick: (colour: number) => void;
  disabled?: boolean;
};

/** Every palette colour as a named swatch. Names matter: colour alone is a weak signal for the closest pairs. */
export function ColourPicker({ label, value, taken, onPick, disabled }: Props) {
  return (
    <div className="colour-picker" role="radiogroup" aria-label={label}>
      {PALETTE.map((colour, index) => (
        <button
          key={colour.name}
          type="button"
          role="radio"
          aria-checked={value === index}
          aria-label={colour.name}
          className="colour-chip"
          data-seat={index}
          disabled={disabled || (taken.has(index) && value !== index)}
          onClick={() => onPick(index)}
        >
          <span className="seat-token" aria-hidden />
          <span className="colour-chip-name">{colour.name}</span>
        </button>
      ))}
    </div>
  );
}
