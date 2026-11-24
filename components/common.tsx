"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Box, Check, Clock3, Copy, LockKeyhole, Menu, Moon, Sun, Tag, X } from "lucide-react";
import { buyerStatus, grades, statuses, timer, type GarmentView } from "@/lib/catalog";
import { readLocal, savedLocks, writeLocal, type SavedLock } from "./client";

export function Brand() {
  return <Link className="wordmark" href="/" aria-label="LockDulu home"><span className="brand-mark"><Tag size={20} strokeWidth={1.5} /></span><span>LockDulu<span className="wordmark-dot">.</span></span></Link>;
}

export function Header({ storeSlug, seller = false }: { storeSlug?: string; seller?: boolean }) {
  const [dark, setDark] = useState<boolean | null>(null);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const preference = readLocal<boolean | null>("lockdulu.dark", null);
    if (preference !== null) document.documentElement.dataset.theme = preference ? "dark" : "light";
    setDark(preference ?? matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  return <header className="site-header glass">
    <div className="wrap header-inner">
      <Brand />
      <nav className="header-nav" aria-label="Main navigation">
        {storeSlug && <Link className="desktop-nav" href={`/${storeSlug}`}>Storefront</Link>}
        <Link className="desktop-nav" href="/">Browse shops</Link>
        <Link className="desktop-nav" href={seller ? "/dashboard" : "/locker"}>{seller ? "Dashboard" : "My orders"}</Link>
      </nav>
      <div className="header-actions">
        <Link href={seller ? `/${storeSlug ?? ""}` : "/locker"} className="icon-button header-locker" aria-label={seller ? "Storefront" : "My orders"}>{seller ? <Tag size={19} strokeWidth={1.5} /> : <Box size={19} strokeWidth={1.5} />}</Link>
        <button className="icon-button" aria-label="Toggle dark mode" onClick={() => {
          const next = !dark;
          setDark(next);
          document.documentElement.dataset.theme = next ? "dark" : "light";
          writeLocal("lockdulu.dark", next);
        }}>{dark ? <Sun size={19} strokeWidth={1.5} /> : <Moon size={19} strokeWidth={1.5} />}</button>
        <button className="icon-button menu-trigger" aria-expanded={menu} aria-controls="header-menu" aria-label="Navigation menu" onClick={() => setMenu(!menu)}>{menu ? <X size={19} strokeWidth={1.5} /> : <Menu size={19} strokeWidth={1.5} />}</button>
      </div>
      {menu && <nav id="header-menu" className="surface mobile-menu" aria-label="Navigation">
        {storeSlug && <Link href={`/${storeSlug}`} onClick={() => setMenu(false)}>Storefront</Link>}
        <Link href="/" onClick={() => setMenu(false)}>Browse shops</Link>
        <Link href="/locker" onClick={() => setMenu(false)}>My orders</Link>
        <Link href="/dashboard" onClick={() => setMenu(false)}>Seller dashboard</Link>
      </nav>}
    </div>
  </header>;
}

export function Footer({ storeName }: { storeName?: string }) {
  return <footer className="site-footer"><div className="wrap footer-inner"><Brand /><span>{storeName ?? "Live vintage drops"}</span><Link href="/dashboard">Seller dashboard</Link></div></footer>;
}

export function GarmentPhoto({ src, alt, className, loading, onUnavailable }: {
  src?: string; alt: string; className?: string; loading?: "lazy" | "eager"; onUnavailable?: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return <div className={`photo-unavailable ${className ?? ""}`} role="img" aria-label="Photo unavailable">Photo unavailable</div>;
  }
  return <img src={src} alt={alt} className={className} loading={loading} draggable={false} onError={() => { setFailedSrc(src); onUnavailable?.(); }} />;
}

export function Stage({ item, now, showCondition = false, buyer = false }: { item: GarmentView; now: number; showCondition?: boolean; buyer?: boolean }) {
  const remaining = item.lockedUntil ? new Date(item.lockedUntil).getTime() - now : 0;
  const label = item.status === "LOCKED" ? `Locked · ${timer(remaining)}`
    : item.status === "AVAILABLE" && !item.locksOpen ? "Preview"
    : item.status === "AVAILABLE" && showCondition ? grades[item.conditionGrade] : buyer ? buyerStatus(item.status) : statuses[item.status];
  const badgeStatus = buyer && item.status === "HOLD_BOX" ? "SOLD" : item.status;
  return <span className={`badge badge-${badgeStatus.toLowerCase()}`}>
    {item.status === "LOCKED" && <LockKeyhole size={12} strokeWidth={1.5} />}
    {item.status === "PENDING_VERIFICATION" && <Clock3 size={12} strokeWidth={1.5} />}
    {label}
  </span>;
}

export function Sheet({ title, children, onClose, className = "" }: {
  title: string; children: React.ReactNode; onClose: () => void; className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { element.close(); document.body.style.overflow = previous; };
  }, []);
  return <dialog ref={dialog} aria-label={title} className={`sheet glass ${className}`}
    onCancel={event => {
      if (event.target !== event.currentTarget) return;
      event.preventDefault(); onClose();
    }}
    onClick={event => {
      if (event.target !== dialog.current) return;
      const box = event.currentTarget.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose();
    }}>
    <div className="sheet-head"><h2>{title}</h2><button className="icon-button" aria-label="Close" onClick={onClose}><X size={21} strokeWidth={1.5} /></button></div>
    {children}
  </dialog>;
}

