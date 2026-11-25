"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ChevronRight, Clock3, Copy, Download, ImagePlus, LockKeyhole, MessageCircle, Package, Ruler, ShieldCheck, Truck,
} from "lucide-react";
import { buyerStatus, grades, malaysiaTime, money, rejectionMessage, timer, whatsapp, type GarmentView, type Quote } from "@/lib/catalog";
import type { readItem } from "@/lib/inventory";
import { action, forgetLock, json, message, randomToken, readLocal, removeLocal, RequestError, savedLocks, saveLock, upload, useClock, usePolling, writeLocal, type SavedLock } from "./client";
import { AvailabilityNotice, Footer, GarmentPhoto, Header, Notice, OrderReference, Sheet, Stage } from "./common";

type ItemData = NonNullable<Awaited<ReturnType<typeof readItem>>>;
type Delivery = { buyerName: string; buyerPhone: string; shippingAddress: string; fulfillmentType: "SHIP_NOW" | "HOLD_BOX" };
type LockResponse = { quote: Quote; serverTime: number };
type OrderStatus = "AWAITING_RECEIPT" | "PENDING_VERIFICATION" | "VERIFIED_PAID" | "REJECTED" | "EXPIRED";
type OrderState = {
  status: OrderStatus; quote: Quote | null; code: string; serverTime: number; rejectionReason: string | null; delivery: Delivery | null; paymentTotal: string | null;
};
type Completed = { orderId: string; code: string; status: Exclude<OrderStatus, "AWAITING_RECEIPT">; rejectionReason?: string | null };
const defaultDelivery: Delivery = { buyerName: "", buyerPhone: "", shippingAddress: "", fulfillmentType: "SHIP_NOW" };
const photoNames = ["Front", "Back", "Tag"];
const deliveryKey = "lockdulu.rememberedDelivery";

