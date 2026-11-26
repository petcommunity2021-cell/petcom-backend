"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CheckInOutcome } from "@/lib/domain/checkin";

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
  const cameraRun = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function releaseCamera() {
    cameraRun.current += 1;
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  useEffect(() => {
    setCameraSupported(Boolean(navigator.mediaDevices?.getUserMedia));
    return releaseCamera;
  }, []);

  function stopCamera() {
    releaseCamera();
    setCamera("off");
  }

  async function startCamera() {
    const run = ++cameraRun.current;
    setError(null);
    setCamera("starting");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (run !== cameraRun.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const { default: decodeQr } = await import("jsqr");
      if (run !== cameraRun.current) return;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview unavailable");

      video.srcObject = stream;
      await video.play();
      if (run !== cameraRun.current) return;

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("QR reader unavailable");
      setCamera("on");

      timerRef.current = setInterval(() => {
        if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        context.drawImage(video, 0, 0, width, height);
        const frame = context.getImageData(0, 0, width, height);
        const value = decodeQr(frame.data, width, height, { inversionAttempts: "dontInvert" })?.data;
        if (value) {
          setToken(value);
          stopCamera();
          void submit(value);
        }
      }, 250);
    } catch (cause) {
      if (run !== cameraRun.current) return;
      stopCamera();
      setError(cause instanceof DOMException && cause.name === "NotAllowedError"
        ? "Camera access was denied. Allow it in your browser’s site settings, or paste the ticket link."
        : "Could not start the camera. Try again or paste the ticket link.");
    }
  }

  async function submit(value: string) {
    if (!value.trim() || busy) return;
    stopCamera();
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
                disabled={!cameraSupported || busy}
                title={
                  cameraSupported
                    ? "Scan with the camera"
                    : "Camera access is unavailable — paste the ticket link instead"
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
            <video ref={videoRef} playsInline muted autoPlay className="h-56 w-full object-cover" />
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