export function Notice({ children, success = false }: { children: React.ReactNode; success?: boolean }) {
  const Icon = success ? Check : AlertCircle;
  return <p className={`notice ${success ? "success" : ""}`} role={success ? "status" : "alert"}><Icon size={18} strokeWidth={1.5} />{children}</p>;
}

export function AvailabilityNotice({ serverTime }: { serverTime: number }) {
  const confirmed = new Date(serverTime);
  return <p className="muted" role="status">Availability may be out of date. Last checked at{" "}
    <time dateTime={confirmed.toISOString()}>{confirmed.toLocaleTimeString("en-MY", { hour: "numeric", minute: "2-digit" })}</time>.
    Check your connection to refresh.</p>;
}

export function OrderReference({ number, showHint = false }: { number: string; showHint?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState("");
  return <div className="order-reference">
    <label>Order number<input ref={input} readOnly value={number} /></label>
    <button type="button" className="icon-button" aria-label="Copy order number" title="Copy order number" onClick={async () => {
      try {
        await navigator.clipboard.writeText(number);
        setFeedback("Order number copied.");
      } catch {
        input.current?.focus();
        input.current?.select();
        setFeedback("Order number selected. Copy it from the field.");
      }
    }}><Copy size={18} strokeWidth={1.5} /></button>
    {showHint && <p className="muted">Save this number to track your order in My orders.</p>}
    <p role="status" className="muted">{feedback}</p>
  </div>;
}

export function ActiveLock({ slug, now }: { slug: string; now: number }) {
  const [locks, setLocks] = useState<SavedLock[]>([]);
  useEffect(() => {
    const load = () => setLocks(savedLocks());
    load();
    window.addEventListener("storage", load);
    window.addEventListener("lockdulu-lock", load);
    return () => { window.removeEventListener("storage", load); window.removeEventListener("lockdulu-lock", load); };
  }, []);
  const active = locks.filter(entry => entry.storeSlug === slug && !entry.submitted && entry.lockedUntil && Date.parse(entry.lockedUntil) > now)
    .sort((a, b) => Date.parse(a.lockedUntil!) - Date.parse(b.lockedUntil!))[0];
  return active ? <Link className="active-pill glass" href={`/item/${active.itemId}`}>
    <LockKeyhole size={17} strokeWidth={1.5} /><span>Resume checkout</span><strong>{timer(Date.parse(active.lockedUntil!) - now)}</strong>
  </Link> : null;
}
