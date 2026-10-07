"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { CODE_ALPHABET, CODE_LENGTH } from "@/lib/protocol";

import { Button } from "./Button";

export function JoinByCode() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [opening, startOpening] = useTransition();
  const valid = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code);

  return (
    <form
      className="join-code"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid && !opening) startOpening(() => router.push(`/table/${code}`));
      }}
    >
      <h2>Join friends</h2>
      <div className="field">
        <label htmlFor="code">Table code</label>
        <input
          id="code"
          value={code}
          onChange={(e) =>
            setCode(
              e.target.value
                .toUpperCase()
                .replace(/[^A-Z0-9]/g, "")
                .slice(0, CODE_LENGTH),
            )
          }
          placeholder="ABC234"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
        />
      </div>
      <Button type="submit" disabled={!valid} pending={opening}>
        Open table
      </Button>
    </form>
  );
}
