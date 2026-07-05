"use client";

import { RefObject, useEffect } from "react";

const REVEAL_SELECTOR =
  ".reveal, .reveal-left, .reveal-scale, .img-reveal";
const STACKING_MOBILE_BREAKPOINT = 720;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function smoothStep(value: number) {
  return value * value * (3 - 2 * value);
}

export function useReveal() {
  useEffect(() => {
    let observer: IntersectionObserver | null = null;
    const timer = window.setTimeout(() => {
      const elements = document.querySelectorAll(REVEAL_SELECTOR);
      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("is-visible");
              observer?.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.01, rootMargin: "0px 0px -10px 0px" }
      );

      elements.forEach((element) => observer?.observe(element));
    }, 120);

    return () => {
      window.clearTimeout(timer);
      observer?.disconnect();
    };
  }, []);
}

export function useHeroParallax(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    let raf = 0;

    const onScroll = () => {
      raf = window.requestAnimationFrame(() => {
        if (!ref.current) return;
        const offset = window.scrollY * 0.22;
        ref.current.style.transform = `translateY(${offset}px)`;
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.cancelAnimationFrame(raf);
    };
  }, [ref]);
}

export function usePanelStacking(
  ref: RefObject<HTMLElement | null>,
  panelSelector = ".dlx-panel"
) {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const panels = Array.from(root.querySelectorAll<HTMLElement>(panelSelector));
    if (!panels.length) return;

    panels.forEach((panel, index) => {
      panel.style.setProperty("--dlx-depth", `${index}`);
    });

    let raf = 0;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const update = () => {
      const disableStacking =
        reducedMotion.matches || window.innerWidth <= STACKING_MOBILE_BREAKPOINT;
      const viewportHeight = Math.max(window.innerHeight, 1);

      panels.forEach((panel, index) => {
        const nextPanel = panels[index + 1];
        let stackProgress = 0;

        if (!disableStacking && nextPanel) {
          const nextRect = nextPanel.getBoundingClientRect();
          const rawProgress = clamp(
            (viewportHeight - nextRect.top) / (viewportHeight * 0.92),
            0,
            1
          );
          stackProgress = smoothStep(rawProgress);
        }

        panel.style.setProperty("--dlx-stack-progress", stackProgress.toFixed(4));
      });
    };

    const requestUpdate = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(update);
    };

    const handlePreferenceChange = () => requestUpdate();

    requestUpdate();
    window.addEventListener("scroll", requestUpdate, { passive: true });
    window.addEventListener("resize", requestUpdate);
    reducedMotion.addEventListener?.("change", handlePreferenceChange);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
      reducedMotion.removeEventListener?.("change", handlePreferenceChange);

      panels.forEach((panel) => {
        panel.style.removeProperty("--dlx-depth");
        panel.style.removeProperty("--dlx-stack-progress");
      });
    };
  }, [panelSelector, ref]);
}

export function MarketingCursor() {
  return null;
}
