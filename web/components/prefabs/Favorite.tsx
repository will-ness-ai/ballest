"use client";
// The heart on a Prefab's page: how many players favorited it, and for the signed-in
// reader whether they have, toggled with one press. Signed out, a press says to sign in.
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Heart } from "./Heart";
import { useSession } from "../../hooks/me";
import { prefabFavoriteHref, signInHref } from "../../lib/routes";

export function Favorite({ slug, favorites }: { slug: string; favorites: number }) {
  const me = useSession();
  const path = usePathname();
  const [state, setState] = useState({ on: false, favorites });
  const [busy, setBusy] = useState(false);
  const [askSignIn, setAskSignIn] = useState(false);
  const url = prefabFavoriteHref(slug);
  useEffect(() => {
    if (!me) return;
    void fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<typeof state>) : null))
      .then((s) => s && setState(s));
  }, [me, url]);
  const press = async () => {
    if (me === null) return setAskSignIn(true);
    if (!me || busy) return;
    setBusy(true);
    const want = !state.on;
    setState((s) => ({ on: want, favorites: s.favorites + (want ? 1 : -1) }));
    try {
      const r = await fetch(url, { method: want ? "PUT" : "DELETE" });
      if (r.ok) setState((await r.json()) as typeof state);
      else setState((s) => ({ on: !want, favorites: s.favorites + (want ? -1 : 1) }));
    } catch {
      setState((s) => ({ on: !want, favorites: s.favorites + (want ? -1 : 1) }));
    }
    setBusy(false);
  };
  return (
    <>
      <button
        type="button"
        className={"pf-fav" + (state.on ? " on" : "")}
        aria-pressed={state.on}
        aria-label={`Favorite (${String(state.favorites)})`}
        onClick={() => void press()}
      >
        <Heart on={state.on} /> {state.favorites}
      </button>
      {askSignIn && (
        <p className="pf-note">
          <a href={signInHref(path)}>Sign in with Steam</a> to favorite prefabs.
        </p>
      )}
    </>
  );
}
