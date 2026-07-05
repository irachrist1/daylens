"use client";

import { useEffect, useRef, useCallback } from "react";

// ── Toast helper ───────────────────────────────────────────────────────────────
function showToast(message: string, duration = 4000) {
  const existing = document.getElementById("ee-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "ee-toast";
  toast.textContent = message;
  Object.assign(toast.style, {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    background: "rgba(7,15,28,0.92)",
    backdropFilter: "blur(20px)",
    border: "1px solid rgba(74,143,230,0.2)",
    borderRadius: "12px",
    padding: "14px 20px",
    color: "#f8fafc",
    fontSize: "0.875rem",
    fontFamily: "var(--font-inter), system-ui, sans-serif",
    fontWeight: "400",
    zIndex: "9999",
    maxWidth: "380px",
    lineHeight: "1.5",
    boxShadow: "0 16px 48px rgba(0,0,0,0.4), 0 0 0 1px rgba(74,143,230,0.08)",
    animation: "lp-fadeUp 0.4s cubic-bezier(0.22,1,0.36,1) both",
  });

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Confetti burst ─────────────────────────────────────────────────────────────
function confettiBurst() {
  const canvas = document.createElement("canvas");
  Object.assign(canvas.style, {
    position: "fixed",
    inset: "0",
    width: "100vw",
    height: "100vh",
    pointerEvents: "none",
    zIndex: "99999",
  });
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(devicePixelRatio, devicePixelRatio);

  const particles: {
    x: number; y: number; vx: number; vy: number;
    size: number; color: string; rotation: number; spin: number;
  }[] = [];

  const colors = ["#38bdf8", "#0ea5e9", "#7dd3fc", "#f8fafc", "#e0f2fe"];

  for (let i = 0; i < 120; i++) {
    particles.push({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 16,
      vy: Math.random() * -14 - 4,
      size: Math.random() * 6 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      spin: (Math.random() - 0.5) * 12,
    });
  }

  let frame = 0;
  const animate = () => {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    let alive = false;

    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.3;
      p.vx *= 0.99;
      p.rotation += p.spin;

      const alpha = Math.max(0, 1 - frame / 90);
      if (alpha <= 0) continue;
      alive = true;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }

    frame++;
    if (alive && frame < 120) {
      requestAnimationFrame(animate);
    } else {
      canvas.remove();
    }
  };

  requestAnimationFrame(animate);
}

// ── Main component ─────────────────────────────────────────────────────────────
export function EasterEggs() {
  const pageLoadTime = useRef(Date.now());
  const konamiBuffer = useRef<string[]>([]);
  const logoClicks = useRef<number[]>([]);
  const typedBuffer = useRef("");
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // EE-01: Konami Code
  const handleKonami = useCallback((e: KeyboardEvent) => {
    const KONAMI = [
      "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
      "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight",
      "KeyB", "KeyA",
    ];

    konamiBuffer.current.push(e.code);
    if (konamiBuffer.current.length > 10) konamiBuffer.current.shift();

    if (konamiBuffer.current.join(",") === KONAMI.join(",")) {
      confettiBurst();
      showToast("cheat code activated. your focus score is now 100. (jk.)", 4000);
      konamiBuffer.current = [];
    }
  }, []);

  // EE-03: Type "procrastinate"
  const handleTyping = useCallback((e: KeyboardEvent) => {
    if (e.key.length !== 1) return;
    typedBuffer.current += e.key.toLowerCase();
    if (typedBuffer.current.length > 20) {
      typedBuffer.current = typedBuffer.current.slice(-20);
    }
    if (typedBuffer.current.includes("procrastinate")) {
      const minutes = Math.round((Date.now() - pageLoadTime.current) / 60000);
      showToast(
        `Real talk: you've been on this website for ${minutes || "< 1"} minute${minutes !== 1 ? "s" : ""}. Daylens would've noticed. 👀`,
        6000
      );
      typedBuffer.current = "";
    }
  }, []);

  // EE-04: Idle for 45s
  const resetIdleTimer = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      showToast(
        "Still here? We see you. (Not really, we're private.) But seriously, go download the app.",
        6000
      );
    }, 45000);
  }, []);

  useEffect(() => {
    // EE-02: Logo 5x fast click
    const logoEl = document.querySelector(".lp-docs-nav a[href='/']") as HTMLElement | null;
    const handleLogoClick = () => {
      const now = Date.now();
      logoClicks.current.push(now);
      logoClicks.current = logoClicks.current.filter((t) => now - t < 1200);
      if (logoClicks.current.length >= 5) {
        if (logoEl) {
          logoEl.style.animation = "lp-logoShake 0.5s ease both";
          setTimeout(() => { logoEl.style.animation = ""; }, 2000);
        }
        showToast("Stop. I'm working.", 2000);
        logoClicks.current = [];
      }
    };
    logoEl?.addEventListener("click", handleLogoClick);

    // EE-06: 2 AM visitor
    const hour = new Date().getHours();
    if (hour >= 1 && hour <= 4) {
      setTimeout(() => {
        const overline = document.querySelector(".lp-overline--recording");
        if (overline) {
          overline.innerHTML = '<span class="lp-recording-dot"></span> 🌙 Burning the midnight oil? Daylens noticed.';
        }
      }, 1500);
    }

    // EE-07: Footer year click
    const yearEl = document.querySelector(".lp-footer-year");
    const handleYearClick = () => {
      showToast(
        'Built between midnight and 6am. The irony is not lost on us. — Coding: 847h, Sleep: 12h, YouTube: don\'t ask.',
        6000
      );
    };
    yearEl?.addEventListener("click", handleYearClick);

    // Register keyboard listeners
    document.addEventListener("keydown", handleKonami);
    document.addEventListener("keydown", handleTyping);

    // Idle tracking
    resetIdleTimer();
    document.addEventListener("mousemove", resetIdleTimer);
    document.addEventListener("keydown", resetIdleTimer);
    document.addEventListener("scroll", resetIdleTimer);

    return () => {
      logoEl?.removeEventListener("click", handleLogoClick);
      yearEl?.removeEventListener("click", handleYearClick);
      document.removeEventListener("keydown", handleKonami);
      document.removeEventListener("keydown", handleTyping);
      document.removeEventListener("mousemove", resetIdleTimer);
      document.removeEventListener("keydown", resetIdleTimer);
      document.removeEventListener("scroll", resetIdleTimer);
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [handleKonami, handleTyping, resetIdleTimer]);

  return null;
}
