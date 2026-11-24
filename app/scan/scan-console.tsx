"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckInOutcome } from "@/lib/domain/checkin";

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>;
};

declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats?: string[] }) => BarcodeDetectorLike;
  }
}

const VERDICT: Record<
  CheckInOutcome["result"],
  { title: string; tone: string; sign: string }
> = {
  admitted: { title: "Let them in", tone: "good", sign: "✓" },
  already_used: { title: "Already scanned", tone: "warn", sign: "!" },
  void: { title: "Void ticket", tone: "bad", sign: "×" },
  cancelled: { title: "Cancelled ticket", tone: "bad", sign: "×" },
  refund_requested: { title: "Refund requested", tone: "bad", sign: "×" },
  not_found: { title: "Not a Petcom ticket", tone: "bad", sign: "×" },
};

const TONE_STYLE: Record<string, string> = {
  good: "border-[#bfe0cc] bg-good-soft text-good",
  warn: "border-[#ecd9a6] bg-warn-soft text-warn",
  bad: "border-[#f3c9c4] bg-bad-soft text-bad",
};

export function ScanConsole({ staffName }: { staffName: string }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [outcome, setOutcome] = useState<CheckInOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState<"off" | "starting" | "on">("off");
  const [cameraSupported, setCameraSupported] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setCameraSupported(Boolean(window.BarcodeDetector));
    return () => stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopCamera() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCamera("off");
  }

  async function startCamera() {
    const Detector = window.BarcodeDetector;
    if (!Detector) return;
    setCamera("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      detectorRef.current = new Detector({ formats: ["qr_code"] });
      setCamera("on");

      let scanning = false;
      timerRef.current = setInterval(async () => {
        if (scanning || !videoRef.current || !detectorRef.current) return;
        scanning = true;
        try {
          const codes = await detectorRef.current.detect(videoRef.current);
          const value = codes[0]?.rawValue;
          if (value) {
            setToken(value);
            stopCamera();
            await submit(value);
          }
        } catch {
          // A dropped frame is not an error worth showing.
        } finally {
          scanning = false;
        }
      }, 450);
    } catch {
      setCamera("off");
      setError("Camera permission was refused. Type or paste the code instead.");
    }
  }

  async function submit(value: string) {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/check-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: value }),
      });
      const data = (await res.json()) as CheckInOutcome & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "That did not go through.");
      } else {
        setOutcome(data);
        setToken("");
        if (data.result === "admitted") router.refresh();
      }
    } catch {
      setError("No connection. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const verdict = outcome ? VERDICT[outcome.result] : null;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="card p-5">
        <h2 className="text-lg font-bold">Scan or paste a code</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Welcome back, {staffName.split(" ")[0]}. The camera opens only when you ask it to.
        </p>

        <form
          className="mt-4 space-y-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(token);
          }}
        >
          <label className="label" htmlFor="token">
            Ticket code or link
          </label>
          <input
            id="token"
            className="field font-mono"
            placeholder="paste /ticket/… or the code"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary flex-1" disabled={busy}>
              {busy ? "Checking…" : "Check ticket"}
            </button>
            {camera === "off" ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={startCamera}
                disabled={!cameraSupported}
                title={
                  cameraSupported
                    ? "Scan with the camera"
                    : "This browser has no built-in QR scanner — paste the code instead"
                }
              >
                Camera
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={stopCamera}>
                Stop
              </button>
            )}
          </div>
        </form>

        {camera !== "off" ? (
          <div className="mt-4 overflow-hidden rounded-xl border border-line bg-black">
            <video ref={videoRef} playsInline muted className="h-56 w-full object-cover" />
            <p className="px-3 py-2 text-center text-xs text-white/70">
              {camera === "starting" ? "Starting camera…" : "Point at the QR code"}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-xl border border-[#f3c9c4] bg-bad-soft px-3 py-2.5 text-sm font-semibold text-bad">
            {error}
          </p>
        ) : null}

        <div className="mt-5 rounded-xl border border-line bg-cream/60 p-3.5 text-xs leading-relaxed text-muted">
          A ticket admits once. If someone shows the same code twice, the second scan is the record
          that the code was shared — call the desk, do not let them in on a screenshot of a used
          ticket.
        </div>
      </section>

      <section aria-live="polite" className="space-y-3">
        {verdict && outcome ? (
          <div className={`rounded-2xl border-2 p-5 ${TONE_STYLE[verdict.tone]}`}>
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-white/70 text-xl font-black">
                {verdict.sign}
              </span>
              <div>
                <p className="text-lg font-bold leading-tight">{verdict.title}</p>
                {"holderName" in outcome && outcome.holderName ? (
                  <p className="text-sm font-semibold opacity-80">{outcome.holderName}</p>
                ) : null}
              </div>
            </div>
            {outcome.result === "already_used" ? (
              <p className="mt-3 text-sm leading-relaxed opacity-90">
                First admitted at{" "}
                {outcome.checkedInAt
                  ? new Date(outcome.checkedInAt).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })
                  : "an earlier scan"}
                . A second person with this code is not allowed in.
              </p>
            ) : null}
            {outcome.result === "admitted" ? (
              <p className="mt-3 text-sm opacity-90">Recorded against your name and phone.</p>
            ) : null}
            {outcome.result === "void" ? (
              <p className="mt-3 text-sm leading-relaxed opacity-90">
                This ticket was never paid for — it is a placeholder from an unapproved sale.
                Check the approvals queue.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="card grid place-items-center p-8 text-center">
            <p className="text-sm font-semibold text-ink-soft">
              The verdict appears here, large enough to read at arm&rsquo;s length.
            </p>
            <p className="mt-1 text-xs text-muted">Nothing is admitted until you press the button.</p>
          </div>
        )}

        <div className="rounded-xl border border-line bg-paper px-4 py-3 text-xs text-muted">
          <p className="font-bold text-ink-soft">If the scanner fails</p>
          <p className="mt-1 leading-relaxed">
            Use the manual code field. A ticket URL pasted in full is understood — take everything
            after <code className="rounded bg-black/5 px-1">/ticket/</code>.
          </p>
        </div>
      </section>
    </div>
  );
}
