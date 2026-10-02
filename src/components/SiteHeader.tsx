"use client";

import Link from "next/link";

import { useMe } from "@/lib/client/use-me";

export function SiteHeader() {
  const me = useMe();
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        Matching Pairs
      </Link>
      <nav aria-label="Account">
        {me?.authEnabled &&
          (me.user ? <Link href="/profile">{me.user.name}</Link> : <Link href="/auth/sign-in">Sign in</Link>)}
      </nav>
    </header>
  );
}
