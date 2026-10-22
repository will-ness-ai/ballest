// The Activity page's start. Inside Discord it signs in through the Embedded App SDK (session.ts);
// in a plain browser it offers the demo's members instead. Sign-in starts before React draws
// anything, and the server has already put the splash and the page's config in the HTML.
import { DiscordSDK } from "@discord/embedded-app-sdk";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PageConfig } from "../server.js";
import { makeClient } from "./client.js";
import { discordClient, exchange } from "./discord.js";
import { ClientProvider } from "./queries.js";
import { discordSession, fixedSession, localToken, type SignedIn } from "./session.js";
import { App } from "./ui/App.js";
import { Logo } from "./ui/art.js";
import { Btn } from "./ui/controls.js";
import { Notice, SigningIn } from "./ui/notice.js";

const TOKEN_KEY = "multiballs.token";

const readConfig = async (): Promise<PageConfig> => {
  const inline = document.getElementById("config")?.textContent;
  if (inline != null && inline !== "") return JSON.parse(inline) as PageConfig;
  return (await (await fetch("/api/config")).json()) as PageConfig;
};

/** The SDK reads `err.message` off plain `{ code, message }` objects, not Errors. */
const describe = (e: unknown): string => {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e !== null && "message" in e) return String(e.message);
  return String(e);
};

type Boot =
  | { readonly phase: "signing-in" }
  | { readonly phase: "demo"; readonly users: PageConfig["devUsers"] }
  | { readonly phase: "wrong" }
  | { readonly phase: "failed"; readonly why: string; readonly retry: boolean }
  | { readonly phase: "ready"; readonly session: SignedIn };

const params = new URLSearchParams(location.search);
const inDiscord = params.has("frame_id");
const configured = readConfig();
/** One SDK for the page's life: constructing it starts the handshake with Discord. */
const sdk = configured.then((c) => (inDiscord ? new DiscordSDK(c.clientId) : null));

const signIn = async (): Promise<Boot> => {
  const config = await configured;
  const discord = await sdk;
  if (discord !== null) {
    const session = await discordSession(discordClient(discord, config.clientId), {
      guildIds: [config.guildId],
      saved: localToken(TOKEN_KEY),
      exchange,
    });
    return session === "wrongServer" ? { phase: "wrong" } : { phase: "ready", session };
  }
  if (config.devUsers.length === 0)
    return {
      phase: "failed",
      why: "Open Multiballs from a channel in the Ballest server.",
      retry: false,
    };
  // The demo: pick who to be. `?as=<id>` skips the question, for a second tab.
  const as = params.get("as");
  return as === null
    ? { phase: "demo", users: config.devUsers }
    : { phase: "ready", session: fixedSession(`dev-${as}`) };
};
const first = signIn();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2, staleTime: 1_000 } },
});

const Root = () => {
  const [boot, setBoot] = useState<Boot>({ phase: "signing-in" });
  const [discord, setDiscord] = useState<DiscordSDK | null>(null);
  const settle = useCallback((run: Promise<Boot>) => {
    run.then(setBoot, (e: unknown) =>
      setBoot({ phase: "failed", why: `Couldn't sign in: ${describe(e)}`, retry: inDiscord }),
    );
  }, []);
  useEffect(() => {
    settle(first);
    void sdk.then(setDiscord, () => undefined);
  }, [settle]);
  const retry = () => {
    setBoot({ phase: "signing-in" });
    settle(signIn());
  };
  const notMember = useCallback(() => setBoot({ phase: "wrong" }), []);
  const client = useMemo(() => (boot.phase === "ready" ? makeClient(boot.session) : null), [boot]);

  if (boot.phase === "ready" && client !== null)
    return (
      <ClientProvider value={client}>
        <App sdk={discord} demoPip={params.has("pip")} onNotMember={notMember} />
      </ClientProvider>
    );
  return (
    <>
      {boot.phase === "signing-in" ? (
        <SigningIn />
      ) : boot.phase === "wrong" ? (
        <Notice>
          <div className="mt" style={{ fontSize: 22 }}>
            Multiballs only runs in the Ballest server
          </div>
          <div className="note">Open it from a channel there.</div>
        </Notice>
      ) : boot.phase === "demo" ? (
        <div className="vE">
          <div className="emptyb demo">
            <Logo />
            <span className="label">Demo: sign in as</span>
            <div className="row-btns">
              {boot.users.map((u) => (
                <Btn
                  key={u.id}
                  onClick={() => setBoot({ phase: "ready", session: fixedSession(`dev-${u.id}`) })}
                >
                  {u.name}
                </Btn>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Notice>
          <div className="err">{boot.phase === "failed" ? boot.why : ""}</div>
          {boot.phase === "failed" && boot.retry ? (
            <Btn look="go" onClick={retry}>
              Try again
            </Btn>
          ) : null}
        </Notice>
      )}
    </>
  );
};

const root = document.getElementById("app");
if (root === null) throw new Error("the page has no #app element");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Root />
    </QueryClientProvider>
  </StrictMode>,
);
