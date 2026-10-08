"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/client/api";
import { colourName, MAX_COLOUR_PREFS } from "@/lib/protocol";

import { ColourPicker } from "./ColourPicker";

const ORDINALS = ["1st", "2nd", "3rd"];

/** Up to three preferred colours in priority order. Each change is saved at once and undone if the save fails. */
export function ProfileColours() {
  const [prefs, setPrefs] = useState<number[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    api.colours().then(
      (r) => current && (setPrefs(r.colours), setLoadFailed(false)),
      () => current && setLoadFailed(true),
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  // Never start from an empty list after a failed load: the first save would overwrite what is really stored.
  if (loadFailed) {
    return (
      <section className="profile-colours" aria-labelledby="profile-colours-heading">
        <h2 id="profile-colours-heading">Preferred colours</h2>
        <p role="alert">Couldn&apos;t load your colours.</p>
        <button type="button" className="button-quiet" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </section>
    );
  }
  if (!prefs) return null;

  async function save(next: number[]) {
    const before = prefs;
    setPrefs(next);
    setError(false);
    try {
      setPrefs((await api.setColours(next)).colours);
    } catch {
      setPrefs(before);
      setError(true);
    }
  }

  const pick = (colour: number) => {
    if (active === null) return;
    const next = [...prefs!];
    next[active] = colour;
    setActive(null);
    void save(next);
  };
  const clear = (slot: number) => {
    // Clearing shifts the later slots up, so an open picker would be editing a different slot.
    setActive(null);
    void save(prefs!.filter((_, i) => i !== slot));
  };

  // A colour already used in another slot can't be picked again.
  const usedElsewhere = new Set(prefs.filter((_, i) => i !== active));

  return (
    <section className="profile-colours" aria-labelledby="profile-colours-heading">
      <h2 id="profile-colours-heading">Preferred colours</h2>
      <p className="hint">At a new table you get your highest choice that is still free.</p>
      <ol className="colour-slots">
        {Array.from({ length: MAX_COLOUR_PREFS }, (_, slot) => {
          const colour = prefs[slot];
          return (
            <li key={slot} data-seat={colour}>
              <button
                type="button"
                className="colour-slot"
                aria-pressed={active === slot}
                aria-label={`${ORDINALS[slot]} choice: ${colour === undefined ? "none" : colourName(colour)}`}
                // Slots fill in order, so only the next empty one or a filled one can be edited.
                disabled={slot > prefs.length}
                onClick={() => setActive(active === slot ? null : slot)}
              >
                {colour !== undefined && <span className="seat-token" aria-hidden />}
                {colour === undefined ? `${ORDINALS[slot]} choice` : colourName(colour)}
              </button>
              {colour !== undefined && (
                <button
                  type="button"
                  className="button-quiet"
                  aria-label={`Clear ${ORDINALS[slot]} choice`}
                  onClick={() => clear(slot)}
                >
                  Clear
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {active !== null && (
        <ColourPicker
          label={`Pick your ${ORDINALS[active]} choice`}
          value={prefs[active] ?? null}
          taken={usedElsewhere}
          onPick={pick}
        />
      )}
      {error && <p role="alert">Couldn&apos;t save your colours. Try again.</p>}
    </section>
  );
}
