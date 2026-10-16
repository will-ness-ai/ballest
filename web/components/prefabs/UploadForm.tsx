"use client";
// /prefabs/new, the upload form (grill-design round 3, E · Form + card): the file and its
// fields on the left; the 3D preview and the gallery card it will make on the right, where
// the uploader turns the preview to the view the card is drawn from (its angle). The
// file is checked the moment it's chosen (lib/prefab-check.ts), and again by the server.
// Signed out, banned or at the daily limit, a note takes the form's place.
import { useEffect, useRef, useState } from "react";

import { Card } from "./PrefabGallery";
import { PrefabViewer, useAngleReader } from "./PrefabViewer";
import { stillOf } from "./scene";
import type { PrefabFile } from "../../lib/prefab";
import { checkPrefab, fileNameOf, type Check } from "../../lib/prefab-check";
import {
  DESCRIPTION_MAX,
  MAX_TAGS,
  NAME_MAX,
  NO_UPLOADS,
  TAGS,
  type PrefabAngle,
  type PrefabFields,
  type UploadQuota,
} from "../../lib/prefabs";
import { newPrefabHref, prefabHref, prefabsApiHref, signInHref } from "../../lib/routes";

interface Chosen {
  fileName: string;
  text: string;
  check: Check;
  file: PrefabFile | null;
}

/* a still of the preview for the admin's upload ping, or null: none for a file so big the
   pair could pass Vercel's 4.5 MB request cap, or when the browser can't draw one */
