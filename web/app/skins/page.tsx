// PROTOTYPE /skins: every ball skin the game ships, as read from a replay's skinMaterial,
// with the in-game shot the boards use and the game's own 64 px tile icon beside it.
import type { Metadata } from "next";

import { Shell } from "../../components/Shell";
import { SKINS } from "../../lib/proto-skins";

export const metadata: Metadata = { title: "Ball skins (prototype)" };

export default function Page() {
  const groups = Object.groupBy(Object.entries(SKINS), ([, s]) => s.group);
  return (
    <Shell view="maps">
      <section className="skins-proto">
        <h1>Ball skins</h1>
        <p>
          Prototype. Each run&apos;s ghost names the ball it was rolled with; the boards for 26 maps
          show it for the top 50 as of October 4. Left: the ball in game. Right: the game&apos;s own
          tile icon.
        </p>
        {Object.entries(groups).map(([group, list]) => (
          <div key={group}>
            <h2>{group}</h2>
            <ul>
              {(list ?? []).map(([asset, s]) => (
                <li key={asset} title={s.note ?? undefined}>
                  <img src={`/skins/${asset}.webp`} alt="" width={64} height={64} />
                  <img src={`/skins/icons/${asset}.png`} alt="" width={32} height={32} />
                  <span>
                    {s.name}
                    {s.note && <small>{s.note}</small>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </Shell>
  );
}
