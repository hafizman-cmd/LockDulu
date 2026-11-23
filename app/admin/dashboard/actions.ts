"use server";

import { redirect } from "next/navigation";
import { adminPasswordMaxLength, adminPath, adminSignInEnabled, signInAdmin, signOutAdmin } from "@/lib/admin-auth";

let failedAttempts = 0;
let windowEnds = 0;

export async function loginAdmin(_previousError: string, form: FormData) {
  if (!adminSignInEnabled()) return "Admin sign-in is unavailable.";
  const password = form.get("password");
  if (typeof password !== "string" || !password || password.length > adminPasswordMaxLength) {
    return "Enter your admin password.";
  }

  const now = Date.now();
  if (now >= windowEnds) {
    failedAttempts = 0;
    windowEnds = now + 60_000;
  }
  if (failedAttempts >= 8) return "Too many sign-in attempts. Try again in a minute.";
  if (!await signInAdmin(password)) {
    failedAttempts += 1;
    return "Incorrect admin password.";
  }

  failedAttempts = 0;
  redirect(adminPath);
}

export async function logoutAdmin() {
  await signOutAdmin();
  redirect(adminPath);
}
