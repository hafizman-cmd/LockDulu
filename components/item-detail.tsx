"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Clock3, Copy, Download, ImagePlus, LockKeyhole, MessageCircle, Package, Ruler, ShieldCheck, Truck,
} from "lucide-react";
import { grades, money, statuses, timer, whatsapp, type GarmentView, type Quote } from "@/lib/catalog";
import type { readItem } from "@/lib/inventory";
import { action, forgetLock, json, message, readLocal, RequestError, savedLocks, saveLock, upload, useClock, usePolling, writeLocal, type SavedLock } from "./client";
import { Footer, Header, Notice, Sheet, Stage } from "./common";

type ItemData = NonNullable<Awaited<ReturnType<typeof readItem>>>;
type Delivery = { buyerName: string; buyerPhone: string; shippingAddress: string; fulfillmentType: "SHIP_NOW" | "HOLD_BOX" };
type LockResponse = { quote: Quote; serverTime: number };
type OrderState = { status: string; quote: Quote | null; code: string; serverTime: number };
type Completed = { orderId: string; code: string; status: string };
const defaultDelivery: Delivery = { buyerName: "", buyerPhone: "", shippingAddress: "", fulfillmentType: "SHIP_NOW" };
const photoNames = ["Front", "Back", "Tag"];
const deliveryKey = "lockdulu.delivery";

function Gallery({ item }: { item: GarmentView }) {
  const [index, setIndex] = useState(0);
  const [pin, setPin] = useState<number | null>(null);
  const touchdown = useRef(0);
  const go = (next: number) => { setIndex((next + item.images.length) % item.images.length); setPin(null); };
  return <div className="gallery">
    <div className="gallery-main" onTouchStart={event => { touchdown.current = event.changedTouches[0].clientX; }}
      onTouchEnd={event => {
        if (item.images.length < 2) return;
        const dx = event.changedTouches[0].clientX - touchdown.current;
        if (Math.abs(dx) > 48) go(index + (dx < 0 ? 1 : -1));
      }}>
      {item.images[index] ? <div className="gallery-photo">
        <img src={item.images[index]} alt={`${item.title} · ${photoNames[index] ?? "Photo"}`} draggable={false} />
        {index < 2 && item.flawPins.map((point, i) => (point.photo ?? "front") === (index === 0 ? "front" : "back") && <button key={i} className="flaw-pin" style={{ left: `${point.x}%`, top: `${point.y}%` }}
          aria-label={`View flaw ${i + 1}`} aria-pressed={i === pin} onClick={() => setPin(pin === i ? null : i)}>{i + 1}</button>)}
      </div> : <p className="muted">No photo available</p>}
      {item.images.length > 1 && <div className="gallery-arrows">
        <button className="icon-button" aria-label="Previous photo" onClick={() => go(index - 1)}><ChevronLeft size={20} strokeWidth={1.5} /></button>
        <button className="icon-button" aria-label="Next photo" onClick={() => go(index + 1)}><ChevronRight size={20} strokeWidth={1.5} /></button>
      </div>}
    </div>
    {pin !== null && <div className="pin-note" role="status"><b>{pin + 1}</b> {item.flawPins[pin]?.note}</div>}
    {item.images.length > 1 && <div className="thumbnails" aria-label="Garment photos">
      {item.images.map((image, i) => <button className={i === index ? "selected" : ""} key={i} onClick={() => go(i)} aria-pressed={i === index}>
        <img src={image} alt="" /><span>{photoNames[i] ?? "Photo"}</span>
      </button>)}
    </div>}
  </div>;
}

function Schematic({ item }: { item: GarmentView }) {
  return <div className="measurement surface">
    <div className="measure-title"><Ruler size={19} strokeWidth={1.5} /><h2>Garment measurements</h2></div>
    <div className="measure-content">
      <svg className="measure-diagram" viewBox="0 0 174 145" aria-label="Flat garment measurement diagram" role="img">
        {item.category === "Pants"
          ? <path d="M44 15H122L129 127H93L82 61L71 127H37Z" />
          : <path d="M18 37 57 15C66 29 95 29 105 15L142 37 124 70 110 62V126H50V62L35 70Z" />}
        {item.category === "Pants" ? <path className="measure-line" d="M45 25H121M45 20V30M121 20V30M140 15V126M135 15H145M135 126H145" />
          : <path className="measure-line" d="M51 65H109M51 60V70M109 60V70M135 19V126M130 19H140M130 126H140" />}
      </svg>
      <dl><div><dt>{item.category === "Pants" ? "Flat waist" : "Pit-to-pit"}</dt><dd>{item.pitInches} in</dd></div><div><dt>{item.category === "Pants" ? "Outseam" : "Labuh"}</dt><dd>{item.lengthInches} in</dd></div></dl>
    </div>
  </div>;
}

