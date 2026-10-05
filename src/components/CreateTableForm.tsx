"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/client/api";
import { loadGuestName, saveGuestName } from "@/lib/client/guest-name";
import { useMe } from "@/lib/client/use-me";
import {
  MAX_PLAYERS,
  maxPlayersFor,
  PAIR_OPTIONS,
  THEMES,
  TURN_SECONDS_OPTIONS,
  themePreviewUrl,
  type ThemeId,
} from "@/lib/protocol";

import { NameField } from "./NameField";

export function CreateTableForm() {
  const router = useRouter();
  const me = useMe();
  const [name, setName] = useState("");
  const [theme, setTheme] = useState<ThemeId>("001");
  const [pairs, setPairs] = useState(12);
  const [turnSeconds, setTurnSeconds] = useState(20);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // localStorage only exists in the browser, so the remembered name is filled in after hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setName((current) => current || loadGuestName()), []);

  const maxPairs = THEMES.find((t) => t.id === theme)!.maxPairs;
  const needsName = me !== null && !me.user;
  const playerCap = maxPlayersFor(!!me?.user);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (needsName) saveGuestName(name);
      const { code } = await api.createTable({
        theme,
        pairs: Math.min(pairs, maxPairs),
        turnSeconds,
        name: needsName ? name.trim() : undefined,
      });
      router.push(`/table/${code}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the table");
      setPending(false);
    }
  }

  return (
    <form className="create-form" onSubmit={submit} aria-labelledby="create-heading">
      <h2 id="create-heading">Set up a table</h2>

      <fieldset className="theme-picker">
        <legend>Pictures</legend>
        {THEMES.map((t) => (
          <label key={t.id} className="theme-option">
            <input
              type="radio"
              name="theme"
              value={t.id}
              checked={theme === t.id}
              onChange={() => setTheme(t.id)}
            />
            {/* eslint-disable-next-line @next/next/no-img-element -- small static preview */}
            <img src={themePreviewUrl(t.id)} alt="" width={96} height={96} loading="lazy" />
            <span>{t.name}</span>
          </label>
        ))}
      </fieldset>

      <div className="field-row">
        <div className="field">
          <label htmlFor="pairs">Tiles</label>
          <select id="pairs" value={pairs} onChange={(e) => setPairs(Number(e.target.value))}>
            {PAIR_OPTIONS.filter((p) => p <= maxPairs).map((p) => (
              <option key={p} value={p}>
                {p * 2}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="turn-seconds">Seconds per turn</label>
          <select
            id="turn-seconds"
            value={turnSeconds}
            onChange={(e) => setTurnSeconds(Number(e.target.value))}
          >
            {TURN_SECONDS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      {needsName && <NameField id="create-name" value={name} onChange={setName} />}
      {me?.user && <p className="hint">Playing as {me.user.name}</p>}
      <p className="hint">
        Players join after you create the table: up to {playerCap}.
        {me?.authEnabled && !me.user && (
          <>
            {" "}
            <Link href="/auth/sign-in">Sign in</Link> to host up to {MAX_PLAYERS}.
          </>
        )}
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="button"
        disabled={pending || me === null || (needsName && !name.trim())}
      >
        {pending ? "Creating…" : "Create table"}
      </button>
    </form>
  );
}
