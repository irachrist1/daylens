"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { motion } from "motion/react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="h-9 w-[64px] rounded-full border border-zinc-200 dark:border-zinc-800" />
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      className="relative inline-flex h-9 w-[64px] items-center justify-center rounded-full border border-zinc-200 bg-white px-2 transition-colors dark:border-zinc-800 dark:bg-zinc-900"
    >
      <motion.div
        layout
        initial={false}
        aria-hidden="true"
        className="absolute h-7 w-7 rounded-full bg-zinc-100 shadow-sm dark:bg-zinc-800"
        animate={{ x: isDark ? -14 : 14 }}
        transition={{ type: "spring", stiffness: 500, damping: 35 }}
      />
      <div className="relative z-10 flex w-full items-center justify-between">
        <Moon
          className="h-4 w-4 text-zinc-500 dark:text-zinc-300"
          aria-hidden="true"
          strokeWidth={1.8}
          style={{ opacity: isDark ? 1 : 0.35 }}
        />
        <Sun
          className="h-4 w-4 text-zinc-500 dark:text-zinc-300"
          aria-hidden="true"
          strokeWidth={1.8}
          style={{ opacity: isDark ? 0.35 : 1 }}
        />
      </div>
    </button>
  );
}
