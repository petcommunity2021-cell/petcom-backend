"use client";

import { useActionState } from "react";
import { requestCode, verifyCode, type LoginState } from "@/lib/auth/actions";

const initial: LoginState = { stage: "email", message: "" };

export function LoginForm() {
  const [requestState, requestAction, requesting] = useActionState(requestCode, initial);
  const [verifyState, verifyAction, verifying] = useActionState(verifyCode, initial);

  const stage = requestState.stage === "code" ? "code" : "email";
  const message =
    stage === "code" ? verifyState.message || requestState.message : requestState.message;
  const email = requestState.email ?? "";

  return (
    <div className="card p-6">
      {stage === "email" ? (
        <form action={requestAction} className="space-y-4">
          <div>
            <label className="label" htmlFor="email">
              Work email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="field"
              placeholder="owner@petcom.in"
              autoComplete="email"
              required
              autoFocus
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={requesting}>
            {requesting ? "Sending…" : "Send me a code"}
          </button>
        </form>
      ) : (
        <div className="space-y-4">
          <form action={verifyAction} className="space-y-4">
            <input type="hidden" name="email" value={email} />
            <div className="rounded-xl border border-line bg-cream/70 px-3 py-2.5 text-xs text-ink-soft">
              Code sent for <span className="font-bold">{email}</span>. In this build it is printed in
              the terminal running <code className="rounded bg-black/5 px-1">npm run dev</code>.
            </div>
            <div>
              <label className="label" htmlFor="code">
                6-digit code
              </label>
              <input
                id="code"
                name="code"
                className="field text-center text-lg font-bold tracking-[0.4em] tabular-nums"
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                autoFocus
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" disabled={verifying}>
              {verifying ? "Checking…" : "Sign in"}
            </button>
          </form>
          <form action={requestAction}>
            <input type="hidden" name="email" value={email} />
            <button type="submit" className="text-xs font-bold text-ink-soft underline">
              Use a different address
            </button>
          </form>
        </div>
      )}

      {message ? (
        <p className="mt-4 rounded-xl border border-line bg-cream/70 px-3 py-2.5 text-xs leading-relaxed text-ink-soft">
          {message}
        </p>
      ) : null}
    </div>
  );
}
