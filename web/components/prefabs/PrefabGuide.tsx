// How to, in the Prefabs Section: saving pieces of a map as a Prefab, spawning one, what comes
// out (one group), sharing one here, and Decals. Written from what players asked in the game's
// Discord, each step checked against the game.
import Link from "next/link";

import { Code } from "./HowTo";
import { DELETE, FOLDER, LIST, SAVE, SPAWN } from "../../lib/prefab-console";
import { HOURLY_UPLOADS } from "../../lib/prefabs";
import { makePrefabHref, newPrefabHref, prefabsHref } from "../../lib/routes";

export function PrefabGuide() {
  return (
    <section className="pfl">
      <header className="pfl-head">
        <p>
          How to save pieces of your map as a prefab, spawn one into another map, and share it here.
        </p>
      </header>
      <div className="pfg">
        <section>
          <h2 className="pfu-h2">Save a prefab</h2>
          <ol className="pf-steps">
            <li>
              <b>Select the pieces</b> in the level editor: hold <kbd>Shift</kbd> and click each
              one. They don&apos;t need to be grouped, and a group you select counts too.
            </li>
            <li>
              <b>Open the console</b> while they&apos;re still selected: press <kbd>`</kbd>, the key
              under <kbd>Esc</kbd> (<kbd>~</kbd> on some keyboards).
            </li>
            <li>
              <b>Type the command</b>, a space and a name, then press <kbd>Enter</kbd>:
              <Code text={SAVE + " my_prefab"} />
              As you type, the console lists the commands that match, and <kbd>↑</kbd> <kbd>↓</kbd>{" "}
              fill one in; the name you type yourself. It&apos;s up to 64 letters, digits,{" "}
              <code>_</code> or <code>-</code>, with no spaces.
            </li>
            <li>
              <b>It&apos;s saved</b> as <code>my_prefab.json</code> in your Prefabs folder. Paste
              this into File Explorer&apos;s address bar to open it:
              <Code text={FOLDER} />
            </li>
          </ol>
          <p className="pfg-note">
            A prefab holds 2 to 4096 pieces, and can&apos;t include the start. Saving over a name
            you already used asks you to run the command again with <code>confirm</code> on the end.
          </p>
        </section>
        <section>
          <h2 className="pfu-h2">Spawn a prefab</h2>
          <ol className="pf-steps">
            <li>
              <b>Get the file</b>: download one from <Link href={prefabsHref()}>Shared</Link> or{" "}
              <Link href={makePrefabHref()}>Make your own</Link>, or save your own.
            </li>
            <li>
              <b>Put it in</b> the same Prefabs folder, as a <code>.json</code> file.
            </li>
            <li>
              <b>In the level editor</b>, open the console and type the command and the file&apos;s
              name without <code>.json</code>:
              <Code text={SPAWN + " my_prefab"} />
              It appears in front of the camera, selected, and one Undo takes it away again.
            </li>
          </ol>
          <p className="pfg-note">
            <code>{LIST}</code> lists every prefab in the folder, and <code>{DELETE}</code> with a
            name deletes one file. Pieces already in your map stay.
          </p>
        </section>
        <section>
          <h2 className="pfu-h2">One group or many pieces?</h2>
          <p>
            A prefab spawns as one group of all its pieces, so clicking any of them selects the
            whole prefab. The editor has no groups inside groups, so even a prefab saved from many
            groups comes back as one. To use only some of it, ungroup it, take the pieces you want,
            and group them again if you like.
          </p>
          <p className="pfg-note">
            For a set like letters or numbers, spawn it once at the side of your map, ungroup it
            there, and copy the pieces you need from it.
          </p>
        </section>
        <section>
          <h2 className="pfu-h2">Share it here</h2>
          <ol className="pf-steps">
            <li>
              <b>
                Press <Link href={newPrefabHref()}>Upload</Link>
              </b>{" "}
              at the top of Prefabs and sign in with Steam.
            </li>
            <li>
              <b>Choose the file</b> from your Prefabs folder. The site checks it the way the game
              does and shows how it&apos;ll look.
            </li>
            <li>
              <b>Name it</b>, add a description and tags, pick the angle its picture is drawn from,
              and press Publish. It&apos;s live at once.
            </li>
          </ol>
          <p className="pfg-note">
            Most players can upload {HOURLY_UPLOADS} an hour, and edit or delete yours from its
            page.
          </p>
        </section>
        <section>
          <h2 className="pfu-h2">Decals</h2>
          <p>
            Scratch marks, arrows and stripes are all one piece, the decal, in Decals, the last
            section of the parts list. Place it where you want it, then pick its Style in the pencil
            tab: Scratch marks, Arrow or Stripes. Its width, height and depth are set there too.
          </p>
        </section>
      </div>
    </section>
  );
}
