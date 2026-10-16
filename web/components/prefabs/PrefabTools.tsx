"use client";
// What the signed-in reader may do to a Prefab beyond viewing it: its uploader can edit its
// name, description and tags, or delete it (db/prefab-api.ts editPrefab); the admin can take
// it down, or ban its uploader, which hides all their Prefabs, and lift the ban from a
// hidden one's page, or give its uploader their own hourly upload limit. Nobody else sees these.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Fields } from "./UploadForm";
import type { PrefabPage } from "../../db/data";
import { useSession } from "../../hooks/me";
import {
  ADMIN_STEAM_ID,
  HOURLY_UPLOADS,
  MAX_HOURLY_UPLOADS,
  type PrefabFields,
  type UploaderLimit,
} from "../../lib/prefabs";
import {
  prefabApiHref,
  prefabBanHref,
  prefabLimitHref,
  prefabTakeDownHref,
  prefabsHref,
  adminActionOf,
} from "../../lib/routes";

export function PrefabTools({ p }: { p: PrefabPage }) {
  const me = useSession();
  if (!me) return null;
  return (
    <>
      {p.state === "live" && me === p.uploader.steamId && <OwnerTools p={p} />}
      {me === ADMIN_STEAM_ID && <AdminTools p={p} />}
    </>
  );
}

function AdminTools({ p }: { p: PrefabPage }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const who = p.uploader.steamId;
  const ban = prefabBanHref(who);
  const act = async (url: string, method: string, ask: string) => {
    if (!confirm(ask)) return;
    setBusy(true);
    const r = await fetch(url, { method }).catch(() => null);
    if (r?.ok) location.reload();
    else {
      setFailed(true);
      setBusy(false);
    }
  };
  const live = p.state === "live";
  const canBan = ban !== null && live && who !== ADMIN_STEAM_ID;
  const takeDown = () =>
    void act(prefabTakeDownHref(p.slug), "POST", `Take ${p.name} down for good?`);
  const banUploader = () => {
    if (ban)
      void act(
        ban,
        "PUT",
        `Ban ${p.uploader.name} from uploading? Every prefab they uploaded is hidden until you unban them.`,
      );
  };
  /* the upload ping's Take down and Ban buttons land here with ?admin=, which opens that
     confirm once the page has drawn, and leaves the address clean */
  useEffect(() => {
    const want = adminActionOf(location.search);
    if (!want) return;
    const t = setTimeout(() => {
      history.replaceState(null, "", location.pathname);
      if (want === "take-down" && live) takeDown();
      if (want === "ban" && canBan) banUploader();
    }, 300);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, on arrival
  return (
    <div className="pf-admin">
      <b>Admin</b>
      {live && (
        <button type="button" disabled={busy} onClick={takeDown}>
          Take down
        </button>
      )}
      {canBan && (
        <button type="button" disabled={busy} onClick={banUploader}>
          Ban {p.uploader.name} from uploading
        </button>
      )}
      {ban && p.state === "hidden" && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(ban, "DELETE", `Unban ${p.uploader.name}? Their prefabs come back.`)
          }
        >
          Unban {p.uploader.name}
        </button>
      )}
      <UploadLimit who={who} name={p.uploader.name} />
      {failed && <span>That didn&apos;t work. Try again.</span>}
    </div>
  );
}

/* the uploader's hourly upload limit, which the admin can change or put back to the default */
function UploadLimit({ who, name }: { who: string; name: string }) {
  const url = prefabLimitHref(who);
  const [limit, setLimit] = useState<UploaderLimit | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (url)
      void fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<UploaderLimit>) : null))
        .then(setLimit)
        .catch(() => null);
  }, [url]);
  if (!url || !limit) return null;
  const change = async () => {
    const typed = prompt(
      `Uploads an hour for ${name}? Leave it empty for the default, ${String(HOURLY_UPLOADS)}.`,
      String(limit.perHour),
    );
    if (typed === null) return;
    const perHour = Number(typed.trim());
    const r = await fetch(url, {
      method: typed.trim() ? "PUT" : "DELETE",
      headers: { "content-type": "application/json" },
      body: typed.trim() ? JSON.stringify({ perHour }) : undefined,
    }).catch(() => null);
    setFailed(!r?.ok);
    if (r?.ok) setLimit((await r.json()) as UploaderLimit);
  };
  return (
    <>
      <button type="button" onClick={() => void change()}>
        {limit.perHour} uploads an hour{limit.own ? "" : " (default)"}
      </button>
      {failed && (
        <span>That didn&apos;t save. Use a whole number from 1 to {MAX_HOURLY_UPLOADS}.</span>
      )}
    </>
  );
}

function OwnerTools({ p }: { p: PrefabPage }) {
  const router = useRouter();
  const edit = useRef<HTMLDialogElement>(null);
  const del = useRef<HTMLDialogElement>(null);
  const [fields, setFields] = useState<PrefabFields>({
    name: p.name,
    description: p.description,
    tags: p.tags,
  });
  const [problems, setProblems] = useState<Array<string>>([]);
  const [busy, setBusy] = useState(false);
  const url = prefabApiHref(p.slug);

  const send = async (method: "PATCH" | "DELETE") => {
    setBusy(true);
    setProblems([]);
    try {
      const r = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "PATCH" ? JSON.stringify(fields) : undefined,
      });
      if (r.ok) {
        /* a full load: the router's cached gallery would still show it */
        if (method === "DELETE") location.assign(prefabsHref());
        else {
          edit.current?.close();
          router.refresh();
        }
      } else {
        const got = (await r.json()) as { problems?: Array<string> };
        setProblems(got.problems ?? ["That didn't save. Try again in a moment."]);
      }
    } catch {
      setProblems(["That didn't save. Try again in a moment."]);
    }
    setBusy(false);
  };

  return (
    <div className="pf-own">
      <button type="button" onClick={() => edit.current?.showModal()}>
        Edit
      </button>
      <button type="button" onClick={() => del.current?.showModal()}>
        Delete
      </button>
      <dialog ref={edit} className="pf-dialog">
        <h2>Edit {p.name}</h2>
        <Fields value={fields} onChange={setFields} />
        {problems.length > 0 && (
          <ul className="pfu-bad" role="alert">
            {problems.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        )}
        <div className="pf-dlg-row">
          <button type="button" onClick={() => edit.current?.close()}>
            Cancel
          </button>
          <button
            type="button"
            className="pf-dl"
            disabled={busy || !fields.name.trim()}
            onClick={() => void send("PATCH")}
          >
            Save
          </button>
        </div>
      </dialog>
      <dialog ref={del} className="pf-dialog">
        <h2>Delete {p.name}?</h2>
        <p>
          It leaves the gallery and its link stops working. It still counts toward this hour&apos;s
          uploads.
        </p>
        <div className="pf-dlg-row">
          <button type="button" onClick={() => del.current?.close()}>
            Keep it
          </button>
          <button
            type="button"
            className="pf-danger"
            disabled={busy}
            onClick={() => void send("DELETE")}
          >
            Delete
          </button>
        </div>
      </dialog>
    </div>
  );
}
