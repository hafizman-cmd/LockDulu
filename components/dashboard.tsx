"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Box, Check, ChevronDown, ExternalLink, Eye, EyeOff, History, ImagePlus, LayoutGrid, LogOut, PackageCheck, Plus, QrCode, ReceiptText, Settings, ShieldCheck, Trash2, X,
} from "lucide-react";
import { holdBoxDaysLeft, measurements, money, receiptRejectionLabels, statuses, whatsapp } from "@/lib/catalog";
import type { DashboardData } from "@/lib/seller";
import { action, message, RequestError, useClock, usePolling } from "./client";
import { Footer, GarmentPhoto, Header, Notice, Sheet, Stage } from "./common";
import { DropSettings, QuickList, ShopProfile, StoreSettings } from "./seller-forms";
import { ShareStorefront } from "./share-storefront";
import { SellerHistory } from "./seller-history";

const tabs = [
  { key: "receipts", label: "Receipts", icon: ReceiptText },
  { key: "shipping", label: "Ship Now", icon: PackageCheck },
  { key: "inventory", label: "Inventory", icon: LayoutGrid },
  { key: "hold", label: "Hold Box", icon: Box },
  { key: "history", label: "History", icon: History },
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

type PendingAction =
  | { type: "review"; orderId: string; paid: boolean; code: string }
  | { type: "ship"; ids: string[]; buyer: string; address: string; legacy?: boolean };
type Order = DashboardData["orders"][number];

export function Dashboard({ initial, publicOrigin }: { initial: DashboardData; publicOrigin?: string }) {
  const router = useRouter();
  const get = useCallback(async (signal?: AbortSignal) => {
    try { return await action<DashboardData>("dashboard", {}, signal); }
    catch (error) {
      if (error instanceof RequestError && (error.status === 401 || error.status === 404)) router.refresh();
      throw error;
    }
  }, [router]);
  const [data, setData] = usePolling(initial, get, 5000);
  const now = useClock(data.serverTime);
  const [selectedTab, setTab] = useState<typeof tabs[number]["key"]>("receipts");
  const [filter, setFilter] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState(false);
  const [decision, setDecision] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; code: string; title: string } | null>(null);
  const [changingVisibility, setChangingVisibility] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await get();
      setData(current => next.serverTime >= current.serverTime ? next : current);
    } catch { setError("The dashboard could not refresh. Try reloading the page."); }
  }, [get, setData]);
  const { seller, items } = data;
  const held = seller.status === "HELD";
  const tab = held && selectedTab === "settings" ? "inventory" : selectedTab;
  useEffect(() => {
    if (!held) return;
    setListing(false);
    setDeleting(null);
  }, [held]);
  const pending = data.orders.filter(order => order.paymentStatus === "PENDING_VERIFICATION");
  const verified = data.orders.filter(order => order.paymentStatus === "VERIFIED_PAID");
  const immediate = verified.filter(order => order.fulfillmentType === "SHIP_NOW");
  const readyToShip = immediate.filter(order => !order.shipmentUnconfirmed);
  const unconfirmed = immediate.filter(order => order.shipmentUnconfirmed);
  const waitingForDispatch = verified.filter(order => order.fulfillmentType === "HOLD_BOX" && !order.dispatchGroupId);
  const groups = new Map<string, Order[]>();
  for (const order of verified) {
    if (order.fulfillmentType === "HOLD_BOX" && order.dispatchGroupId) {
      groups.set(order.dispatchGroupId, [...(groups.get(order.dispatchGroupId) ?? []), order]);
    }
  }
  const visible = items.filter(item => (filter === "all" || item.status === filter) &&
    (visibility === "all" || item.hidden === (visibility === "hidden")) &&
    `${item.code} ${item.title} ${item.brand}`.toLowerCase().includes(query.trim().toLowerCase()));

  async function changeVisibility(item: DashboardData["items"][number]) {
    const hidden = !item.hidden;
    setChangingVisibility(item.id); setError(""); setSuccess("");
    try {
      await action("hideListing", { id: item.id, hidden });
      setSuccess(`${item.code} ${hidden ? "was hidden from the storefront" : "is visible on the storefront"}.`);
      await refresh();
    } catch (exception) { setError(message(exception)); }
    finally { setChangingVisibility(null); }
  }

  function openDecision(next: PendingAction) {
    setDecisionError("");
    setReason("");
    setDecision(next);
  }

  async function confirm(queue = false) {
    if (!decision) return;
    if (decision.type === "review" && !decision.paid && !reason) {
      setDecisionError("Choose a reason for rejecting this receipt.");
      return;
    }
    setBusy(true); setDecisionError(""); setError(""); setSuccess("");
    try {
      if (decision.type === "review") {
        await action("review", { id: decision.orderId, paid: decision.paid, reason });
        setSuccess(decision.paid ? `Payment confirmed for ${decision.code}.` : `${decision.code} is available again.`);
      } else if (queue) {
        await action("queueShipment", { id: decision.ids[0] });
        setSuccess(`Order for ${decision.buyer} moved to the shipping queue.`);
      } else {
        await action("ship", { ids: decision.ids });
        setSuccess(`Shipment recorded for ${decision.buyer}.`);
      }
      setDecision(null); await refresh();
    } catch (exception) { setDecisionError(message(exception)); await refresh(); }
    finally { setBusy(false); }
  }

  return <>
    <Header storeSlug={held ? undefined : seller.storeSlug} seller />
    <main className="wrap dashboard">
      <div className="dash-top section-intro">
        <div><span className="eyebrow"><ShieldCheck size={16} strokeWidth={1.5} /> @{seller.storeSlug}</span><h1>Seller dashboard</h1><p>{seller.storeName}</p></div>
        <div className="button-row">{!held && <>
          <Link className="button" href={`/${seller.storeSlug}`}><ExternalLink size={17} strokeWidth={1.5} /> Storefront</Link>
          <button className="button primary" onClick={() => setListing(true)}><Plus size={20} strokeWidth={1.5} /> Quick list</button>
        </>}
          <button className="icon-button" aria-label="Sign out" onClick={async () => {
            try { await action("logout"); router.refresh(); } catch (exception) { setError(message(exception)); }
          }}><LogOut size={18} strokeWidth={1.5} /></button>
        </div>
      </div>
      {held ? <Notice><span><strong>Your shop is on hold.</strong> Your storefront is hidden. You can still review receipts and fulfill existing orders.</span></Notice> :
        <ShareStorefront key={seller.storeSlug} storeSlug={seller.storeSlug} publicOrigin={publicOrigin} />}
      <nav className="dashboard-tabs" aria-label="Seller sections">
        {tabs.filter(({ key }) => !held || key !== "settings").map(({ key, label, icon: Icon }) => <button key={key} aria-current={tab === key ? "page" : undefined} className={tab === key ? "selected" : ""}
          onClick={() => { setTab(key); setError(""); setSuccess(""); }}><Icon size={17} strokeWidth={1.5} /> {label}
          {key === "receipts" && pending.length > 0 && <span>{pending.length}</span>}
          {key === "shipping" && immediate.length > 0 && <span>{immediate.length}</span>}
        </button>)}
      </nav>
      {error && <Notice>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      {tab === "receipts" && <section className="dash-section stack">
        <div className="section-heading"><div><h2>Receipt verification</h2><p className="muted">Check each screenshot against your bank or eWallet before confirming.</p></div><span className="piece-count">{pending.length} pending</span></div>
        {pending.length === 0 && <div className="surface empty"><ReceiptText size={31} strokeWidth={1.5} /><h3>No receipts to review</h3><p>Buyer payment screenshots appear here as they arrive.</p></div>}
        {pending.map(order => <article key={order.id} className="surface receipt-order">
          <div className="order-body">
            <GarmentPhoto className="order-thumb" src={order.garment.images[0]} alt="" />
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
            <button className="button reject" onClick={() => openDecision({ type: "review", orderId: order.id, paid: false, code: order.garment.code })}><X size={17} strokeWidth={1.5} /> Reject receipt</button>
            <button className="button primary" onClick={() => openDecision({ type: "review", orderId: order.id, paid: true, code: order.garment.code })}><Check size={18} strokeWidth={1.5} /> Confirm Paid</button>
          </div>
        </article>)}
      </section>}
      {tab === "shipping" && <section className="dash-section stack">
        <div className="section-heading"><div><h2>Ship Now fulfillment</h2><p className="muted">Pack and dispatch orders with verified payment.</p></div>
          <span className="piece-count">{readyToShip.length} to ship</span></div>
        {!immediate.length && <div className="surface empty"><PackageCheck size={30} strokeWidth={1.5} /><h3>No orders to ship</h3><p>Verified Ship Now orders appear here.</p></div>}
        {[readyToShip, unconfirmed].map((orders, index) => orders.length > 0 && <section className="stack" key={index} aria-label={index ? "Earlier orders" : "Ready to ship"}>
          {index > 0 && <><h3>Earlier orders with unknown shipment status</h3><p className="muted">Check your shipping records before deciding what each order needs.</p></>}
          {orders.map(order => <article className="surface receipt-order stack" key={order.id}>
            <div className="order-body">
              <GarmentPhoto className="order-thumb" src={order.garment.images[0]} alt="" />
              <div className="order-copy"><span className="eyebrow">{order.garment.code}</span><h3>{order.garment.title}</h3>
                <code className="muted">{order.id}</code>
                <p>{order.buyerName} · <a href={whatsapp(order.buyerPhone)} target="_blank" rel="noreferrer">+{order.buyerPhone}</a></p>
                <p>{order.shippingAddress}</p></div>
              <div className="order-total"><strong>{money(order.totalAmount)}</strong><span className="badge badge-available">Payment confirmed</span></div>
            </div>
            <div className="order-actions"><button className="button primary" onClick={() => openDecision({
              type: "ship", ids: [order.id], buyer: order.buyerName, address: order.shippingAddress, legacy: order.shipmentUnconfirmed,
            })}>{order.shipmentUnconfirmed ? "Review shipment status" : "Mark shipped"}</button></div>
          </article>)}
        </section>)}
      </section>}
      {tab === "inventory" && <section className="dash-section stack">
        <div className="section-heading"><div><h2>Live inventory</h2><p className="muted">Track one-of-one pieces and their current locks.</p></div><span className="piece-count">{visible.length} pieces</span></div>
        <div className="surface inventory-filters"><label>Search inventory<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Item name or code" /></label>
          <label>Visibility<select value={visibility} onChange={event => setVisibility(event.target.value)}>
            <option value="all">All listings</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label>
          <label>Status<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All statuses</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <div className="surface inventory-list">{visible.map(item => {
          const details = <><GarmentPhoto className="inventory-thumb" src={item.images[0]} alt="" /><div className="inventory-item-copy"><span className="eyebrow">{item.code}</span><strong>{item.title}</strong><small>{measurements(item)}</small>
            {item.hidden && <span className="badge badge-locked">Hidden</span>}</div><div><strong>{money(item.price)}</strong><Stage item={item} now={now} /></div></>;
          const visibilityAction = item.hidden ? "Show listing" : "Hide listing";
          const reservationActive = item.status === "LOCKED" && !!item.lockedUntil && Date.parse(item.lockedUntil) > now;
          return <div className="inventory-row" key={item.id}>
            {held || item.hidden ? <div className="inventory-item">{details}</div> : <Link href={`/item/${item.id}`} className="inventory-item">{details}</Link>}
            {!held && <div className="inventory-row-actions">
              <button type="button" className="button inventory-visibility" aria-label={`${visibilityAction} ${item.code}`}
                title={reservationActive && !item.hidden ? "Wait for the active reservation to end before hiding" : visibilityAction}
                disabled={!!changingVisibility || reservationActive && !item.hidden} onClick={() => changeVisibility(item)}>
                {item.hidden ? <Eye size={17} strokeWidth={1.5} /> : <EyeOff size={17} strokeWidth={1.5} />}
                {item.hidden ? "Show" : "Hide"}
              </button>
              <button type="button" className="icon-button inventory-delete" aria-label={`Delete ${item.code} ${item.title}`}
                onClick={() => setDeleting({ id: item.id, code: item.code, title: item.title })}><Trash2 size={18} strokeWidth={1.5} /></button>
            </div>}
          </div>;
        })}{visible.length === 0 && <p className="empty">No pieces match this filter.</p>}</div>
      </section>}
      {tab === "hold" && <section className="dash-section stack">
        <div className="section-heading"><div><h2>Hold Box fulfillment</h2><p className="muted">Pack the pieces in each buyer-confirmed parcel.</p></div><span className="piece-count">{groups.size} to pack</span></div>
        {!groups.size && <div className="surface empty"><Box size={30} strokeWidth={1.5} /><h3>No parcels to pack</h3><p>Parcels appear here when buyers request dispatch.</p></div>}
        {[...groups.entries()].map(([groupId, orders]) => {
          const first = orders[0];
          return <article className="surface receipt-order stack" key={groupId}>
            <div className="section-heading"><div><h3>{first.buyerName}</h3><a href={whatsapp(first.buyerPhone)} target="_blank" rel="noreferrer">+{first.buyerPhone}</a></div><span className="badge badge-pending_verification">Dispatch requested</span></div>
            <p>{first.shippingAddress}</p>
            <p className="muted">{groupId === first.id
              ? "This request predates parcel selection. Confirm the pieces and shipping charge with the buyer before dispatch."
              : "Confirm the combined shipping charge with the buyer before dispatch."}</p>
            <div className="inventory-list">{orders.map(order => <div className="inventory-item" key={order.id}>
              <GarmentPhoto className="order-thumb" src={order.garment.images[0]} alt="" /><div><span className="eyebrow">{order.garment.code}</span><strong>{order.garment.title}</strong></div><strong>{money(order.totalAmount)}</strong>
            </div>)}</div>
            <button className="button primary" onClick={() => openDecision({ type: "ship", ids: orders.map(order => order.id), buyer: first.buyerName, address: first.shippingAddress })}><PackageCheck size={18} strokeWidth={1.5} /> Mark parcel shipped</button>
          </article>;
        })}
        {waitingForDispatch.length > 0 && <section className="stack">
          <h3>Waiting for buyer dispatch requests</h3>
          {waitingForDispatch.map(order => {
            const overdue = order.verifiedAt && holdBoxDaysLeft(order.verifiedAt, order.holdBoxDays, now) <= 0;
            return <article className="surface receipt-order stack" key={order.id}>
              <div className="section-heading"><div><span className="eyebrow">{order.garment.code}</span><h4>{order.garment.title}</h4>
                <p>{order.buyerName} · <a href={whatsapp(order.buyerPhone)} target="_blank" rel="noreferrer">+{order.buyerPhone}</a></p></div>
                {overdue && <span className="badge badge-pending_verification">Hold Box overdue</span>}</div>
            </article>;
          })}
        </section>}
      </section>}
      {tab === "settings" && <section className="dash-section stack">
        <div className="section-heading"><div><h2>Shop profile</h2><p className="muted">Update the details buyers see.</p></div></div>
        <ShopProfile seller={seller} onSaved={async () => { setSuccess("Shop profile saved."); await refresh(); }} />
        <div className="section-heading"><div><h2>Drops</h2><p className="muted">Create a drop and select it when you list a garment.</p></div></div>
        <DropSettings drops={data.drops} onCreated={async () => { setSuccess("Drop created. Select it when listing a garment."); await refresh(); }} />
        <div className="section-heading"><div><h2><QrCode size={23} strokeWidth={1.5} /> DuitNow and delivery</h2><p className="muted">Changes apply to new checkouts.</p></div></div>
        <StoreSettings seller={seller} onSaved={async () => { setSuccess("Store settings saved."); await refresh(); }} />
      </section>}
      {tab === "history" && <SellerHistory onReceipt={setReceiptOpen} />}
    </main>
    <Footer storeName={seller.storeName} />
    {!held && listing && <QuickList data={data} onClose={() => setListing(false)} onListed={async code => {
      setListing(false); setTab("inventory"); setFilter("all"); setVisibility("all"); setQuery(""); setError(""); setSuccess(`${code} was listed.`); await refresh();
    }} />}
    {!held && deleting && <Sheet title="Delete listing?" onClose={() => { if (!busy) setDeleting(null); }}>
      <div className="stack"><p>Delete {deleting.code} · {deleting.title}? This removes the listing from your store and inventory.</p>
        <p className="muted">Order and receipt history remains available. Listings with an active reservation, receipt review or Hold Box cannot be deleted.</p>
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
    {decision && <Sheet title={decision.type === "ship" ? (decision.legacy ? "Review shipment status" : "Mark shipment sent?") : decision.paid ? "Confirm payment?" : "Reject this receipt?"} onClose={() => { if (!busy) setDecision(null); }}>
      <div className="stack">
        {decision.type === "ship" ? <>
          <p>{decision.legacy ? `Has the order for ${decision.buyer} already shipped?` :
            `Record shipment of ${decision.ids.length} ${decision.ids.length === 1 ? "piece" : "pieces"} for ${decision.buyer}.`}</p>
          <p><strong>Delivery address</strong><br />{decision.address}</p>
        </> : <p>{decision.paid ? `Confirm ${decision.code} after checking that the DuitNow transfer reached your bank or eWallet. The listing will show as sold out.` : `${decision.code} will be available for another buyer immediately.`}</p>}
        {decision.type === "review" && !decision.paid && <label>Reason shown to the buyer<select value={reason} disabled={busy} onChange={event => setReason(event.target.value)}>
          <option value="">Choose a reason</option>{Object.entries(receiptRejectionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>}
        {decisionError && <Notice>{decisionError}</Notice>}
        <div className="button-row">
          <button className="button" disabled={busy} onClick={() => setDecision(null)}>Cancel</button>
          {decision.type === "ship" && decision.legacy && <button className="button" disabled={busy} onClick={() => confirm(true)}>Move to shipping queue</button>}
          <button className={`button ${decision.type === "review" && !decision.paid ? "reject" : "primary"}`} disabled={busy} onClick={() => confirm()}>
            {busy ? "Saving…" : decision.type === "ship" ? (decision.legacy ? "Record already shipped" : "Mark shipped") : decision.paid ? "Confirm Paid" : "Reject receipt"}
          </button>
        </div>
      </div>
    </Sheet>}
    {receiptOpen && <Sheet title="Payment receipt" className="image-sheet" onClose={() => setReceiptOpen(null)}><img src={`/api/receipt/${receiptOpen}`} alt="High-resolution payment receipt" /></Sheet>}
  </>;
}
