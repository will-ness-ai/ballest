"use client";
/* ==========================================================================
   PROTOTYPE (grill-design round 3, claude/prototype-prefabs): five shapes for
   uploading a Prefab at /prefabs/new, chosen by ?variant=, with ?state= for an
   empty form, a good file, a bad file, signed out and the daily limit reached.
   Publishing does nothing here. Never merged.
   ========================================================================== */
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { TAGS } from "./PrefabGallery";
import { PrefabViewer } from "./PrefabViewer";
import { Picker } from "./Picker";
import type { PrefabFile } from "../../lib/prefab";
import { checkPrefab, fileNameOf, type Check } from "../../lib/prefab-check";

const VARIANTS = [
  ["A", "One form", "Drop zone, then the 3D preview, then the fields and Publish, top to bottom"],
  ["B", "Two steps", "Step 1 checks and previews the file; step 2 names and tags it"],
  ["C", "Edit in place", "The finished prefab page, with its name and description typed in place"],
  ["D", "Dialog", "An Upload dialog over the gallery: drop, fill in, publish"],
  [
    "E",
    "Form + card",
    "Fields on the left, the gallery card and 3D preview it'll make on the right",
  ],
] as const;
const STATES = [
  ["empty", "Empty"],
  ["valid", "Good file"],
  ["invalid", "Bad file"],
  ["signedout", "Signed out"],
  ["limit", "Limit hit"],
] as const;
const LEFT = 3;

const BAD = JSON.stringify({
  format: "BallestPrefab",
  version: 1,
  group: { rotation: [0, 0, 0], scale: [1, 1, 1] },
  items: [
    { class: "/Game/x/MP_PlayerStart.MP_PlayerStart_C" },
    { class: "/Game/x/BP_Prim_Cube.BP_Prim_Cube_C" },
    { class: "/Game/x/BP_Lasers.BP_Lasers_C" },
  ],
});

interface Draft {
  fileName: string | null;
  check: Check | null;
  file: PrefabFile | null;
  name: string;
  description: string;
  tags: Array<string>;
}

function useDraft(state: string) {
  const [d, setD] = useState<Draft>({
    fileName: null,
    check: null,
    file: null,
    name: "",
    description: "",
    tags: [],
  });
  const take = (fileName: string, text: string) => {
    const check = checkPrefab(text);
    const stem = fileName.replace(/\.json$/i, "").replace(/[_-]+/g, " ");
    setD((o) => ({
      ...o,
      fileName,
      check,
      file: check.ok ? (JSON.parse(text) as PrefabFile) : null,
      name: o.name || stem.charAt(0).toUpperCase() + stem.slice(1),
    }));
  };
  useEffect(() => {
    if (state === "valid")
      void fetch("/prefabs/samples/bench.json")
        .then((r) => r.text())
        .then((t) => take("bench.json", t));
    if (state === "invalid") take("my_track_bit.json", BAD);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per state
  }, [state]);
  return { d, setD, take };
}
type DraftApi = ReturnType<typeof useDraft>;

export function UploadPrototype() {
  const params = useSearchParams();
  const variant = VARIANTS.find((v) => v[0] === params.get("variant"))?.[0] ?? "A";
  const state = STATES.find((s) => s[0] === params.get("state"))?.[0] ?? "empty";
  const api = useDraft(state);
  const gate = state === "signedout" ? <SignedOut /> : state === "limit" ? <Limit /> : null;
  return (
    <>
      <section className={"pfu pfu-" + variant}>
        {variant !== "D" && variant !== "C" && (
          <header className="pfl-head">
            <h1>Upload a prefab</h1>
            <p>
              Share a prefab you saved in the level editor. It goes live as soon as you publish.
            </p>
          </header>
        )}
        {gate ??
          (variant === "A" ? (
            <OneForm {...api} />
          ) : variant === "B" ? (
            <TwoSteps {...api} />
          ) : variant === "C" ? (
            <InPlace {...api} />
          ) : variant === "D" ? (
            <InDialog {...api} />
          ) : (
            <FormCard {...api} />
          ))}
      </section>
      <Picker variants={VARIANTS} variant={variant} states={STATES} state={state} />
    </>
  );
}