async function previewStill(chosen: Chosen, angle: PrefabAngle | null): Promise<Blob | null> {
  if (!chosen.file || chosen.text.length > 3_000_000) return null;
  try {
    return await (await fetch(await stillOf(chosen.file, 800, 450, "#141a2b", angle))).blob();
  } catch {
    return null;
  }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export function UploadForm() {
  const [quota, setQuota] = useState<UploadQuota | null>(null);
  useEffect(() => {
    void fetch(prefabsApiHref(), { cache: "no-store" })
      .then((r) => r.json() as Promise<UploadQuota>)
      .then(setQuota)
      .catch(() => setQuota(NO_UPLOADS));
  }, []);
  return (
    <section className="pfu">
      <header className="pfl-head">
        <div>
          <h1>Upload a prefab</h1>
          <p>Share a prefab you saved in the level editor. It goes live as soon as you publish.</p>
        </div>
      </header>
      {!quota ? null : !quota.signedIn ? (
        <div className="pfu-gate">
          <p>Sign in with Steam to upload. Your prefab is credited to your Steam name.</p>
          <a className="pf-dl" href={signInHref(newPrefabHref())}>
            Sign in with Steam
          </a>
        </div>
      ) : quota.banned ? (
        <div className="pfu-gate">
          <p>You can&apos;t upload prefabs.</p>
        </div>
      ) : !quota.left ? (
        <Limit limit={quota.limit} nextAt={quota.nextAt} />
      ) : (
        <Form
          left={quota.left}
          limit={quota.limit}
          onLimit={(limit, nextAt) => setQuota({ ...quota, left: 0, limit, nextAt })}
        />
      )}
    </section>
  );
}

function Limit({ limit, nextAt }: { limit: number; nextAt: string | null }) {
  return (
    <div className="pfu-gate">
      <p>
        You&apos;ve reached your daily limit of {limit} prefabs.
        {nextAt ? ` You can upload again from ${when(nextAt)}.` : " You can upload again tomorrow."}
      </p>
    </div>
  );
}

function Form({
  left,
  limit,
  onLimit,
}: {
  left: number;
  limit: number;
  onLimit: (limit: number, nextAt: string | null) => void;
}) {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [fields, setFields] = useState<PrefabFields>({ name: "", description: "", tags: [] });
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<Array<string>>([]);
  const [angle, setAngle] = useState<PrefabAngle | null>(null);

  const take = (fileName: string, text: string) => {
    const check = checkPrefab(text);
    /* an angle is relative to the file's bounds, so a new file starts from the default */
    setAngle(null);
    setChosen({
      fileName,
      text,
      check,
      file: check.ok ? (JSON.parse(text) as PrefabFile) : null,
    });
    setRefused([]);
    if (!fields.name) {
      const stem = fileName
        .replace(/\.json$/i, "")
        .replace(/[_-]+/g, " ")
        .trim();
      const name = (stem.charAt(0).toUpperCase() + stem.slice(1)).slice(0, NAME_MAX);
      setFields((f) => ({ ...f, name }));
    }
  };

  const ready = !!chosen?.check.ok && fields.name.trim().length > 0 && !sending;
  const publish = async () => {
    if (!chosen || !ready) return;
    setSending(true);
    const body = new FormData();
    body.set("name", fields.name);
    body.set("description", fields.description);
    for (const t of fields.tags) body.append("tags", t);
    body.set("file", new Blob([chosen.text], { type: "application/json" }), chosen.fileName);
    if (angle) body.set("angle", JSON.stringify(angle));
    const picture = await previewStill(chosen, angle);
    if (picture) body.set("picture", picture, "prefab.png");
    try {
      const r = await fetch(prefabsApiHref(), { method: "POST", body });
      const got = (await r.json()) as {
        slug?: string;
        problems?: Array<string>;
        limit?: number;
        nextAt?: string;
      };
      /* a full load, so the router's cached gallery doesn't miss it on the way back */
      if (r.status === 201 && got.slug) return location.assign(prefabHref(got.slug));
      if (r.status === 429) return onLimit(got.limit ?? limit, got.nextAt ?? null);
      setRefused(got.problems ?? ["That didn't upload. Try again in a moment."]);
    } catch {
      setRefused(["That didn't upload. Try again in a moment."]);
    }
    setSending(false);
  };

  const problems = chosen && !chosen.check.ok ? chosen.check.problems : refused;
  return (
    <div className="pfu-split">
      <div className="pfu-col">
        <Drop chosen={chosen} take={take} />
        {problems.length > 0 && (
          <div className="pfu-bad" role="alert">
            <b>This prefab can&apos;t be uploaded:</b>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        <Fields value={fields} onChange={setFields} />
        <div className="pfu-publish">
          <button
            type="button"
            className="pf-dl big"
            disabled={!ready}
            onClick={() => void publish()}
          >
            {sending ? "Publishing…" : "Publish"}
          </button>
          <small>
            {left} of {limit} uploads left today · goes live at once, credited to your Steam name
          </small>
        </div>
      </div>
      <div className="pfu-col">
        <h2 className="pfu-h2">How it&apos;ll look</h2>
        {chosen?.file ? (
          <AnglePicker
            key={chosen.fileName + String(chosen.text.length)}
            file={chosen.file}
            angle={angle}
            onPick={setAngle}
          />
        ) : (
          <div className="pf-vwrap pfu-tall">
            <div className="pfv pfu-empty">The 3D preview appears here</div>
          </div>
        )}
        {chosen?.file && (
          <div className="pfu-card">
            <Card
              p={{
                slug: "",
                name: fields.name.trim() || "Your prefab",
                favorites: 0,
                uploader: { steamId: "", name: "you", isPlayer: false },
                pieces: chosen.file.items.length,
                angle,
              }}
              file={chosen.file}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* the preview, still so the uploader can turn it to the view they want, and the buttons that
   make that view the card's (its angle) or go back to the default; the page's viewer starts
   from it too */
function AnglePicker({
  file,
  angle,
  onPick,
}: {
  file: PrefabFile;
  angle: PrefabAngle | null;
  onPick: (angle: PrefabAngle | null) => void;
}) {
  const { onGrab, angleNow } = useAngleReader();
  return (
    <div className="pf-vwrap pfu-tall">
      <PrefabViewer file={file} spin={false} angle={angle} onGrab={onGrab} />
      <div className="pf-tools">
        <span className="pf-hint">Turn it to the view you want on the card</span>
        <span className="pf-tools-end">
          {angle && (
            <button type="button" onClick={() => onPick(null)}>
              Default view
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              const a = angleNow();
              if (a) onPick(a);
            }}
          >
            Use this view
          </button>
        </span>
      </div>
    </div>
  );
}

function Drop({
  chosen,
  take,
}: {
  chosen: Chosen | null;
  take: (fileName: string, text: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const read = (f: File | undefined) => {
    if (f) void f.text().then((t) => take(f.name, t));
  };
  return (
    <label
      className={
        "pfu-drop" + (over ? " over" : "") + (chosen ? (chosen.check.ok ? " ok" : " bad") : "")
      }
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        read(e.dataTransfer.files[0]);
      }}
    >
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => read(e.target.files?.[0])}
      />
      {chosen ? (
        <span>
          <b>{chosen.fileName}</b>
          {chosen.check.ok ? ` · ${String(chosen.check.pieces)} pieces, ready` : " · can't be used"}
          <span className="pfu-change">Choose another</span>
        </span>
      ) : (
        <span>
          <b>Drop your prefab here</b> or choose a file
          <small>From %LOCALAPPDATA%\Ballest\Saved\SaveGames\Prefabs · .json, up to 4 MB</small>
        </span>
      )}
    </label>
  );
}

/* a Prefab's name, description and tags, as uploading and editing both ask for them */
export function Fields({
  value: f,
  onChange,
}: {
  value: PrefabFields;
  onChange: (v: PrefabFields) => void;
}) {
  const toggle = (t: string) =>
    onChange({
      ...f,
      tags: f.tags.includes(t)
        ? f.tags.filter((x) => x !== t)
        : f.tags.length < MAX_TAGS
          ? [...f.tags, t]
          : f.tags,
    });
  return (
    <div className="pfu-fields">
      <label>
        <span>Name</span>
        <input
          value={f.name}
          maxLength={NAME_MAX}
          required
          onChange={(e) => onChange({ ...f, name: e.target.value })}
          placeholder="Park bench"
        />
        <small>Downloads as {fileNameOf(f.name || "prefab")}</small>
      </label>
      <label>
        <span>
          Description <i>optional</i>
        </span>
        <textarea
          value={f.description}
          maxLength={DESCRIPTION_MAX}
          rows={3}
          onChange={(e) => onChange({ ...f, description: e.target.value })}
          placeholder="What it is and where it fits in a map"
        />
        <small>{DESCRIPTION_MAX - f.description.length} left</small>
      </label>
      <fieldset>
        <legend>Tags, up to {MAX_TAGS}</legend>
        <div className="pfl-tags">
          {TAGS.map((t) => (
            <button
              key={t}
              type="button"
              className={"pfl-tag" + (f.tags.includes(t) ? " on" : "")}
              aria-pressed={f.tags.includes(t)}
              onClick={() => toggle(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </fieldset>
    </div>
  );
}
