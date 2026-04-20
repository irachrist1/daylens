"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import posthog from "posthog-js";
import { MarketingCursor } from "../components/MarketingEffects";
import { apiPath } from "@/app/lib/basePath";

type BarcodeDetectorCtor = new (options: {
  formats: string[];
}) => {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue?: string }>>;
};

function LinkPageContent() {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scannerError, setScannerError] = useState("");
  const [showManualEntry, setShowManualEntry] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const tokenInputRef = useRef<HTMLInputElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const tokenFromUrl = searchParams.get("token");
    if (tokenFromUrl && /^[0-9a-f]{32}$/i.test(tokenFromUrl)) {
      void submitToken(tokenFromUrl);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!scanning) {
      stopScanner();
      return;
    }

    const Detector = (
      window as Window & { BarcodeDetector?: BarcodeDetectorCtor }
    ).BarcodeDetector;

    if (!Detector) {
      setScannerError("Camera QR scanning is not supported in this browser yet.");
      setScanning(false);
      setShowManualEntry(true);
      return;
    }

    let cancelled = false;
    const detector = new Detector({ formats: ["qr_code"] });

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        const tick = async () => {
          if (!videoRef.current) return;

          try {
            const barcodes = await detector.detect(videoRef.current);
            const match = barcodes.find((barcode) =>
              typeof barcode.rawValue === "string" &&
              /^[0-9a-f]{32}$/i.test(barcode.rawValue)
            );

            if (match?.rawValue) {
              stopScanner();
              setScanning(false);
              void submitToken(match.rawValue);
              return;
            }
          } catch {
            setScannerError("Unable to read the QR code. Try again in better light.");
          }

          animationRef.current = window.requestAnimationFrame(() => {
            void tick();
          });
        };

        await tick();
      } catch {
        setScannerError("Camera access was denied.");
        setScanning(false);
        setShowManualEntry(true);
      }
    }

    void start();

    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scanning]);

  useEffect(() => {
    if (!showManualEntry) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      tokenInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [showManualEntry]);

  function stopScanner() {
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function openManualEntry() {
    setScannerError("");
    setScanning(false);
    setShowManualEntry(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;
    await submitToken(token);
  }

  async function submitToken(rawToken: string) {
    const normalizedToken = rawToken.trim().toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(normalizedToken)) {
      setError("Invalid link token. Make sure you copied the full code from your desktop app.");
      return;
    }

    posthog.capture("link_pairing_started");
    setLoading(true);
    setError("");
    setScannerError("");

    try {
      const res = await fetch(apiPath("/api/link"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: normalizedToken }),
      });

      const data = await res.json().catch(() => ({} as { error?: string }));

      if (!res.ok) {
        setError(data.error || "Failed to link");
        setLoading(false);
        return;
      }

      posthog.capture("link_pairing_completed");
      router.push("/dashboard");
    } catch {
      setError("Connection failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="lp">
      <MarketingCursor />
      <div className="lp-connect-layout">

        {/* ── Left: Form ── */}
        <div className="lp-connect-form">
          <div className="lp-connect-form-inner">

            <Link href="/" className="lp-connect-logo">
              <img src="/daylens/app-icon.png" alt="Daylens" width={28} height={28} style={{ borderRadius: 7 }} />
              Daylens
            </Link>

            <div className="lp-accent-rule" style={{ marginBottom: "1.5rem" }} />

            <p className="text-label" style={{ color: "var(--lp-accent)", marginBottom: "0.875rem" }}>
              Connect Device
            </p>

            <h1 className="text-display-md" style={{ color: "var(--lp-bone)", margin: "0 0 0.75rem" }}>
              Link your web companion.
            </h1>

            <p style={{ fontSize: "0.9375rem", fontWeight: 300, lineHeight: 1.65, color: "var(--lp-ink-muted)", margin: "0 0 2.5rem" }}>
              Connect your desktop app once. Access your data from any device.
            </p>

            {!showManualEntry ? (
              <button
                type="button"
                onClick={openManualEntry}
                className="lp-btn-primary"
                style={{ width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: "0.625rem" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5z" />
                  <path d="M8 8h8" />
                  <path d="M8 12h8" />
                  <path d="M8 16h5" />
                </svg>
                Enter Link Code
              </button>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                <div>
                  <label
                    htmlFor="link-token"
                    className="text-label"
                    style={{ color: "var(--lp-ink-muted)", display: "block", marginBottom: "0.625rem" }}
                  >
                    Link token from your desktop app
                  </label>
                  <input
                    ref={tokenInputRef}
                    id="link-token"
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value.toLowerCase())}
                    placeholder="Paste the 32-character code"
                    maxLength={32}
                    className="lp-input lp-input--mono"
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="lp-hint-text">Found in Settings → Create workspace / Workspace actions on your desktop</p>
                </div>

                <button
                  type="submit"
                  disabled={loading || token.trim().length !== 32}
                  className="lp-btn-primary"
                  style={{ width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: "0.5rem", opacity: (loading || token.trim().length !== 32) ? 0.4 : 1 }}
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin" width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Connecting…
                    </>
                  ) : (
                    "Connect →"
                  )}
                </button>
              </form>
            )}

            {/* OR divider */}
            <div className="lp-or-divider">
              <div className="lp-or-line" />
              <span className="lp-or-label">or</span>
              <div className="lp-or-line" />
            </div>

            <button
              type="button"
              onClick={() => {
                setScannerError("");
                setShowManualEntry(false);
                setScanning((current) => !current);
              }}
              className="lp-btn-ghost-light"
              style={{ width: "100%", justifyContent: "center", display: "flex" }}
            >
              {scanning ? "Stop Camera" : "Scan QR Code Instead"}
            </button>

            {scanning && (
              <div className="lp-scanner-wrapper" style={{ marginTop: "1rem" }}>
                <video ref={videoRef} className="lp-scanner-video" muted playsInline />
                <div className="lp-scanner-corners" />
              </div>
            )}

            {scannerError && <p className="lp-error-msg">{scannerError}</p>}

            {error && <p className="lp-error-msg">{error}</p>}

            {/* Footer links */}
            <div className="lp-connect-footer">
              <Link href="/recover" className="lp-ghost-link lp-ghost-link--accent">
                Already linked? Restore with recovery phrase
              </Link>
              <Link href="/" className="lp-ghost-link">
                ← Back to home
              </Link>
            </div>

          </div>
        </div>

        {/* ── Right: How-it-works panel ── */}
        <div className="lp-connect-panel">
          <div className="lp-connect-panel-inner">

            <p className="text-label" style={{ color: "var(--lp-ink-faint)", marginBottom: "2.5rem" }}>
              How to connect
            </p>

            <h2 className="text-headline" style={{ color: "var(--lp-bone)", margin: "0 0 2rem", lineHeight: 1.3 }}>
              Three steps.<br />No account needed.
            </h2>

            <div>
              {[
                {
                  n: "01",
                  title: "Open Daylens on your computer",
                  desc: "Go to Settings and find the workspace section.",
                },
                {
                  n: "02",
                  title: 'Create a workspace, then "Create browser link"',
                  desc: "Daylens will generate a link token for browser access. The QR code is optional.",
                },
                {
                  n: "03",
                  title: "Paste the token below",
                  desc: "Manual entry is the default. Camera scanning is there if you actually want it.",
                },
              ].map((step) => (
                <div key={step.n} className="lp-connect-step">
                  <p className="text-label lp-connect-step-num">{step.n}</p>
                  <div>
                    <p className="lp-connect-step-title">{step.title}</p>
                    <p className="lp-connect-step-desc">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <p style={{ fontSize: "0.75rem", fontWeight: 300, color: "var(--lp-ink-faint)", lineHeight: 1.65, marginTop: "2.5rem" }}>
              Your data stays on your device. Browser access follows the workspace you explicitly create and link.
            </p>

          </div>
        </div>

      </div>
    </div>
  );
}

export default function LinkPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: "var(--lp-surface)" }} />}>
      <LinkPageContent />
    </Suspense>
  );
}