function Gallery({ item }: { item: GarmentView }) {
  const [index, setIndex] = useState(0);
  const [pin, setPin] = useState<number | null>(null);
  const [loadedPhoto, setLoadedPhoto] = useState<string | null>(null);
  const touchdown = useRef(0);
  const photo = item.images[index];
  const photoName = photoNames[index] ?? "Photo";
  const photoLoaded = !!photo && loadedPhoto === photo;
  const markPhotoLoaded = useCallback((image: HTMLImageElement | null) => {
    if (photo && image?.naturalWidth && image.naturalHeight) setLoadedPhoto(photo);
  }, [photo]);
  const go = (next: number) => { setIndex((next + item.images.length) % item.images.length); setPin(null); };
  return <div className="gallery">
    <div className="gallery-main" onTouchStart={event => { touchdown.current = event.changedTouches[0].clientX; }}
      onTouchEnd={event => {
        if (item.images.length < 2) return;
        const dx = event.changedTouches[0].clientX - touchdown.current;
        if (Math.abs(dx) > 48) go(index + (dx < 0 ? 1 : -1));
      }}>
      <div className="gallery-photo">
        <GarmentPhoto key={photo} src={photo} alt={`${item.title} · ${photoName}`}
          ref={markPhotoLoaded} onLoad={event => markPhotoLoaded(event.currentTarget)}
          onUnavailable={() => setLoadedPhoto(current => current === photo ? null : current)} />
        {photoLoaded && index < 2 && item.flawPins.map((point, i) => (point.photo ?? "front") === (index === 0 ? "front" : "back") && <button key={i} className="flaw-pin" style={{ left: `${point.x}%`, top: `${point.y}%` }}
          aria-label={`View flaw ${i + 1} on ${photoName.toLowerCase()} photo`} aria-pressed={i === pin} onClick={() => setPin(pin === i ? null : i)}>{i + 1}</button>)}
      </div>
      {item.images.length > 1 && <div className="gallery-arrows">
        <button className="icon-button" aria-label="Previous photo" onClick={() => go(index - 1)}><ChevronLeft size={20} strokeWidth={1.5} /></button>
        <button className="icon-button" aria-label="Next photo" onClick={() => go(index + 1)}><ChevronRight size={20} strokeWidth={1.5} /></button>
      </div>}
    </div>
    {photoLoaded && pin !== null && item.flawPins[pin] && <div className="pin-note" role="status"><b>{pin + 1}</b> {item.flawPins[pin].note}</div>}
    {item.images.length > 1 && <div className="thumbnails" role="group" aria-label="Garment photos">
      {item.images.map((image, i) => <button className={i === index ? "selected" : ""} key={i} onClick={() => go(i)} aria-pressed={i === index}>
        <GarmentPhoto src={image} alt="" /><span>{photoNames[i] ?? "Photo"}</span>
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
  const router = useRouter();
  const get = useCallback(async (signal?: AbortSignal) => {
    try { return await json<ItemData>(`/api/item/${id}`, { signal }); }
    catch (error) {
      if (error instanceof RequestError && error.status === 404) router.refresh();
      throw error;
    }
  }, [id, router]);
  const [data, setData, stale] = usePolling(initial, get);
  const [initialServerTime] = useState(initial.serverTime);
  const [lockTime, setLockTime] = useState(0);
  const now = useClock(Math.max(lockTime, data.serverTime));
  const [active, setActive] = useState<SavedLock | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [done, setDone] = useState<Completed | null>(null);
  const [delivery, setDelivery] = useState(defaultDelivery);
  const [rememberDelivery, setRememberDelivery] = useState(false);
  const [preparedTotal, setPreparedTotal] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [pendingRecovery, setPendingRecovery] = useState<SavedLock | null>(null);
  const [receiptUnconfirmed, setReceiptUnconfirmed] = useState(false);
  const [expandedQr, setExpandedQr] = useState(false);
  const [qrFailed, setQrFailed] = useState(false);
  const [qrRetry, setQrRetry] = useState(0);
  const item = data.item;
  const addressRef = useRef<HTMLInputElement>(null);
  const restoreRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(() => get().then(next => setData(current => next.serverTime >= current.serverTime ? next : current)).catch(() => {}), [get, setData]);

  const rememberOrder = useCallback((stored: SavedLock, result: Completed) => {
    const saved = { ...stored, submitted: result.status !== "EXPIRED" };
    saveLock(saved);
    setActive(saved);
    setDone(result);
    setQuote(null);
    setFile(null);
    setReceiptUnconfirmed(false);
  }, []);

  const recoverCheckout = useCallback(async (stored: SavedLock, showOutcome: boolean) => {
    const { orderId, token } = stored;
    if (!orderId || restoreRequest.current) return;
    const aborter = new AbortController();
    restoreRequest.current = aborter;
    setRestoring(true);
    try {
      const result = await action<OrderState>("order", { id: orderId, token }, aborter.signal);
      if (aborter.signal.aborted) return;
      setLockTime(result.serverTime);
      if (result.quote) {
        setQuote(result.quote);
        if (result.delivery) setDelivery(result.delivery);
        setPreparedTotal(result.paymentTotal);
        setStep(result.paymentTotal ? 2 : 1);
        setOpen(true);
      } else if (result.status !== "AWAITING_RECEIPT") {
        rememberOrder(stored, { orderId, code: result.code, status: result.status, rejectionReason: result.rejectionReason });
        if (showOutcome || result.status === "PENDING_VERIFICATION") setOpen(true);
      }
      setPendingRecovery(null);
      setError("");
    } catch (exception) {
      if (aborter.signal.aborted) return;
      if (exception instanceof RequestError && exception.status === 404) setPendingRecovery(null);
      setError(`Could not recover your checkout. ${message(exception)}`);
    } finally {
      if (restoreRequest.current === aborter) {
        restoreRequest.current = null;
        setRestoring(false);
      }
    }
  }, [rememberOrder]);

  useEffect(() => {
    removeLocal("lockdulu.delivery");
    const savedDelivery = readLocal<Delivery | null>(deliveryKey, null);
    if (savedDelivery) { setDelivery(savedDelivery); setRememberDelivery(true); }
    const locks = savedLocks().filter(lock => lock.itemId === id);
    const stored = locks.find(lock => !lock.submitted && (!lock.lockedUntil || Date.parse(lock.lockedUntil) > initialServerTime)) ??
      locks.find(lock => lock.submitted || lock.orderId);
    if (!stored) return;
    setActive(stored);
    setPendingRecovery(stored.orderId ? stored : null);
    return () => { restoreRequest.current?.abort(); };
  }, [id, initialServerTime]);

  useEffect(() => {
    if (!pendingRecovery) return;
    const recover = () => {
      if (navigator.onLine && document.visibilityState !== "hidden") void recoverCheckout(pendingRecovery, false);
    };
    recover();
    window.addEventListener("online", recover);
    window.addEventListener("pageshow", recover);
    document.addEventListener("visibilitychange", recover);
    return () => {
      window.removeEventListener("online", recover);
      window.removeEventListener("pageshow", recover);
      document.removeEventListener("visibilitychange", recover);
    };
  }, [pendingRecovery, recoverCheckout]);

  const itemUntil = item.lockedUntil ? Date.parse(item.lockedUntil) : 0;
  const quoteUntil = quote ? Date.parse(quote.lockedUntil) : 0;
  const remaining = Math.max(0, quoteUntil - now);
  const expired = !!quote && !remaining && !done;
  const paymentUnavailable = item.status === "AVAILABLE" && item.locksOpen && !data.store.paymentReady;
  const isAvailable = item.status === "AVAILABLE" && item.locksOpen && data.store.paymentReady;
  const canViewOrder = !!done && done.status !== "EXPIRED" && done.status !== "REJECTED";
  const running = !!quote && !expired && !done;
  const canRetry = !!pendingRecovery || (active && !active.submitted && !quote && !done &&
    (item.status === "LOCKED" || item.status === "PENDING_VERIFICATION" || item.status === "HOLD_BOX" || item.status === "SOLD") &&
    (!active.lockedUntil || !!active.orderId));

  useEffect(() => { if (expired) void refresh(); }, [expired, refresh]);
  const itemLockExpired = itemUntil > 0 && itemUntil <= now;
  useEffect(() => { if (itemLockExpired) void refresh(); }, [itemLockExpired, refresh]);

  useEffect(() => {
    if (done?.status !== "PENDING_VERIFICATION" || !active) return;
    const aborter = new AbortController();
    const order = done;
    const token = active.token;
    let checking = false;
    async function checkPayment() {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const { status, rejectionReason } = await action<OrderState>("order", { id: order.orderId, token }, aborter.signal);
        if (aborter.signal.aborted || (status !== "VERIFIED_PAID" && status !== "REJECTED")) return;
        setDone({ ...order, status, rejectionReason });
        void refresh();
      } catch { /* Keep the last known status until the next check. */ }
      finally { checking = false; }
    }
    const check = () => void checkPayment();
    const interval = window.setInterval(check, 4000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    window.addEventListener("pageshow", check);
    return () => {
      aborter.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      window.removeEventListener("pageshow", check);
    };
  }, [active, done, refresh]);

  async function startLock() {
    setError("");
    if (running || canViewOrder) { setOpen(true); return; }
    if (canRetry && active?.orderId) {
      await recoverCheckout(active, true);
      return;
    }
    const retry = active && !active.submitted && !active.lockedUntil;
    const saved: SavedLock = retry ? active : {
      itemId: id, token: randomToken(),
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
      setStep(1); setPreparedTotal(null); setDone(null); setFile(null); setReceiptUnconfirmed(false); setOpen(true);
      setExpandedQr(false); setQrFailed(false); setQrRetry(0);
    } catch (exception) {
      if (exception instanceof RequestError && exception.status === 409) {
        forgetLock(saved.token); setActive(null);
      }
      setError(message(exception));
    } finally { setBusy(false); void refresh(); }
  }

  async function continueToPayment(event: React.FormEvent) {
    event.preventDefault();
    if (!quote || !active || busy || expired) return;
    const normalized = delivery.buyerPhone.replace(/[\s()+-]/g, "").replace(/^0/, "60");
    if (!/^60[1-9]\d{7,9}$/.test(normalized)) { setError("Enter a valid Malaysian WhatsApp number."); return; }
    if (delivery.shippingAddress.trim().length < 8) { setError("Enter a complete delivery address."); addressRef.current?.focus(); return; }
    if (delivery.buyerName.trim().length < 2) { setError("Enter the buyer's name."); return; }
    setBusy(true); setError("");
    try {
      const { total } = await action<{ total: string }>("preparePayment", { id: quote.orderId, token: active.token, delivery });
      if (rememberDelivery) writeLocal(deliveryKey, delivery);
      setPreparedTotal(total);
      setCopied(false); setStep(2);
    } catch (exception) {
      setError(message(exception));
      if (exception instanceof RequestError && exception.status === 409) {
        await checkReceipt(active, quote.orderId).catch(() => {});
      }
    } finally { setBusy(false); }
  }

  async function checkReceipt(order: SavedLock, orderId: string) {
    const result = await action<OrderState>("order", { id: orderId, token: order.token });
    setLockTime(result.serverTime);
    if (result.status === "AWAITING_RECEIPT") return false;
    rememberOrder(order, { orderId, code: result.code, status: result.status, rejectionReason: result.rejectionReason });
    setError("");
    void refresh();
    return true;
  }

  async function retryReceiptCheck() {
    if (!active?.orderId || busy) return;
    setBusy(true);
    try {
      if (!await checkReceipt(active, active.orderId)) {
        setReceiptUnconfirmed(false);
        setError("The receipt has not arrived. If you paid, upload the screenshot again.");
      }
    } catch {
      setError("Could not check the receipt. Keep your bank reference and try checking again when reconnected.");
    } finally { setBusy(false); }
  }

  async function sendReceipt(event: React.FormEvent) {
    event.preventDefault();
    if (!quote || !active || !file || !preparedTotal || expired || receiptUnconfirmed || busy) return;
    const form = new FormData();
    form.set("file", file);
    form.set("delivery", JSON.stringify(delivery));
    setBusy(true); setError("");
    try {
      const result = await upload<Completed>("receipt", form, { orderId: quote.orderId, token: active.token });
      rememberOrder(active, result);
      void refresh();
    } catch (exception) {
      try {
        if (!await checkReceipt(active, quote.orderId)) {
          setError(exception instanceof RequestError && exception.status === 409
            ? `${message(exception)} If you already paid, contact the seller with your order number before paying again.`
            : `${message(exception)} If you already paid, retry the receipt upload for this order.`);
        }
      } catch {
        setReceiptUnconfirmed(true);
        setError("Could not confirm whether the receipt arrived. Keep your bank reference and check receipt status before retrying.");
      }
    }
    finally { setBusy(false); }
  }

  function backToPreviousPage(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const navigation = (window as Window & { navigation?: { canGoBack: boolean } }).navigation;
    const loadedUrl = performance.getEntriesByType("navigation")[0]?.name;
    // Some browsers count an initial blank tab in history.length.
    const hasPrevious = navigation?.canGoBack ?? (window.history.length > 1 &&
      (!!document.referrer || (!!loadedUrl && loadedUrl !== window.location.href)));
    if (!hasPrevious) return;
    event.preventDefault();
    router.back();
  }

  const storeHref = `/${data.store.storeSlug}`;
  const exact = quote && (delivery.fulfillmentType === "SHIP_NOW" ? quote.shipTotal : quote.itemAmount);
  const lockedByAnother = item.status === "LOCKED" && !running && !canRetry;
  const expiredOrder = done?.status === "EXPIRED" || expired;
  const reference = done?.orderId ?? quote?.orderId;
  const trackerHref = reference ? `/locker?order=${encodeURIComponent(reference)}` : "/locker";
  const needsHelp = expiredOrder || done?.status === "REJECTED";
  const sellerLink = whatsapp(data.store.whatsappNumber, needsHelp
    ? `Hi, I need help with a DuitNow transfer for LockDulu order ${reference} (${item.code}).`
    : `Hi, I have a question about LockDulu order ${reference} (${item.code}).`);
  return <>
    <Header storeSlug={data.store.storeSlug} />
    <main className="wrap item-page">
      <Link className="breadcrumb" href={storeHref} replace prefetch={false} onClick={backToPreviousPage}>
        <ChevronLeft size={18} strokeWidth={1.5} aria-hidden="true" /> Back
      </Link>
      <div className="detail-grid">
        <Gallery item={item} />
        <div className="detail-copy">
          <div className="detail-top"><span className="eyebrow">{item.code} / {item.category}</span><Stage item={item} now={now} buyer /></div>
          <h1>{item.title}</h1><p className="muted">{item.brand}</p>
          <div className="detail-price">{money(item.price)}</div>
          <div className="condition surface">
            <h2>{grades[item.conditionGrade]}</h2>
            <p>{item.conditionNotes || "No additional condition notes."}</p>
            {item.flawPins.length > 0 && <div className="flaw-notes">
              <h3>Flaw notes</h3>
              <ol role="list">
                {item.flawPins.map((point, i) => <li key={i}>
                  <strong>{photoNames[point.photo === "back" ? 1 : 0]} photo</strong> <span>{point.note}</span>
                </li>)}
              </ol>
            </div>}
          </div>
          <Schematic item={item} />
          <p className="detail-hint"><ShieldCheck size={18} strokeWidth={1.5} /> One piece available per listing. Receipt verification is handled by the seller.</p>
          {stale && <AvailabilityNotice serverTime={data.serverTime} />}
          {paymentUnavailable && <Notice>This shop hasn’t set up payments yet. Check back later or ask the seller.</Notice>}
          {reference && needsHelp && <button type="button" className="button" onClick={() => setOpen(true)}>Get help with your previous order</button>}
        </div>
      </div>
    </main>
    <Footer storeName={data.store.storeName} />
    <div className="item-cta glass">
      <div className="wrap cta-inner">
        <div className="cta-info"><b>{money(item.price)}</b><span>{lockedByAnother ? `Locked by another buyer · releases in ${timer(itemUntil - now)}` : running ? "10-minute reservation" : item.status === "AVAILABLE" ? (item.locksOpen ? "10-minute reservation" : "Locks open when the drop goes live") : buyerStatus(item.status)}</span></div>
        <button className="button primary" onClick={startLock} disabled={busy || restoring || (!isAvailable && !running && !canViewOrder && !canRetry)}>
          <LockKeyhole size={18} strokeWidth={1.5} />{busy || restoring ? "Working…" : canViewOrder ? "View order" : running ? "Resume checkout" : canRetry ? "Recover checkout" : isAvailable ? "Lock Item (10:00)" : paymentUnavailable ? "Payment unavailable" : lockedByAnother ? "Currently locked" : item.status === "AVAILABLE" ? "Preview only" : buyerStatus(item.status)}
        </button>
        {!open && error && <Notice>{error}</Notice>}
      </div>
    </div>
    {open && (quote || done) && <Sheet title={done?.status === "EXPIRED" || expired && !busy ? "Reservation expired" : done?.status === "VERIFIED_PAID" ? "Payment confirmed" : done?.status === "REJECTED" ? "Payment receipt rejected" : done ? "Payment receipt received" : "Checkout"} closeDisabled={busy} onClose={() => { setOpen(false); setError(""); }}>
      {done?.status === "EXPIRED" || expired && !busy ? <div className="stack">
        <Notice>Your ten-minute reservation ended. The garment may now be available to another buyer.</Notice>
        {reference && <OrderReference key={reference} number={reference} showHint />}
        <p>If you already transferred the money, keep your bank reference and contact the seller before making another payment.</p>
        {data.store.whatsappNumber && <a className="button" href={sellerLink} target="_blank" rel="noreferrer"><MessageCircle size={18} strokeWidth={1.5} /> Message seller</a>}
        {done?.status !== "EXPIRED" && <button className="button" disabled={busy} onClick={retryReceiptCheck}>Check receipt status</button>}
        {error && <Notice>{error}</Notice>}
        <Link href={trackerHref} className="button primary">Already transferred? Open My orders</Link>
        <button className="text-button" disabled={busy} onClick={() => { setOpen(false); setError(""); }}>Return to garment</button>
      </div> : done ? <div className="stack">
        {done.status === "REJECTED" ? <Notice>{rejectionMessage(done.rejectionReason)}</Notice> :
          <div className="receipt-success" role="status"><ShieldCheck size={31} strokeWidth={1.5} /><p>{done.status === "VERIFIED_PAID" ? "The seller confirmed your payment." : "The seller will review your transfer. Your piece is reserved while payment is checked."}</p></div>}
        <OrderReference key={done.orderId} number={done.orderId} showHint />
        {data.store.whatsappNumber && <a className="button" href={sellerLink} target="_blank" rel="noreferrer"><MessageCircle size={18} strokeWidth={1.5} /> Message seller on WhatsApp</a>}
        <Link className={"button" + (done.status === "REJECTED" ? " primary" : "")} href={trackerHref}>Open My orders</Link>
      </div> : quote && <>
        <div className="checkout-status"><span role="status">Step {step} of 2 · {step === 1 ? "Delivery" : "DuitNow payment"}</span><strong className="timer"><Clock3 size={17} aria-hidden="true" />{timer(remaining)} left</strong></div>
        {step === 1 ? <form className="stack" onSubmit={continueToPayment}>
          <p className="muted">Your reservation covers delivery details, the bank transfer, and receipt upload.</p>
          <fieldset className="stack" disabled={busy}>
          <label>Buyer name<input required autoComplete="name" maxLength={100} value={delivery.buyerName} onChange={event => setDelivery({ ...delivery, buyerName: event.target.value })} /></label>
          <label>WhatsApp phone<input required type="tel" autoComplete="tel" maxLength={30} placeholder="012 345 6789" value={delivery.buyerPhone} onChange={event => setDelivery({ ...delivery, buyerPhone: event.target.value })} /></label>
          <label>Delivery address<input ref={addressRef} required autoComplete="street-address" maxLength={500} value={delivery.shippingAddress} onChange={event => setDelivery({ ...delivery, shippingAddress: event.target.value })} /></label>
          <label><input type="checkbox" checked={rememberDelivery} onChange={event => {
            setRememberDelivery(event.target.checked);
            if (!event.target.checked) removeLocal(deliveryKey);
          }} /> Remember my delivery details in this browser</label>
          <fieldset className="delivery-options"><legend>Fulfillment</legend>
            <label className="surface"><input type="radio" name="fulfillment" checked={delivery.fulfillmentType === "SHIP_NOW"} onChange={() => setDelivery({ ...delivery, fulfillmentType: "SHIP_NOW" })} /><Truck size={21} strokeWidth={1.5} /><span><b>Ship Now</b><small>+{money(quote.shippingFee)} shipping</small></span></label>
            <label className="surface"><input type="radio" name="fulfillment" checked={delivery.fulfillmentType === "HOLD_BOX"} onChange={() => setDelivery({ ...delivery, fulfillmentType: "HOLD_BOX" })} /><Package size={21} strokeWidth={1.5} /><span><b>Save in Hold Box</b><small>Request dispatch within {quote.holdBoxDays} days of payment approval. Arrange combined shipping with the seller.</small></span></label>
          </fieldset>
          </fieldset>
          {error && <Notice>{error}</Notice>}
          <button className="button primary" disabled={busy}>{busy ? "Checking reservation…" : `Continue to payment · ${money(exact!)}`}</button>
        </form> : <form className="stack" onSubmit={sendReceipt}>
          <section className="checkout-payment stack" aria-labelledby="payment-heading">
            <h3 id="payment-heading">Pay with DuitNow QR</h3>
            <div className={`qr-card surface${expandedQr ? " qr-expanded" : ""}`}>
              <div className="payment-payee">
                <b>{money(preparedTotal!)}</b><strong>{quote.qrAccountName}</strong><p className="muted">{quote.qrBankLabel}</p>
              </div>
              {qrFailed ? <button type="button" className="button" onClick={() => { setQrFailed(false); setQrRetry(current => current + 1); }}>Retry QR image</button> :
                <img id="seller-payment-qr" src={qrRetry ? `${quote.qrCodeUrl}?retry=${qrRetry}` : quote.qrCodeUrl} alt="Seller DuitNow QR" onError={() => setQrFailed(true)} />}
            </div>
            {receiptUnconfirmed ? <p>Check whether your receipt arrived before trying again.</p> :
              <p>Transfer this exact amount to the payee shown. Return here and submit your screenshot by <strong><time dateTime={quote.lockedUntil}>{malaysiaTime.format(quoteUntil)} Malaysia time</time></strong> to keep your reservation.</p>}
            {qrFailed && <Notice>The QR image could not load. Retry it before transferring.</Notice>}
            {quote.qrCodeUrl === "/sample/duitnow.svg" && <p className="muted">Sample QR for checkout testing. It cannot receive a payment.</p>}
            {!qrFailed && !receiptUnconfirmed && <div className="stack">
              <p className="muted">Paying on this phone? Download the QR, then choose it from your banking app’s QR gallery.</p>
              <div className="button-row">
                <a href={quote.qrCodeUrl} download className="button"><Download size={17} aria-hidden="true" /> Download DuitNow QR</a>
                <button type="button" className="button" aria-expanded={expandedQr} aria-controls="seller-payment-qr" onClick={() => setExpandedQr(current => !current)}>{expandedQr ? "Smaller QR" : "Enlarge QR"}</button>
                <button type="button" className="button" onClick={async () => {
                  try { await navigator.clipboard.writeText(preparedTotal!); setCopied(true); setError(""); }
                  catch { setError(`Copy the amount manually: ${preparedTotal}`); }
                }}><Copy size={17} aria-hidden="true" /> {copied ? "Amount copied" : "Copy amount"}</button>
              </div>
            </div>}
            <div className="button-row">
              <button className="text-button" type="button" disabled={busy || receiptUnconfirmed} onClick={() => { setStep(1); setError(""); }}>Edit delivery before paying</button>
              <button className="text-button" type="button" onClick={() => document.getElementById("checkout-receipt-heading")?.focus()}>
                {receiptUnconfirmed ? "Go to receipt status" : "Already paid? Go to upload"}
              </button>
            </div>
          </section>
          <section className="checkout-receipt stack" aria-labelledby="checkout-receipt-heading">
            <h3 id="checkout-receipt-heading" tabIndex={-1}>{receiptUnconfirmed ? "Check your receipt status" : "Upload your payment receipt"}</h3>
            <div hidden={receiptUnconfirmed}>
              <label className="file-field"><ImagePlus size={22} aria-hidden="true" /><span>{file?.name ?? "Choose payment screenshot"}<small>Make sure the amount and bank reference are readable.</small></span><input required type="file" accept="image/jpeg,image/png,image/webp,image/heif,image/heic,image/avif" aria-label="Payment receipt screenshot" disabled={busy || receiptUnconfirmed} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
            </div>
            {error && <Notice>{error}</Notice>}
            {error && data.store.whatsappNumber && <a className="text-button" href={sellerLink} target="_blank" rel="noreferrer">Already paid? Contact the seller</a>}
            {receiptUnconfirmed ? <button className="button primary" type="button" disabled={busy} onClick={retryReceiptCheck}>{busy ? "Checking receipt…" : "Check receipt status"}</button> :
              <button className="button primary" disabled={busy || !file || expired}>{busy ? "Submitting receipt…" : "Submit payment receipt"}</button>}
          </section>
          <OrderReference key={quote.orderId} number={quote.orderId} />
        </form>}
      </>}
    </Sheet>}
  </>;
}
