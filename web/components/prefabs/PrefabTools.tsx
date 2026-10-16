"use client";
// What the signed-in reader may do to a Prefab beyond viewing it: its uploader can edit its
// name, description and tags, or delete it (db/prefab-api.ts editPrefab). Nobody else sees
// these.
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Fields } from "./UploadForm";
import type { PrefabPage } from "../../db/data";
import { useSession } from "../../hooks/me";
import { prefabsHref } from "../../lib/routes";

export function PrefabTools({ p }: { p: PrefabPage }) {
  const me = useSession();
  if (!me || p.state !== "live" || me !== p.uploader.steamId) return null;
  return <OwnerTools p={p} />;
}

function OwnerTools({ p }: { p: PrefabPage }) {
  const router = useRouter();
  const edit = useRef<HTMLDialogElement>(null);
  const del = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(p.name);
  const [description, setDescription] = useState(p.description);
  const [tags, setTags] = useState(p.tags);
  const [problems, setProblems] = useState<Array<string>>([]);
  const [busy, setBusy] = useState(false);
  const url = `/api/prefabs/${p.slug}`;

  const send = async (method: "PATCH" | "DELETE") => {
    setBusy(true);
    setProblems([]);
    try {
      const r = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "PATCH" ? JSON.stringify({ name, description, tags }) : undefined,
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
        <Fields
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          tags={tags}
          setTags={setTags}
        />
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
            disabled={busy || !name.trim()}
            onClick={() => void send("PATCH")}
          >
            Save
          </button>
        </div>
      </dialog>
      <dialog ref={del} className="pf-dialog">
        <h2>Delete {p.name}?</h2>
        <p>
          It leaves the gallery and its link stops working. It still counts toward today&apos;s
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
