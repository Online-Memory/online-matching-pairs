"use client";

import Link from "next/link";

import { useMe } from "@/lib/client/use-me";

import { ThemeToggle } from "./ThemeToggle";

export function SiteHeader() {
  const me = useMe();
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        Matching Pairs
      </Link>
      <div className="site-header-end">
        <nav aria-label="Account">
          {me?.authEnabled &&
            (me.user ? (
              <Link href="/profile">{me.user.name}</Link>
            ) : (
              <Link href="/auth/sign-in">Sign in</Link>
            ))}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
