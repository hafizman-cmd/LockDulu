"use client";
import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";

export function ShareStorefront({ storeSlug, publicOrigin }: { storeSlug: string; publicOrigin?: string }) {
  const [browserOrigin, setBrowserOrigin] = useState("");
  const [feedback, setFeedback] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { setBrowserOrigin(window.location.origin); }, []);
  const configured = publicOrigin ? URL.parse(publicOrigin) : null;
  const origin = configured && ["http:", "https:"].includes(configured.protocol) ? configured.origin : browserOrigin;
  const storefrontUrl = origin ? URL.parse(`/${encodeURIComponent(storeSlug)}`, origin) : null;
  const link = storefrontUrl?.href ?? "";
  const local = storefrontUrl && /^(?:localhost|127(?:\.\d+){3}|\[::1\])$/.test(storefrontUrl.hostname);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setFeedback("Link copied.");
    } catch {
      input.current?.focus();
      input.current?.select();
      setFeedback("Link selected. Copy it from the field.");
    }
  }

  return <section className="surface share-storefront" aria-labelledby="share-storefront-heading">
    <h2 id="share-storefront-heading" tabIndex={-1}>Share your storefront</h2>
    <p className="muted">{local ? "This is a local test link. Use your live site address to share with customers." : "Paste this link into your social bio or send it to customers."}</p>
    <div className="share-storefront-fields">
      <input ref={input} type="url" value={link} readOnly aria-label="Storefront link" />
      <button className="button" type="button" disabled={!link} onClick={copyLink}><Copy size={17} strokeWidth={1.5} aria-hidden="true" /> Copy link</button>
    </div>
    <p className="muted" role="status">{feedback}</p>
  </section>;
}
