"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "@/lib/auth/actions";

const initial: LoginState = { message: "" };

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <div className="card p-6">
      <form action={action} className="space-y-4">
        <label className="label">
          Username
          <input name="username" className="field" autoComplete="username"
            autoCapitalize="none" spellCheck={false} maxLength={64} required />
        </label>
        <label className="label">
          Password
          <input name="password" type="password" className="field"
            autoComplete="current-password" maxLength={128} required />
        </label>
        {state.message ? <p role="alert" className="text-sm text-ink-soft">{state.message}</p> : null}
        <button type="submit" className="btn btn-primary w-full" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
