"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/client/api";
import { authClient } from "@/lib/client/auth-client";
import { invalidateMe, useMe } from "@/lib/client/use-me";
import type { ProgressResponse, StatsResponse } from "@/lib/protocol";

import { AchievementsPanel } from "./AchievementsPanel";
import { Button } from "./Button";
import { FinishedGames } from "./FinishedGames";
import { FriendsPanel } from "./FriendsPanel";
import { LevelBar } from "./LevelBar";
import { ProfileColours } from "./ProfileColours";
import { LoadingNotice } from "./Spinner";
import { StatsPanel } from "./StatsPanel";

export function Profile() {
  const me = useMe();
  const router = useRouter();
  const [stats, setStats] = useState<StatsResponse | null | undefined>(undefined); // undefined: still loading
  const [progress, setProgress] = useState<ProgressResponse | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!me?.user) return;
    api.stats().then(setStats, () => setStats(null));
    api.progress().then(setProgress, () => setProgress(null));
  }, [me?.user]);

  if (!me) return <LoadingNotice />;
  if (!me.user) {
    return (
      <>
        <h1>Your games</h1>
        <p>Sign in to keep a record of the games you finish.</p>
        <Link className="button" href="/auth/sign-in">
          Sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <header className="profile-head">
        <span className="avatar profile-avatar" aria-hidden>
          {me.user.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="profile-id">
          <h1>{me.user.name}</h1>
          {me.user.email && <p className="hint">{me.user.email}</p>}
        </div>
        <Button
          className="button-quiet"
          pending={signingOut}
          onClick={async () => {
            setSigningOut(true);
            try {
              await authClient.signOut();
              invalidateMe();
              router.push("/");
              router.refresh();
            } catch {
              setSigningOut(false);
            }
          }}
        >
          Sign out
        </Button>
      </header>
      <div className="profile-grid">
        <div className="profile-col">
          {progress && <LevelBar progress={progress} />}
          {stats === undefined ? (
            <LoadingNotice>Loading your record…</LoadingNotice>
          ) : (
            stats && <StatsPanel stats={stats} />
          )}
          {progress && <AchievementsPanel earned={progress.achievements ?? []} />}
        </div>
        <div className="profile-col">
          <ProfileColours />
          <FriendsPanel />
        </div>
      </div>
      <FinishedGames />
    </>
  );
}