function SignedOut() {
  return (
    <div className="pfu-gate">
      <p>Sign in with Steam to upload. Your prefab is credited to your Steam name.</p>
      <a className="pf-dl" href="#">
        Sign in with Steam
      </a>
    </div>
  );
}

function Limit() {
  return (
    <div className="pfu-gate">
      <p>You&apos;ve uploaded 5 prefabs today, the daily limit. You can upload again tomorrow.</p>
    </div>
  );
}

function Drop({ d, take, compact }: DraftApi & { compact?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const read = (f: File | undefined) => f && void f.text().then((t) => take(f.name, t));
  return (
    <label
      className={
        "pfu-drop" +
        (over ? " over" : "") +
        (compact ? " compact" : "") +
        (d.check ? (d.check.ok ? " ok" : " bad") : "")
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
      {d.fileName ? (
        <span>
          <b>{d.fileName}</b>
          {d.check?.ok ? ` · ${d.check.pieces} pieces, ready` : " · can't be used"}
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

function Problems({ d }: { d: Draft }) {
  if (!d.check || d.check.ok) return null;
  return (
    <div className="pfu-bad" role="alert">
      <b>This file can&apos;t be uploaded:</b>
      <ul>
        {d.check.problems.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

function Fields({ d, setD, tagsOnly }: DraftApi & { tagsOnly?: boolean }) {
  const toggle = (t: string) =>
    setD((o) => ({
      ...o,
      tags: o.tags.includes(t)
        ? o.tags.filter((x) => x !== t)
        : o.tags.length < 3
          ? [...o.tags, t]
          : o.tags,
    }));
  const tags = (
    <div className="pfl-tags">
      {TAGS.map((t) => (
        <button
          key={t}
          type="button"
          className={"pfl-tag" + (d.tags.includes(t) ? " on" : "")}
          aria-pressed={d.tags.includes(t)}
          onClick={() => toggle(t)}
        >
          {t}
        </button>
      ))}
    </div>
  );
  if (tagsOnly) return tags;
  return (
    <div className="pfu-fields">
      <label>
        <span>Name</span>
        <input
          value={d.name}
          maxLength={64}
          onChange={(e) => setD((o) => ({ ...o, name: e.target.value }))}
          placeholder="Park bench"
        />
        <small>Downloads as {fileNameOf(d.name || "prefab")}</small>
      </label>
      <label>
        <span>
          Description <i>optional</i>
        </span>
        <textarea
          value={d.description}
          maxLength={500}
          rows={3}
          onChange={(e) => setD((o) => ({ ...o, description: e.target.value }))}
          placeholder="What it is and where it fits in a map"
        />
        <small>{500 - d.description.length} left</small>
      </label>
      <fieldset>
        <legend>Tags, up to 3</legend>
        {tags}
      </fieldset>
    </div>
  );
}

function Publish({ d }: { d: Draft }) {
  const ready = !!d.check?.ok && d.name.trim().length > 0;
  return (
    <div className="pfu-publish">
      <button
        type="button"
        className="pf-dl big"
        disabled={!ready}
        onClick={() => alert("Prototype: nothing is uploaded.")}
      >
        Publish
      </button>
      <small>{LEFT} of 5 uploads left today · goes live at once, credited to your Steam name</small>
    </div>
  );
}

function Preview({ d, tall }: { d: Draft; tall?: boolean }) {
  return (
    <div className={"pf-vwrap" + (tall ? " pfu-tall" : "")}>
      {d.file ? (
        <PrefabViewer key={d.fileName} file={d.file} />
      ) : (
        <div className="pfv pfu-empty">The 3D preview appears here</div>
      )}
    </div>
  );
}

/* A · One form */
function OneForm(api: DraftApi) {
  return (
    <div className="pfu-col">
      <Drop {...api} />
      <Problems d={api.d} />
      {api.d.file && <Preview d={api.d} />}
      <Fields {...api} />
      <Publish d={api.d} />
    </div>
  );
}

/* B · Two steps */
function TwoSteps(api: DraftApi) {
  const [step, setStep] = useState(1);
  return (
    <div className="pfu-col">
      <ol className="pfu-stepper">
        <li className={step === 1 ? "on" : ""}>1 · File</li>
        <li className={step === 2 ? "on" : ""}>2 · Details</li>
      </ol>
      {step === 1 ? (
        <>
          <Drop {...api} />
          <Problems d={api.d} />
          {api.d.file && <Preview d={api.d} />}
          <button
            type="button"
            className="pf-dl"
            disabled={!api.d.check?.ok}
            onClick={() => setStep(2)}
          >
            Next: name it
          </button>
        </>
      ) : (
        <>
          <div className="pfu-mini">
            <div className="pf-vwrap">
              {api.d.file && <PrefabViewer file={api.d.file} controls={false} />}
            </div>
            <button type="button" className="pfl-more" onClick={() => setStep(1)}>
              Change file
            </button>
          </div>
          <Fields {...api} />
          <Publish d={api.d} />
        </>
      )}
    </div>
  );
}

/* C · Edit in place: the prefab page itself, with the text typed where it will show */
function InPlace(api: DraftApi) {
  const { d, setD } = api;
  return (
    <div className="pf pf-B">
      <p className="pf-kicker">New prefab · preview of its page</p>
      <div className="pf-split">
        <div className="pf-vwrap">
          {d.file ? (
            <PrefabViewer key={d.fileName} file={d.file} />
          ) : (
            <div className="pfv pfu-empty pfu-dropbig">
              <Drop {...api} />
            </div>
          )}
        </div>
        <aside className="pf-side">
          <input
            className="pfu-h1"
            value={d.name}
            maxLength={64}
            placeholder="Name your prefab"
            onChange={(e) => setD((o) => ({ ...o, name: e.target.value }))}
          />
          <p className="pf-by">by You · today</p>
          <textarea
            className="pfu-desc"
            rows={3}
            maxLength={500}
            value={d.description}
            placeholder="Add a description (optional)"
            onChange={(e) => setD((o) => ({ ...o, description: e.target.value }))}
          />
          <Problems d={d} />
          {d.file && <Drop {...api} compact />}
          <fieldset>
            <legend className="pf-h2">Tags, up to 3</legend>
            <Fields {...api} tagsOnly />
          </fieldset>
          <Publish d={d} />
        </aside>
      </div>
    </div>
  );
}

/* D · Dialog over the gallery */
function InDialog(api: DraftApi) {
  const dlg = useRef<HTMLDialogElement>(null);
  useEffect(() => dlg.current?.showModal(), []);
  return (
    <>
      <div className="pfl-head pfl-headrow">
        <div>
          <h1>Prefabs</h1>
          <p>(the gallery sits behind the dialog)</p>
        </div>
        <button type="button" className="pf-dl" onClick={() => dlg.current?.showModal()}>
          + Upload
        </button>
      </div>
      <dialog ref={dlg} className="pf-dialog pfu-dialog">
        <h2>Upload a prefab</h2>
        <div className="pfu-dgrid">
          <div className="pfu-col">
            <Drop {...api} />
            <Problems d={api.d} />
            {api.d.file && <Preview d={api.d} />}
          </div>
          <div className="pfu-col">
            <Fields {...api} />
            <Publish d={api.d} />
          </div>
        </div>
        <form method="dialog">
          <button className="pf-x">Cancel</button>
        </form>
      </dialog>
    </>
  );
}

/* E · Form + the card it makes */
function FormCard(api: DraftApi) {
  const { d } = api;
  return (
    <div className="pfu-split">
      <div className="pfu-col">
        <Drop {...api} />
        <Problems d={d} />
        <Fields {...api} />
        <Publish d={d} />
      </div>
      <div className="pfu-col">
        <p className="pf-h2">How it&apos;ll look</p>
        <Preview d={d} tall />
        <div className="pfl-card pfu-card">
          <span className="pfl-name">{d.name || "Your prefab"}</span>
          <span className="pfl-sub">
            by You · {d.check?.ok ? d.check.pieces : 0} pieces
            {d.tags.length ? " · " + d.tags.join(", ") : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