export function ItemDetail({ initial }: { initial: ItemData }) {
  const { id } = initial.item;
  const get = useCallback((signal?: AbortSignal) => json<ItemData>(`/api/item/${id}`, { signal }), [id]);
  const [data, setData] = usePolling(initial, get);
  const [lockTime, setLockTime] = useState(0);
  const now = useClock(Math.max(lockTime, data.serverTime));
  const [active, setActive] = useState<SavedLock | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [done, setDone] = useState<Completed | null>(null);
  const [delivery, setDelivery] = useState(defaultDelivery);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const item = data.item;
  const addressRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(() => get().then(next => setData(current => next.serverTime >= current.serverTime ? next : current)).catch(() => {}), [get, setData]);

  useEffect(() => {
    setDelivery(readLocal(deliveryKey, defaultDelivery));
    const stored = savedLocks().find(lock => lock.itemId === id &&
      (lock.submitted || !lock.lockedUntil || Date.parse(lock.lockedUntil) > initial.serverTime || initial.item.status === "PENDING_VERIFICATION"));
    if (!stored) return;
    setActive(stored);
    if (!stored.orderId) return;
    const aborter = new AbortController();
    action<OrderState>("order", { id: stored.orderId, token: stored.token }, aborter.signal).then(result => {
      if (aborter.signal.aborted) return;
      setLockTime(result.serverTime);
      if (result.quote) { setQuote(result.quote); setOpen(true); }
      else if (result.status === "PENDING_VERIFICATION" || result.status === "VERIFIED_PAID") {
        const submitted = { ...stored, submitted: true };
        saveLock(submitted); setActive(submitted);
        setDone({ orderId: stored.orderId!, code: result.code, status: result.status }); setOpen(true);
      } else if (result.status === "EXPIRED" || result.status === "REJECTED") {
        forgetLock(stored.token); setActive(null);
      }
    }).catch(() => {});
    return () => aborter.abort();
  }, [id, initial.item.status, initial.serverTime]);

  const itemUntil = item.lockedUntil ? Date.parse(item.lockedUntil) : 0;
  const quoteUntil = quote ? Date.parse(quote.lockedUntil) : 0;
  const remaining = Math.max(0, quoteUntil - now);
  const expired = !!quote && !remaining && !done;
  const isAvailable = item.status === "AVAILABLE" && item.locksOpen;
  const ownPending = !!active?.submitted && !!done;
  const running = !!quote && !expired && !done;

  useEffect(() => { if (expired) void refresh(); }, [expired, refresh]);
  const itemLockExpired = itemUntil > 0 && itemUntil <= now;
  useEffect(() => { if (itemLockExpired) void refresh(); }, [itemLockExpired, refresh]);

  async function startLock() {
    setError("");
    if (running || ownPending) { setOpen(true); return; }
    const retry = active && !active.submitted && !active.lockedUntil;
    const saved: SavedLock = retry ? active : {
      itemId: id, token: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""),
      storeSlug: data.store.storeSlug,
    };
    setBusy(true);
    setActive(saved);
    saveLock(saved);
    try {
      const result = await action<LockResponse>("lock", { id, token: saved.token });
      const reserved = { ...saved, orderId: result.quote.orderId, lockedUntil: result.quote.lockedUntil };
      saveLock(reserved);
      setActive(reserved); setQuote(result.quote); setLockTime(result.serverTime);
      setStep(1); setDone(null); setFile(null); setOpen(true);
    } catch (exception) {
      if (exception instanceof RequestError && exception.status === 409) {
        forgetLock(saved.token); setActive(null);
      }
      setError(message(exception));
    } finally { setBusy(false); void refresh(); }
  }

  function continueToPayment(event: React.FormEvent) {
    event.preventDefault();
    const normalized = delivery.buyerPhone.replace(/[\s()+-]/g, "").replace(/^0/, "60");
    if (!/^60[1-9]\d{7,9}$/.test(normalized)) { setError("Enter a valid Malaysian WhatsApp number."); return; }
    if (delivery.shippingAddress.trim().length < 8) { setError("Enter a complete delivery address."); addressRef.current?.focus(); return; }
    if (delivery.buyerName.trim().length < 2) { setError("Enter the buyer's name."); return; }
    writeLocal(deliveryKey, delivery);
    setError(""); setCopied(false); setStep(2);
  }

  async function sendReceipt(event: React.FormEvent) {
    event.preventDefault();
    if (!quote || !active || !file || expired) return;
    const form = new FormData();
    form.set("file", file); form.set("orderId", quote.orderId); form.set("token", active.token);
    form.set("delivery", JSON.stringify(delivery));
    setBusy(true); setError("");
    try {
      const result = await upload<{ orderId: string; code: string }>("receipt", form);
      const submitted = { ...active, submitted: true };
      saveLock(submitted); setActive(submitted); setDone({ ...result, status: "PENDING_VERIFICATION" }); setFile(null);
      void refresh();
    } catch (exception) { setError(message(exception)); }
    finally { setBusy(false); }
  }

  const storeHref = `/${data.store.storeSlug}`;
  const exact = quote && (delivery.fulfillmentType === "SHIP_NOW" ? quote.shipTotal : quote.itemAmount);
  const lockedByAnother = item.status === "LOCKED" && !running;
  const canRetry = active && !active.lockedUntil && item.status === "LOCKED";
  return <>
    <Header storeSlug={data.store.storeSlug} />
    <main className="wrap item-page">
      <Link className="breadcrumb" href={storeHref}><ChevronLeft size={18} strokeWidth={1.5} /> {data.store.storeName}</Link>
      <div className="detail-grid">
        <Gallery item={item} />
        <div className="detail-copy">
          <div className="detail-top"><span className="eyebrow">{item.code} / {item.category}</span><Stage item={item} now={now} /></div>
          <h1>{item.title}</h1><p className="muted">{item.brand}</p>
          <div className="detail-price">{money(item.price)}</div>
          <div className="condition surface"><h2>{grades[item.conditionGrade]}</h2><p>{item.conditionNotes || "No additional condition notes."}</p></div>
          <Schematic item={item} />
          <p className="detail-hint"><ShieldCheck size={18} strokeWidth={1.5} /> One piece available per listing. Receipt verification is handled by the seller.</p>
        </div>
      </div>
    </main>
    <Footer storeName={data.store.storeName} />
    <div className="item-cta glass">
      <div className="wrap cta-inner">
        <div className="cta-info"><b>{money(item.price)}</b><span>{lockedByAnother ? `Locked by another buyer · releases in ${timer(itemUntil - now)}` : !item.locksOpen ? "Locks open when the drop goes live" : item.status === "AVAILABLE" || running ? "10-minute reservation" : statuses[item.status]}</span></div>
        <button className="button primary" onClick={startLock} disabled={busy || (!isAvailable && !running && !ownPending && !canRetry)}>
          <LockKeyhole size={18} strokeWidth={1.5} />{busy ? "Working…" : ownPending ? "View order" : running ? "Resume checkout" : canRetry ? "Recover checkout" : isAvailable ? "Lock Item (10:00)" : lockedByAnother ? "Currently locked" : item.locksOpen ? statuses[item.status] : "Preview only"}
        </button>
        {!open && error && <Notice>{error}</Notice>}
      </div>
    </div>
    {open && (quote || done) && <Sheet title={done ? "Payment receipt received" : "Checkout"} onClose={() => { if (!busy) { setOpen(false); setError(""); } }}>
      {done ? <div className="stack">
        <div className="receipt-success"><ShieldCheck size={31} strokeWidth={1.5} /><p>{done.status === "VERIFIED_PAID" ? "The seller confirmed your payment." : "The seller will review your transfer. Your piece is reserved while payment is checked."}</p></div>
        <div className="order-ref"><span>{done.code}</span><strong>{done.orderId}</strong></div>
        <a className="button primary" href={whatsapp(data.store.whatsappNumber, `Hi, I submitted a LockDulu receipt for order ${done.orderId} (${done.code}).`)} target="_blank" rel="noreferrer"><MessageCircle size={18} strokeWidth={1.5} /> Message Seller on WhatsApp</a>
        <Link className="button" href="/locker">Open My Hold Box</Link>
      </div> : quote && (expired && !busy ? <div className="stack">
        <Notice>Your 10-minute lock has expired.</Notice><button className="button primary" onClick={() => { setOpen(false); setError(""); }}>Return to garment</button>
      </div> : <>
        <div className="checkout-status"><span>Step {step} of 2 · {step === 1 ? "Delivery" : "DuitNow payment"}</span><strong className="timer"><Clock3 size={17} strokeWidth={1.5} />{timer(remaining)}</strong></div>
        {step === 1 ? <form className="stack" onSubmit={continueToPayment}>
          <label>Buyer name<input required autoComplete="name" maxLength={100} value={delivery.buyerName} onChange={event => setDelivery({ ...delivery, buyerName: event.target.value })} /></label>
          <label>WhatsApp phone<input required type="tel" autoComplete="tel" maxLength={30} placeholder="012 345 6789" value={delivery.buyerPhone} onChange={event => setDelivery({ ...delivery, buyerPhone: event.target.value })} /></label>
          <label>Delivery address<input ref={addressRef} required autoComplete="street-address" maxLength={500} value={delivery.shippingAddress} onChange={event => setDelivery({ ...delivery, shippingAddress: event.target.value })} /></label>
          <fieldset className="delivery-options"><legend>Fulfillment</legend>
            <label className="surface"><input type="radio" name="fulfillment" checked={delivery.fulfillmentType === "SHIP_NOW"} onChange={() => setDelivery({ ...delivery, fulfillmentType: "SHIP_NOW" })} /><Truck size={21} strokeWidth={1.5} /><span><b>Ship Now</b><small>+{money(quote.shippingFee)} shipping</small></span></label>
            <label className="surface"><input type="radio" name="fulfillment" checked={delivery.fulfillmentType === "HOLD_BOX"} onChange={() => setDelivery({ ...delivery, fulfillmentType: "HOLD_BOX" })} /><Package size={21} strokeWidth={1.5} /><span><b>Save in Hold Box</b><small>Combine for up to {quote.holdBoxDays} days. Arrange parcel shipping with the seller.</small></span></label>
          </fieldset>
          {error && <Notice>{error}</Notice>}
          <button className="button primary">Continue to payment · {money(exact!)}</button>
        </form> : <form className="stack" onSubmit={sendReceipt}>
          <div className="qr-card surface">
            <img src={quote.qrCodeUrl} alt="Seller DuitNow QR" /><div><strong>{quote.qrAccountName}</strong><p>{quote.qrBankLabel}</p><b>{money(exact!)}</b></div>
          </div>
          {quote.qrCodeUrl === "/sample/duitnow.svg" && <p className="muted">Sample QR for checkout testing. Replace it with your seller’s DuitNow QR before accepting live payments.</p>}
          <div className="button-row"><a href={quote.qrCodeUrl} download className="button"><Download size={17} strokeWidth={1.5} /> Download QR</a>
            <button type="button" className="button" onClick={async () => {
              try { await navigator.clipboard.writeText(exact!); setCopied(true); setError(""); }
              catch { setError(`Copy the amount manually: ${exact}`); }
            }}><Copy size={17} strokeWidth={1.5} /> {copied ? "Amount copied" : "Copy Amount"}</button></div>
          <label className="file-field"><ImagePlus size={22} strokeWidth={1.5} /><span>{file?.name ?? "Payment Receipt Screenshot"}<small>Choose an image from your phone</small></span><input required type="file" accept="image/*" aria-label="Payment receipt screenshot" onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
          {error && <Notice>{error}</Notice>}
          <button className="button primary" disabled={busy || !file || expired}>{busy ? "Submitting receipt…" : "Submit payment receipt"}</button>
          <button className="text-button" type="button" disabled={busy} onClick={() => { setStep(1); setError(""); }}>Back to delivery</button>
        </form>}
      </>)}
    </Sheet>}
  </>;
}
