"use client";
import { CircleAlert } from "lucide-react";
import Link from "next/link";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="wrap centered"><div className="empty surface"><CircleAlert strokeWidth={1.5} />
    <h1>LockDulu is temporarily unavailable</h1><p>Try again in a moment.</p>
    <button className="button primary" onClick={reset}>Try again</button> <Link className="button" href="/">Go to storefront</Link>
  </div></main>;
}
