"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Box, Check, ChevronDown, ExternalLink, ImagePlus, LayoutGrid, LogOut, PackageCheck, Plus, QrCode, ReceiptText, Settings, ShieldCheck, Trash2, X,
} from "lucide-react";
import { measurements, money, statuses, whatsapp } from "@/lib/catalog";
import type { DashboardData } from "@/lib/seller";
import { action, message, useClock, usePolling } from "./client";
import { Footer, Header, Notice, Sheet, Stage } from "./common";
import { QuickList, StoreSettings } from "./seller-forms";

const tabs = [
  { key: "receipts", label: "Receipts", icon: ReceiptText },
  { key: "inventory", label: "Inventory", icon: LayoutGrid },
  { key: "hold", label: "Hold Box", icon: Box },
  { key: "settings", label: "Settings", icon: Settings },
] as const;

export function SellerLogin() {
  const router = useRouter();
  const [registering, setRegistering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdHandle, setCreatedHandle] = useState("");

  return <>
    <Header seller />
    <main className="wrap secondary-page"><div className="section-intro">
      <span className="eyebrow"><ShieldCheck size={17} strokeWidth={1.5} /> Seller tools</span>
      <h1>{registering ? "Create your shop" : "Seller sign in"}</h1>
      <p>{registering ? "Create an account to manage your shop." : "Manage your live inventory and verify DuitNow receipts."}</p>
    </div>
    <form key={registering ? "register" : "login"} className="surface stack lookup" onSubmit={async event => {
      event.preventDefault(); setError(""); setBusy(true);
      const form = new FormData(event.currentTarget);
      const slug = form.get("slug");
      const password = form.get("password");
      try {
        if (registering) {
          if (password !== form.get("confirmPassword")) throw new Error("Passwords do not match.");
          await action("register", { storeName: form.get("storeName"), slug, whatsappNumber: form.get("whatsappNumber"), password });
          setCreatedHandle(String(slug).trim().toLowerCase());
          setRegistering(false);
        } else {
          await action("login", { slug, password });
          router.refresh();
        }
      } catch (exception) { setError(message(exception)); } finally { setBusy(false); }
    }}>
      {registering && <label>Shop name<input name="storeName" minLength={2} maxLength={100} required /></label>}
      <label>Store handle<input name="slug" autoComplete="username" placeholder="kedaibundle.kl" defaultValue={registering ? "" : createdHandle} maxLength={80} required /></label>
      {registering && <label>WhatsApp number<input name="whatsappNumber" type="tel" placeholder="0123456789" maxLength={30} required /></label>}
      <label>Password<input name="password" type="password" minLength={registering ? 12 : 1} maxLength={256} autoComplete={registering ? "new-password" : "current-password"} required /></label>
      {registering && <>
        <label>Confirm password<input name="confirmPassword" type="password" minLength={12} maxLength={256} autoComplete="new-password" required /></label>
        <Notice>Save your store handle and password in a password manager. LockDulu has no password reset.</Notice>
        <label className="notice"><input type="checkbox" name="credentialsSaved" required /> I have saved my sign-in details.</label>
      </>}
      {error && <Notice>{error}</Notice>}
      {!registering && createdHandle && <Notice success>Shop created. Sign in, then add your payment QR in Settings before accepting orders.</Notice>}
      <button className="button primary" disabled={busy}>{busy ? "Please wait..." : registering ? "Create shop" : "Sign in"}</button>
      <button type="button" disabled={busy} onClick={() => {
        setRegistering(!registering);
        setCreatedHandle("");
        setError("");
      }}>{registering ? "Back to sign in" : "Create a shop"}</button>
    </form></main>
    <Footer />
  </>;
}

type PendingAction = { type: "review"; orderId: string; paid: boolean; code: string } | { type: "ship"; ids: string[]; buyer: string };
type Order = DashboardData["orders"][number];

