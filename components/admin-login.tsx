"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { loginAdmin } from "@/app/admin/dashboard/actions";
import { Notice } from "./common";

export function AdminLogin({ maxLength }: { maxLength: number }) {
  const [visible, setVisible] = useState(false);
  const [error, submit, pending] = useActionState(loginAdmin, "");

  return <form action={submit} className="surface stack lookup" onSubmit={() => setVisible(false)}>
    <div className="stack admin-password-field">
      <label htmlFor="admin-password">Password</label>
      <div className="admin-password-row">
        <input id="admin-password" name="password" type={visible ? "text" : "password"} autoComplete="current-password"
          autoCapitalize="none" spellCheck={false} maxLength={maxLength} required />
        <button type="button" className="button" aria-controls="admin-password" onClick={() => setVisible(!visible)}>
          {visible ? <><EyeOff size={18} aria-hidden="true" /> Hide password</> : <><Eye size={18} aria-hidden="true" /> Show password</>}
        </button>
      </div>
    </div>
    {error && <Notice>{error}</Notice>}
    <button className="button primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
  </form>;
}
