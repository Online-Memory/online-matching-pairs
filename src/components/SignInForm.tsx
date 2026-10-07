"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/client/auth-client";
import { invalidateMe, useMe } from "@/lib/client/use-me";

import { Button } from "./Button";

export function SignInForm() {
  const router = useRouter();
  const me = useMe();
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"email" | "google" | null>(null);

  if (me && !me.authEnabled) {
    return (
      <p className="notice">Accounts aren&apos;t set up on this server. You can still play as a guest.</p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending("email");
    setError(null);
    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: name.trim() });
    if (result.error) {
      setError(result.error.message ?? "That didn't work. Check your details and try again.");
      setPending(null);
      return;
    }
    invalidateMe();
    router.push("/profile");
    router.refresh();
  }

  // On success the browser leaves for Google, so only the failure path runs here.
  async function continueWithGoogle() {
    if (pending) return;
    setPending("google");
    setError(null);
    const result = await authClient.signIn.social({ provider: "google", callbackURL: "/profile" });
    // Set when Neon Auth refuses to start the flow: provider disabled, untrusted origin (e.g. a
    // preview domain missing from the trusted domains), network down.
    if (result.error) {
      setError(result.error.message ?? "Google sign-in isn't available right now. Try email instead.");
      setPending(null);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <h1>{mode === "sign-in" ? "Sign in" : "Create an account"}</h1>
      <p>An account keeps your name and a record of the games you&apos;ve finished.</p>

      <Button
        className="button-quiet button-wide"
        onClick={() => void continueWithGoogle()}
        disabled={pending !== null}
        pending={pending === "google"}
      >
        Continue with Google
      </Button>

      {mode === "sign-up" && (
        <div className="field">
          <label htmlFor="auth-name">Name</label>
          <input
            id="auth-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={24}
          />
        </div>
      )}
      <div className="field">
        <label htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="field">
        <label htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          minLength={8}
          required
        />
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="button button-wide"
        disabled={pending !== null}
        pending={pending === "email"}
      >
        {mode === "sign-in" ? "Sign in" : "Create account"}
      </Button>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          setMode(mode === "sign-in" ? "sign-up" : "sign-in");
          setError(null);
        }}
      >
        {mode === "sign-in" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </form>
  );
}
