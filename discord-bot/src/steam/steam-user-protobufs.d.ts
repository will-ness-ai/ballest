// steam-user bundles Steam's protobufs, including the leaderboard messages, but ships no
// types for them. This covers only what src/steam/session.ts uses.
declare module "steam-user/protobufs/generated/_load.js" {
  interface ProtoType {
    fromObject(object: object): unknown
    encode(message: unknown): { finish(): Uint8Array }
    decode(bytes: Uint8Array): unknown
    toObject(message: unknown, options: { longs: StringConstructor; defaults: boolean }): unknown
  }
  const Protos: Readonly<Record<string, ProtoType | undefined>>
  export default Protos
}
