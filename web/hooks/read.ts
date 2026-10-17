"use client";
// A read from the site's API, made once per key for as long as the page is open and shared
// by every component that asks for it. A read that fails is forgotten, so the next mount
// (often the next page) tries again. useRead gives nothing until one succeeds; useReadOutcome
// also says when it failed.
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

/* what `read` gave for `key`, boxed so a read of null still counts as read, or that it
   failed, with a retry that reads it again; null while there is no key and while the read
   is out */
export function useReadOutcome<T>(
  read: (key: string) => Promise<T>,
  key: string | null,
): { value: T } | { retry: () => void } | null {
  /* counts the tries, so a retry runs the read again */
  const [tries, setTries] = useState(0);
  const [got, setGot] = useState<({ key: string } & ({ value: T } | { failed: true })) | null>(
    null,
  );
  useEffect(() => {
    if (key == null) return;
    let live = true;
    read(key).then(
      (value) => {
        if (live) setGot({ key, value });
      },
      () => {
        if (live) setGot({ key, failed: true });
      },
    );
    return () => {
      live = false;
    };
  }, [read, key, tries]);
  if (key == null || got?.key !== key) return null;
  if ("value" in got) return got;
  return {
    retry: () => {
      setGot(null);
      setTries((n) => n + 1);
    },
  };
}

/* what `read` gave for `key`; null while there is no key, while the read is out, and after
   it failed: draw nothing rather than a wrong state */
export function useRead<T>(
  read: (key: string) => Promise<T>,
  key: string | null,
): { value: T } | null {
  const got = useReadOutcome(read, key);
  return got && "value" in got ? got : null;
}