export function Dashboard({ initial }: { initial: DashboardData }) {
  const router = useRouter();
  const get = useCallback((signal?: AbortSignal) => action<DashboardData>("dashboard", {}, signal), []);
  const [data, setData] = usePolling(initial, get, 5000);
  const now = useClock(data.serverTime);
  const [tab, setTab] = useState<typeof tabs[number]["key"]>("receipts");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState(false);
  const [decision, setDecision] = useState<PendingAction | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; code: string; title: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await get();
      setData(current => next.serverTime >= current.serverTime ? next : current);
    } catch { setError("The dashboard could not refresh. Try reloading the page."); }
  }, [get, setData]);
  const { seller, items } = data;
  const pending = data.orders.filter(order => order.paymentStatus === "PENDING_VERIFICATION");
  const groups = new Map<string, Order[]>();
  for (const order of data.orders.filter(entry => entry.paymentStatus === "VERIFIED_PAID")) {
    groups.set(order.buyerPhone, [...(groups.get(order.buyerPhone) ?? []), order]);
  }
  const visible = items.filter(item => (filter === "all" || item.status === filter) &&
    `${item.code} ${item.title} ${item.brand}`.toLowerCase().includes(query.trim().toLowerCase()));

  async function confirm() {
    if (!decision) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      if (decision.type === "review") {
        await action("review", { id: decision.orderId, paid: decision.paid });
        setSuccess(decision.paid ? `Payment confirmed for ${decision.code}.` : `${decision.code} is available again.`);
      } else {
        await action("ship", { ids: decision.ids });
        setSuccess(`Parcel marked shipped for ${decision.buyer}.`);
      }
      setDecision(null); await refresh();
    } catch (exception) { setError(message(exception)); setDecision(null); await refresh(); }
    finally { setBusy(false); }
  }

  return <>
    <Header storeSlug={seller.storeSlug} seller />
    <main className="wrap dashboard">
      <div className="dash-top section-intro">
        <div><span className="eyebrow"><ShieldCheck size={16} strokeWidth={1.5} /> @{seller.storeSlug}</span><h1>Seller dashboard</h1><p>{seller.storeName}</p></div>
        <div className="button-row"><Link className="button" href={`/${seller.storeSlug}`}><ExternalLink size={17} strokeWidth={1.5} /> Storefront</Link>
          <button className="button primary" onClick={() => setListing(true)}><Plus size={20} strokeWidth={1.5} /> Quick list</button>
          <button className="icon-button" aria-label="Sign out" onClick={async () => {
            try { await action("logout"); router.refresh(); } catch (exception) { setError(message(exception)); }
          }}><LogOut size={18} strokeWidth={1.5} /></button>
        </div>
      </div>
      <nav className="dashboard-tabs" aria-label="Seller sections">
        {tabs.map(({ key, label, icon: Icon }) => <button key={key} aria-current={tab === key ? "page" : undefined} className={tab === key ? "selected" : ""}
          onClick={() => { setTab(key); setError(""); setSuccess(""); }}><Icon size={17} strokeWidth={1.5} /> {label}
          {key === "receipts" && pending.length > 0 && <span>{pending.length}</span>}
        </button>)}
      </nav>
      {error && <Notice>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      {tab === "receipts" && <section className="dash-section stack">
        <div className="section-heading"><div><h2>Receipt verification</h2><p className="muted">Check each screenshot against your bank or eWallet before confirming.</p></div><span className="piece-count">{pending.length} pending</span></div>
        {pending.length === 0 && <div className="surface empty"><ReceiptText size={31} strokeWidth={1.5} /><h3>No receipts to review</h3><p>Buyer payment screenshots appear here as they arrive.</p></div>}
        {pending.map(order => <article key={order.id} className="surface receipt-order">
          <div className="order-body">
            <img className="order-thumb" src={order.garment.images[0]} alt="" />
            <div className="order-copy"><span className="eyebrow">{order.garment.code}</span><h3>{order.garment.title}</h3><code className="muted">{order.id}</code>
              <p>{order.buyerName} · <a href={whatsapp(order.buyerPhone)} target="_blank" rel="noreferrer">+{order.buyerPhone}</a></p><p className="muted">{order.shippingAddress}</p></div>
            <div className="order-total"><strong>{money(order.totalAmount)}</strong><span className="badge badge-pending_verification">{order.fulfillmentType === "HOLD_BOX" ? "Hold Box" : "Ship Now"}</span></div>
          </div>
          {order.hasReceipt && <details className="receipt-details"><summary><ImagePlus size={17} strokeWidth={1.5} /> Receipt screenshot <ChevronDown size={17} strokeWidth={1.5} /></summary>
            <button className="receipt-preview" onClick={() => setReceiptOpen(order.id)} aria-label="Open full-size payment receipt">
              <img src={`/api/receipt/${order.id}`} alt="Payment receipt screenshot" loading="lazy" />
            </button>
          </details>}
          <div className="order-actions">
            <button className="button reject" onClick={() => setDecision({ type: "review", orderId: order.id, paid: false, code: order.garment.code })}><X size={17} strokeWidth={1.5} /> Reject / Unpaid</button>
            <button className="button primary" onClick={() => setDecision({ type: "review", orderId: order.id, paid: true, code: order.garment.code })}><Check size={18} strokeWidth={1.5} /> Confirm Paid</button>
          </div>
        </article>)}
      </section>}
      {tab === "inventory" && <section className="dash-section stack">
        <div className="section-heading"><div><h2>Live inventory</h2><p className="muted">Track one-of-one pieces and their current locks.</p></div><span className="piece-count">{visible.length} pieces</span></div>
        <div className="surface inventory-filters"><label>Search inventory<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Item name or code" /></label>
          <label>Status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <div className="surface inventory-list">{visible.map(item => <div className="inventory-row" key={item.id}><Link href={`/item/${item.id}`} className="inventory-item">
          <img src={item.images[0]} alt="" /><div><span className="eyebrow">{item.code}</span><strong>{item.title}</strong><small>{measurements(item)}</small></div><div><strong>{money(item.price)}</strong><Stage item={item} now={now} /></div>
        </Link><button type="button" className="icon-button inventory-delete" aria-label={`Delete ${item.code} ${item.title}`}
          onClick={() => setDeleting({ id: item.id, code: item.code, title: item.title })}><Trash2 size={18} strokeWidth={1.5} /></button></div>)}{visible.length === 0 && <p className="empty">No pieces match this filter.</p>}</div>
      </section>}
      {tab === "hold" && <section className="dash-section stack">
        <div className="section-heading"><div><h2>Hold Box fulfillment</h2><p className="muted">Pack verified pieces together by buyer.</p></div><span className="piece-count">{groups.size} buyers</span></div>
        {!groups.size && <div className="surface empty"><Box size={30} strokeWidth={1.5} /><h3>No parcels to pack</h3><p>Verified Hold Box pieces appear here until shipped.</p></div>}
        {[...groups.entries()].map(([phone, orders]) => {
          const first = orders[0];
          const requested = orders.some(order => order.dispatchRequestedAt);
          const addresses = [...new Set(orders.map(order => order.shippingAddress))];
          return <article className="surface receipt-order stack" key={phone}>
            <div className="section-heading"><div><h3>{first.buyerName}</h3><a href={whatsapp(phone)} target="_blank" rel="noreferrer">+{phone}</a></div>{requested && <span className="badge badge-pending_verification">Dispatch requested</span>}</div>
            {addresses.map(address => <p key={address} className="muted">{address}</p>)}
            <div className="inventory-list">{orders.map(order => <div className="inventory-item" key={order.id}>
              <img src={order.garment.images[0]} alt="" /><div><span className="eyebrow">{order.garment.code}</span><strong>{order.garment.title}</strong></div><strong>{money(order.totalAmount)}</strong>
            </div>)}</div>
            <button className="button primary" onClick={() => setDecision({ type: "ship", ids: orders.map(order => order.id), buyer: first.buyerName })}><PackageCheck size={18} strokeWidth={1.5} /> Mark parcel shipped</button>
          </article>;
        })}
      </section>}
      {tab === "settings" && <section className="dash-section stack"><div className="section-heading"><div><h2><QrCode size={23} strokeWidth={1.5} /> DuitNow and store settings</h2><p className="muted">Changes apply to new checkouts.</p></div></div>
        <StoreSettings seller={seller} onSaved={async () => { setSuccess("Store settings saved."); await refresh(); }} />
      </section>}
    </main>
    <Footer storeName={seller.storeName} />
    {listing && <QuickList data={data} onClose={() => setListing(false)} onListed={async code => {
      setListing(false); setTab("inventory"); setFilter("all"); setQuery(""); setError(""); setSuccess(`${code} was listed.`); await refresh();
    }} />}
    {deleting && <Sheet title="Delete listing?" onClose={() => { if (!busy) setDeleting(null); }}>
      <div className="stack"><p>Delete {deleting.code} · {deleting.title}? This permanently removes the listing from your store.</p>
        <p className="muted">Listings with an active lock or an associated order cannot be deleted.</p>
        <div className="button-row"><button className="button" disabled={busy} onClick={() => setDeleting(null)}>Cancel</button>
          <button className="button reject" disabled={busy} onClick={async () => {
            setBusy(true); setError(""); setSuccess("");
            try {
              await action("deleteListing", { id: deleting.id });
              setSuccess(`${deleting.code} was deleted.`);
            } catch (exception) { setError(message(exception)); }
            finally { setDeleting(null); await refresh(); setBusy(false); }
          }}>{busy ? "Deleting…" : "Delete listing"}</button></div>
      </div>
    </Sheet>}
    {decision && <Sheet title={decision.type === "ship" ? "Mark parcel shipped?" : decision.paid ? "Confirm payment?" : "Reject this receipt?"} onClose={() => { if (!busy) setDecision(null); }}>
      <div className="stack"><p>{decision.type === "ship" ? `Mark ${decision.ids.length} ${decision.ids.length === 1 ? "piece" : "pieces"} shipped for ${decision.buyer}.` : decision.paid ? `Confirm the DuitNow transfer for ${decision.code}.` : `${decision.code} will be available for another buyer immediately.`}</p>
        <div className="button-row"><button className="button" disabled={busy} onClick={() => setDecision(null)}>Cancel</button><button className="button primary" disabled={busy} onClick={confirm}>{busy ? "Saving…" : decision.type === "ship" ? "Mark shipped" : decision.paid ? "Confirm Paid" : "Reject / Unpaid"}</button></div></div>
    </Sheet>}
    {receiptOpen && <Sheet title="Payment receipt" className="image-sheet" onClose={() => setReceiptOpen(null)}><img src={`/api/receipt/${receiptOpen}`} alt="High-resolution payment receipt" /></Sheet>}
  </>;
}
