// PROTOTYPE (never merge): grill-design round for the Weekly Cup Shortlist with each Map's
// spinning 3D GIF. Posts five variants as real Components V2 messages in the dev server's
// #cup-spins, as the Admin app. The GIFs are served from this branch on GitHub, so the round also
// shows that Discord plays a GIF given by URL (no upload).
// node post.mjs <channel id> [variant..]
const [channel, ...only] = process.argv.slice(2);
const token = process.env.ADMIN_DISCORD_TOKEN;
const RAW =
  "https://raw.githubusercontent.com/will-ness-ai/ballest/claude/prototype-cup-spins/prototype-cup-spins";
const maps = [
  [
    "3830006003",
    "SPOOKY Rooms",
    "Sparro",
    "1:12.400",
    "17424402659501177909/2D7F4E518735BEA1295426526416D7862D76A4A7",
  ],
  [
    "3809412387",
    "Mirror's Edge",
    "Native",
    "0:48.900",
    "13112414109816860958/A00041B184A3B8043B3EFE7677C1381C057F74A1",
  ],
  [
    "3816905581",
    "Spillway",
    "SMUG",
    "0:39.250",
    "16696061465371838120/1AA2B2CB80C5DD38167B3E2E61ADFE4585E77112",
  ],
  [
    "3811667347",
    "Amber Flux",
    "CoS",
    "1:03.100",
    "15872502188316799423/3C96F766CF5470AA287CE61332B2EF390CF32E41",
  ],
  [
    "3822560747",
    "Bevel Up",
    "stoxy999",
    "0:55.700",
    "17395578319743451575/6C5CBA7895E9CD2CDD42711309DD2D48BA90DBCE",
  ],
].map(([pfid, title, creator, author, ugc]) => ({
  pfid,
  title,
  creator,
  author,
  preview: `https://images.steamusercontent.com/ugc/${ugc}/`,
  gif: `${RAW}/${pfid}.gif`,
}));

const T = (content) => ({ type: 10, content });
const thumb = (url) => ({ type: 11, media: { url } });
const gallery = (...items) => ({
  type: 12,
  items: items.map((i) => (typeof i === "string" ? { media: { url: i } } : i)),
});
const section = (text, url) => ({ type: 9, components: [T(text)], accessory: thumb(url) });
const words = (m, i) =>
  `**${i + 1}. [${m.title}](https://ballestrecords.com/map/${m.pfid})**\nby ${m.creator} · author **${m.author}**`;
const intro = (extra = "") =>
  T(
    `## Shortlist · week of Mon 2 Nov${extra}\nVote for up to 3 by <t:1762527600:F>: the most-voted are the Cup Maps, a tie drawn at random. Only Entrants can vote, and voting again changes your pick.\n-# Prototype: 5 Maps here, 10 on the real Shortlist.`,
  );
const vote = {
  type: 1,
  components: [
    {
      type: 3,
      custom_id: `proto-vote-${Math.random()}`,
      placeholder: "Vote for up to 3 Maps",
      min_values: 1,
      max_values: 3,
      options: maps.map((m) => ({ label: m.title, value: m.pfid, description: `by ${m.creator}` })),
    },
  ],
};
const card = (components) => ({
  flags: 1 << 15,
  allowed_mentions: { parse: [] },
  components: [{ type: 17, accent_color: 0xf2c14e, components }],
});

const variants = {
  A: () => [card([intro(), ...maps.map((m, i) => section(words(m, i), m.gif)), vote])],
  B: () => [card([intro(), ...maps.flatMap((m, i) => [T(words(m, i)), gallery(m.gif)]), vote])],
  C: () => [
    card([intro(), ...maps.map((m, i) => section(words(m, i), m.preview)), vote]),
    card([
      T("### The Shortlist in 3D"),
      gallery(
        ...maps.map((m, i) => ({ media: { url: m.gif }, description: `${i + 1}. ${m.title}` })),
      ),
    ]),
  ],
  D: () => [
    card([intro()]),
    ...maps.map((m, i) => card([gallery(m.preview), section(words(m, i), m.gif)])),
    card([T("**Your vote**"), vote]),
  ],
  E: () => [
    card([intro(), ...maps.flatMap((m, i) => [T(words(m, i)), gallery(m.preview, m.gif)]), vote]),
  ],
};
const names = {
  A: "GIF as the thumbnail: the GIF takes the Workshop picture's place beside each Map",
  B: "Big GIFs: each Map's GIF full width under its name, no Workshop picture",
  C: "3D gallery after: the Shortlist as today, then a second message with every GIF in a grid",
  D: "One card per Map: Workshop picture big, GIF as its thumbnail (the Daily Post's look), the vote last",
  E: "Side by side: under each Map, its Workshop picture and its GIF next to each other",
};

const post = async (body) => {
  const r = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j)}`);
  return j.id;
};

const guild = process.env.DISCORD_GUILD_ID;
await post({
  content: "# Round 1 · Where do the 3D GIFs go on the Weekly Cup Shortlist?",
  allowed_mentions: { parse: [] },
});
for (const key of only.length ? only : Object.keys(variants)) {
  const first = await post({
    content: `## ${key} · ${names[key]}`,
    allowed_mentions: { parse: [] },
  });
  for (const body of variants[key]()) await post(body);
  console.log(`${key} https://discord.com/channels/${guild}/${channel}/${first}`);
}
