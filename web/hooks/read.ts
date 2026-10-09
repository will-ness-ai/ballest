"use client";
// A read from the site's API, made once per key for as long as the page is open and shared
// by every component that asks for it. A read that fails is forgotten, so the next mount
// (often the next page) tries again, and until one succeeds the hook has nothing to give.
import { useEffect, useState } from "react";

/* `load` reads one key, rejecting when the read fails; the result reads each key once */
export function readOnce<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const reads = new Map<string, Promise<T>>();
  return (key) => {
    let p = reads.get(key);
    if (!p) {
      p = load(key);
      p.catch(() => reads.delete(key));
      reads.set(key, p);
    }
    return p;
  };
}

/* what `read` gave for `key`, boxed so a read of null still counts as read; null while
   there is no key, while the read is out, and after it failed */
export function useRead<T>(
  read: (key: string) => Promise<T>,
  key: string | null,
): { value: T } | null {
  const [got, setGot] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    if (key == null) return;
    let live = true;
    read(key).then(
      (value) => {
        if (live) setGot({ key, value });
      },
      () => undefined /* stays unread: draw nothing rather than a wrong state */,
    );
    return () => {
      live = false;
    };
  }, [read, key]);
  return key != null && got?.key === key ? got : null;
}
