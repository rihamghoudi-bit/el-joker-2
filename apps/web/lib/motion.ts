"use client";
import { useCallback, useEffect, useState } from "react";

const KEY = "eljoker.motion";

/** "Reduce motion" toggle: disables the animated backdrop and glass blur (projectors, low-end laptops). */
export function useMotion(): [boolean, () => void] {
  const [on, setOn] = useState(true);
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(KEY);
    } catch {
      /* storage unavailable */
    }
    const initial = saved ? saved === "on" : !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setOn(initial);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.motion = on ? "on" : "off";
  }, [on]);
  const toggle = useCallback(() => {
    setOn((v) => {
      try {
        window.localStorage.setItem(KEY, v ? "off" : "on");
      } catch {
        /* storage unavailable */
      }
      return !v;
    });
  }, []);
  return [on, toggle];
}
