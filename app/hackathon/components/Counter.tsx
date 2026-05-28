"use client";

import { useEffect, useRef } from "react";
import { useInView, animate } from "motion/react";

export function Counter({
  value,
  suffix = "",
  prefix = "",
}: {
  value: number;
  suffix?: string;
  prefix?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  useEffect(() => {
    if (!isInView) return;
    const node = ref.current;
    if (!node) return;

    const controls = animate(0, value, {
      duration: 2.2,
      ease: "easeOut",
      onUpdate(latest) {
        node.textContent = prefix + Math.floor(latest).toString() + suffix;
      },
    });

    return () => controls.stop();
  }, [isInView, value, suffix, prefix]);

  return (
    <span ref={ref}>
      {prefix}0{suffix}
    </span>
  );
}
