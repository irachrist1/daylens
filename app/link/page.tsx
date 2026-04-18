"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import posthog from "posthog-js";
import { MarketingCursor } from "../components/MarketingEffects";

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

  function stopScanner() {
    if (animationRef.current !== null) {
      window.cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
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
      const res = await fetch("/api/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: normalizedToken }),
      });

      const data = await res.json();

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

            <p style={{ fontSize: "0.9375rem", fontWeight: 300, lineHeight: 1.65, color: "rgba(252,249,248,0.45)", margin: "0 0 2.5rem" }}>
              Connect your desktop app once. Access your data from any device.
            </p>

            {/* QR scan button */}
            <button
              type="button"
              onClick={() => {
                setScannerError("");
                setScanning((current) => !current);
              }}
              className={scanning ? "lp-btn-ghost-light" : "lp-btn-primary"}
              style={{ width: "100%", justifyContent: "center", display: "flex", alignItems: "center", gap: "0.625rem" }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 012-2h2" />
                <path d="M17 3h2a2 2 0 012 2v2" />
                <path d="M21 17v2a2 2 0 01-2 2h-2" />
                <path d="M7 21H5a2 2 0 01-2-2v-2" />
                <rect x="7" y="7" width="4" height="4" rx="0.5" />
                <rect x="13" y="7" width="4" height="4" rx="0.5" />
                <rect x="7" y="13" width="4" height="4" rx="0.5" />
                <line x1="13" y1="13" x2="13" y2="13" strokeWidth="3" />
              </svg>
              {scanning ? "Stop Camera" : "Scan QR Code"}
            </button>

            {scanning && (
              <div className="lp-scanner-wrapper" style={{ marginTop: "1rem" }}>
                <video ref={videoRef} className="lp-scanner-video" muted playsInline />
                <div className="lp-scanner-corners" />
              </div>
            )}

            {scannerError && <p className="lp-error-msg">{scannerError}</p>}

            {/* OR divider */}
            <div className="lp-or-divider">
              <div className="lp-or-line" />
              <span className="lp-or-label">or</span>
              <div className="lp-or-line" />
            </div>

            {/* Manual token entry */}
            {!showManualEntry ? (
              <button
                type="button"
                onClick={() => setShowManualEntry(true)}
                className="lp-btn-ghost-light"
                style={{ width: "100%", justifyContent: "center", display: "flex" }}
              >
                Enter link token manually
              </button>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
                <div>
                  <label
                    htmlFor="link-token"
                    className="text-label"
                    style={{ color: "rgba(252,249,248,0.35)", display: "block", marginBottom: "0.625rem" }}
                  >
                    Link token from your desktop app
                  </label>
                  <input
                    id="link-token"
                    type="text"
                    value={token}
                    onChange={(e) => setToken(e.target.value.toLowerCase())}
                    placeholder="Paste the 32-character code"
                    maxLength={32}
                    className="lp-input lp-input--mono"
                    autoFocus
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

            <p className="text-label" style={{ color: "rgba(252,249,248,0.3)", marginBottom: "2.5rem" }}>
              How to connect
            </p>

            <h2 className="text-headline" style={{ color: "rgba(252,249,248,0.85)", margin: "0 0 2rem", lineHeight: 1.3 }}>
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
                  desc: "Daylens will generate a QR code and link token for browser access.",
                },
                {
                  n: "03",
                  title: "Scan or paste below",
                  desc: "Point your camera at the QR code, or paste the token manually.",
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

            <p style={{ fontSize: "0.75rem", fontWeight: 300, color: "rgba(252,249,248,0.2)", lineHeight: 1.65, marginTop: "2.5rem" }}>
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
