"use client";
// /prefabs/new, the upload form (grill-design round 3, E · Form + card): the file and its
// fields on the left; the 3D preview and the gallery card it will make on the right. The
// file is checked the moment it's chosen (lib/prefab-check.ts), and again by the server.
// Signed out, banned or at the daily limit, a note takes the form's place.
import { useEffect, useRef, useState } from "react";

import { Card } from "./PrefabGallery";
import { PrefabViewer } from "./PrefabViewer";
import type { PrefabFile } from "../../lib/prefab";
import { checkPrefab, fileNameOf, type Check } from "../../lib/prefab-check";
import { DAILY_UPLOADS, DESCRIPTION_MAX, MAX_TAGS, NAME_MAX, TAGS } from "../../lib/prefabs";
import { newPrefabHref, prefabHref, signInHref } from "../../lib/routes";

interface Quota {
  signedIn: boolean;
  banned: boolean;
  left: number;
  nextAt: string | null;
}

interface Chosen {
  fileName: string;
  text: string;
  check: Check;
  file: PrefabFile | null;
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

export function UploadForm() {
  const [quota, setQuota] = useState<Quota | null>(null);
  useEffect(() => {
    void fetch("/api/prefabs", { cache: "no-store" })
      .then((r) => r.json() as Promise<Quota>)
      .then(setQuota)
      .catch(() => setQuota({ signedIn: false, banned: false, left: 0, nextAt: null }));
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
        <Limit nextAt={quota.nextAt} />
      ) : (
        <Form left={quota.left} onLimit={(nextAt) => setQuota({ ...quota, left: 0, nextAt })} />
      )}
    </section>
  );
}

function Limit({ nextAt }: { nextAt: string | null }) {
  return (
    <div className="pfu-gate">
      <p>
        You&apos;ve uploaded {DAILY_UPLOADS} prefabs today, the daily limit.
        {nextAt ? ` You can upload again from ${when(nextAt)}.` : " You can upload again tomorrow."}
      </p>
    </div>
  );
}

function Form({ left, onLimit }: { left: number; onLimit: (nextAt: string | null) => void }) {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<Array<string>>([]);
  const [sending, setSending] = useState(false);
  const [refused, setRefused] = useState<Array<string>>([]);

  const take = (fileName: string, text: string) => {
    const check = checkPrefab(text);
    setChosen({
      fileName,
      text,
      check,
      file: check.ok ? (JSON.parse(text) as PrefabFile) : null,
    });
    setRefused([]);
    if (!name) {
      const stem = fileName
        .replace(/\.json$/i, "")
        .replace(/[_-]+/g, " ")
        .trim();
      setName((stem.charAt(0).toUpperCase() + stem.slice(1)).slice(0, NAME_MAX));
    }
  };

  const ready = !!chosen?.check.ok && name.trim().length > 0 && !sending;
  const publish = async () => {
    if (!chosen || !ready) return;
    setSending(true);
    const body = new FormData();
    body.set("name", name);
    body.set("description", description);
    for (const t of tags) body.append("tags", t);
    body.set("file", new Blob([chosen.text], { type: "application/json" }), chosen.fileName);
    try {
      const r = await fetch("/api/prefabs", { method: "POST", body });
      const got = (await r.json()) as { slug?: string; problems?: Array<string>; nextAt?: string };
      /* a full load, so the router's cached gallery doesn't miss it on the way back */
      if (r.status === 201 && got.slug) return location.assign(prefabHref(got.slug));
      if (r.status === 429) return onLimit(got.nextAt ?? null);
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
        <Fields
          name={name}
          setName={setName}
          description={description}
          setDescription={setDescription}
          tags={tags}
          setTags={setTags}
        />
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
            {left} of {DAILY_UPLOADS} uploads left today · goes live at once, credited to your Steam
            name
          </small>
        </div>
      </div>
      <div className="pfu-col">
        <h2 className="pfu-h2">How it&apos;ll look</h2>
        <div className="pf-vwrap pfu-tall">
          {chosen?.file ? (
            <PrefabViewer key={chosen.fileName + String(chosen.text.length)} file={chosen.file} />
          ) : (
            <div className="pfv pfu-empty">The 3D preview appears here</div>
          )}
        </div>
        {chosen?.file && (
          <div className="pfu-card">
            <Card
              p={{
                slug: "",
                name: name.trim() || "Your prefab",
                favorites: 0,
                uploader: { steamId: "", name: "you", isPlayer: false },
                pieces: chosen.file.items.length,
              }}
              file={chosen.file}
            />
          </div>
        )}
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
export function Fields(f: {
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  tags: Array<string>;
  setTags: (v: Array<string>) => void;
}) {
  const toggle = (t: string) =>
    f.setTags(
      f.tags.includes(t)
        ? f.tags.filter((x) => x !== t)
        : f.tags.length < MAX_TAGS
          ? [...f.tags, t]
          : f.tags,
    );
  return (
    <div className="pfu-fields">
      <label>
        <span>Name</span>
        <input
          value={f.name}
          maxLength={NAME_MAX}
          required
          onChange={(e) => f.setName(e.target.value)}
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
          onChange={(e) => f.setDescription(e.target.value)}
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
