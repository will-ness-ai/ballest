// The browser and Discord, as hooks: the window's size, Discord's picture-in-picture, a moment
// passing, and the viewer's Discord status.
import type { DiscordSDK } from "@discord/embedded-app-sdk";
import { Common } from "@discord/embedded-app-sdk";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

const onResize = (listener: () => void) => {
  window.addEventListener("resize", listener);
  return () => window.removeEventListener("resize", listener);
};

/** The window's width and height, kept current. */
export const useViewport = () => {
  const width = useSyncExternalStore(onResize, () => window.innerWidth);
  const height = useSyncExternalStore(onResize, () => window.innerHeight);
  return { width, height };
};

/**
 * A window this short is Discord's picture-in-picture (about 180px tall) even if its layout event
 * hasn't arrived, so it gets the small view too.
 */
const PIP_MAX_HEIGHT = 240;

/** Discord has shrunk the Activity to its picture-in-picture window (`?pip` stands in for it in the demo). */
export const usePip = (sdk: DiscordSDK | null, demoPip: boolean) => {
  const [layoutPip, setLayoutPip] = useState(demoPip);
  const { height } = useViewport();
  useEffect(() => {
    if (sdk === null) return;
    const update = ({ layout_mode }: { layout_mode: number }) => {
      setLayoutPip(layout_mode === Common.LayoutModeTypeObject.PIP);
    };
    sdk.subscribe("ACTIVITY_LAYOUT_MODE_UPDATE", update).catch(() => undefined);
    return () => {
      sdk.unsubscribe("ACTIVITY_LAYOUT_MODE_UPDATE", update).catch(() => undefined);
    };
  }, [sdk]);
  return layoutPip || height < PIP_MAX_HEIGHT;
};

/** Whether this device's clock is still before `until`, re-rendering when it passes. */
export const useBefore = (until: number) => {
  const passing = useCallback(
    (notify: () => void) => {
      const timer = setTimeout(notify, Math.max(0, until - Date.now()) + 5);
      return () => clearTimeout(timer);
    },
    [until],
  );
  return useSyncExternalStore(passing, () => Date.now() < until);
};

/**
 * The viewer's Discord status: "Browsing Matches", "Watching a Match", or "In a Match" with its
 * end (on this device's clock). Sent only when it changes.
 */
export const usePresence = (sdk: DiscordSDK | null, details: string, end: number | null) => {
  useEffect(() => {
    if (sdk === null) return;
    sdk.commands
      .setActivity({
        activity: { type: 0, details, ...(end === null ? {} : { timestamps: { end } }) },
      })
      .catch(() => undefined);
  }, [sdk, details, end]);
};
