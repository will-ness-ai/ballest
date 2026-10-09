// @vitest-environment happy-dom
// A Daily's panel flips from its countdown to Final at its close, on a page that was
// rendered before it and never reloads (useDailyClock, which DayPanel reads).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { useDailyClock } from "../hooks/client";

/* React's act() warns outside a test renderer unless told it is one */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const START = Date.parse("2026-09-01T00:59:30Z");
/* 30 s after the page renders: sooner than the clock's own once-a-minute tick */
const ENDS_AT = "2026-09-01T01:00:00Z";

function Probe({ final }: { final: boolean }) {
  const { live } = useDailyClock({ endsAt: ENDS_AT, final });
  return <>{live ? "live" : "final"}</>;
}

let el: HTMLElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  el = document.createElement("div");
  root = createRoot(el);
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  vi.useRealTimers();
});

test("a live Daily flips to Final at its close, without a reload", () => {
  act(() => {
    root.render(<Probe final={false} />);
  });
  expect(el.textContent).toBe("live");
  act(() => {
    vi.advanceTimersByTime(29_900);
  });
  expect(el.textContent).toBe("live");
  act(() => {
    vi.advanceTimersByTime(100);
  });
  expect(el.textContent).toBe("final");
});

test("a Daily the database holds as final is final before its close by the reader's clock", () => {
  act(() => {
    root.render(<Probe final />);
  });
  expect(el.textContent).toBe("final");
});
