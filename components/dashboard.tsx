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
const receiptReviewHours = 24;
type SellerTab = typeof tabs[number]["key"];

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
  | { type: "transfer"; report: DashboardData["transferReports"][number] }
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
  const [selectedTab, setTab] = useState<SellerTab>("receipts");
  const [sectionTarget, setSectionTarget] = useState<string | null>(null);
  const [showSetup] = useState(() => !initial.seller.paymentReady || (initial.seller.nextItemNumber === 1 && !initial.items.length));
  const [filter, setFilter] = useState("all");
  const [visibility, setVisibility] = useState("all");
  const [query, setQuery] = useState("");
  const [listing, setListing] = useState<true | DashboardData["items"][number] | null>(null);
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
  const hasListed = seller.nextItemNumber > 1 || items.length > 0;
  const tab = held && selectedTab === "settings" ? "inventory" : selectedTab;
  useEffect(() => {
    if (!held) return;
    setListing(null);
    setDeleting(null);
  }, [held]);
  useEffect(() => {
    if (!sectionTarget) return;
    document.getElementById(sectionTarget)?.focus();
    setSectionTarget(null);
  }, [sectionTarget]);
  const pending = data.orders.filter(order => order.paymentStatus === "PENDING_VERIFICATION");
  const overdueReceipts = pending.filter(order => Date.parse(order.receiptSubmittedAt) <= now - receiptReviewHours * 3_600_000);
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
  const reportsNeedAction: DashboardData["transferReports"] = [];
  const reportsAwaitingBuyer: DashboardData["transferReports"] = [];
  for (const report of data.transferReports) {
    const needsAction = !report.transferResolution || report.refundDisputed ||
      (report.transferResolution === "REFUNDED" && !report.refundReference);
    (needsAction ? reportsNeedAction : reportsAwaitingBuyer).push(report);
  }
  const transferReports = [...reportsNeedAction, ...reportsAwaitingBuyer];
  const queues = [
    { tab: "receipts", target: "seller-receipts", label: "Receipts to review", count: pending.length, icon: ReceiptText },
    { tab: "shipping", target: "seller-shipping", label: "Ship Now orders to pack", count: readyToShip.length, icon: PackageCheck },
    { tab: "receipts", target: "seller-transfers", label: "Transfer reports to follow up", count: reportsNeedAction.length, icon: ShieldCheck },
    { tab: "hold", target: "seller-hold", label: "Hold Box parcels to pack", count: groups.size, icon: Box },
  ] as const;
  const visible = items.filter(item => (filter === "all" || item.status === filter) &&
    (visibility === "all" || item.hidden === (visibility === "hidden")) &&
    `${item.code} ${item.title} ${item.brand}`.toLowerCase().includes(query.trim().toLowerCase()));

  function openSection(nextTab: SellerTab, target?: string) {
    setTab(nextTab);
    setError("");
    setSuccess("");
    if (target) setSectionTarget(target);
  }

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

  async function confirm(queue = false, fields?: FormData) {
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
      } else if (decision.type === "transfer") {
        if (!reason) { setDecisionError("Choose an outcome for this transfer."); return; }
        const update = reason === "REFUNDED" ? { type: reason, amount: fields?.get("refundAmount"),
          sentOn: fields?.get("refundSentOn"), reference: fields?.get("refundReference"), note: fields?.get("refundNote") } : { type: reason };
        await action("sellerTransferUpdate", { id: decision.report.id, version: decision.report.transferVersion, update });
        setSuccess(reason === "REFUNDED" ? `Refund reported for ${decision.report.code}. The buyer can confirm it in My orders.`
          : `Requested more information for ${decision.report.code}.`);
      } else if (queue) {
        await action("queueShipment", { id: decision.ids[0] });
        setSuccess(`Order for ${decision.buyer} moved to the shipping queue.`);
      } else if (decision.legacy) {
        await action("reconcileShipment", { id: decision.ids[0] });
        setSuccess(`Prior shipment recorded for ${decision.buyer}.`);
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
      {held ? <Notice><span><strong>Your shop is on hold.</strong> Your storefront is hidden. You can still review receipts and fulfill existing orders.</span></Notice> : <>
        {(showSetup || !seller.paymentReady) && <section className="seller-setup surface stack" aria-labelledby="seller-setup-heading">
          <h2 id="seller-setup-heading">Get your shop ready</h2>
          <ol>
            <li>{seller.paymentReady ? <span><Check size={17} aria-hidden="true" /> DuitNow payments set up</span> :
              <button className="button primary" type="button" onClick={() => openSection("settings", "seller-payment-settings")}>Set up DuitNow</button>}</li>
            <li>{hasListed ? <span><Check size={17} aria-hidden="true" /> First piece listed</span> :
              <button className="button" type="button" onClick={() => setListing(true)}>List your first piece</button>}</li>
            <li>{seller.paymentReady && hasListed ? <a className="button" href="#share-storefront-heading">Share your shop link</a> :
              <span className="muted">Share your shop when payments and your first piece are ready</span>}</li>
          </ol>
        </section>}
        <ShareStorefront key={seller.storeSlug} storeSlug={seller.storeSlug} publicOrigin={publicOrigin} />
      </>}
      <section className="seller-work" aria-labelledby="seller-work-heading">
        <h2 id="seller-work-heading">Needs attention</h2>
        <div className="seller-queues">
          {queues.map(({ tab: nextTab, target, label, count, icon: Icon }) => <button key={target} className="surface seller-queue" type="button"
            onClick={() => openSection(nextTab, target)}>
            <Icon size={19} aria-hidden="true" /><strong>{count}</strong><span>{label}</span>
          </button>)}
        </div>
      </section>
      <nav className="dashboard-tabs" aria-label="Seller sections">
        {tabs.filter(({ key }) => !held || key !== "settings").map(({ key, label, icon: Icon }) => <button key={key} aria-current={tab === key ? "page" : undefined} className={tab === key ? "selected" : ""}
          onClick={() => openSection(key)}><Icon size={17} strokeWidth={1.5} /> {label}
          {key === "receipts" && pending.length + data.transferReports.length > 0 && <span>{pending.length + data.transferReports.length}</span>}
          {key === "shipping" && immediate.length > 0 && <span>{immediate.length}</span>}
        </button>)}
      </nav>
      {error && <Notice>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      {overdueReceipts.length > 0 && <Notice>
        {overdueReceipts.length === 1 ? "One receipt has" : `${overdueReceipts.length} receipts have`} been waiting at least {receiptReviewHours} hours.
        {" "}{tab === "receipts" ? "Check your bank and contact the buyer if you cannot match the transfer."
          : <button className="text-button" onClick={() => openSection("receipts", "seller-receipts")}>Review receipts</button>}
      </Notice>}
      {tab === "receipts" && <section className="dash-section stack">
        <div className="section-heading"><div><h2 id="seller-receipts" tabIndex={-1}>Receipt verification</h2><p className="muted">Review within {receiptReviewHours} hours. Check each screenshot against your bank or eWallet before confirming.</p></div><span className="piece-count">{pending.length} pending</span></div>
        {pending.length === 0 && <div className="surface empty"><ReceiptText size={31} strokeWidth={1.5} /><h3>No receipts to review</h3><p>Buyer payment screenshots appear here as they arrive.</p></div>}
        {pending.map(order => <article key={order.id} className="surface receipt-order">
          <div className="order-body">
            <GarmentPhoto className="order-thumb" src={order.garment.images[0]} alt="" />
            <div className="order-copy"><span className="eyebrow">{order.garment.code}</span><h3>{order.garment.title}</h3><code className="muted">{order.id}</code>
              <p>{order.buyerName} · <a href={whatsapp(order.buyerPhone)} target="_blank" rel="noreferrer">+{order.buyerPhone}</a></p><p className="muted">{order.shippingAddress}</p></div>
            <div className="order-total"><strong>{money(order.totalAmount)}</strong><span className="badge badge-pending_verification">{order.fulfillmentType === "HOLD_BOX" ? "Hold Box" : "Ship Now"}</span></div>
          </div>
          {order.hasReceipt && <details className="receipt-details"><summary><ImagePlus size={17} strokeWidth={1.5} /> Receipt screenshot <ChevronDown size={17} strokeWidth={1.5} /></summary>
            <button className="receipt-preview" onClick={() => setReceiptOpen(order.id)}>
              <GarmentPhoto src={`/api/receipt/${order.id}`} alt="Open full-size payment receipt" loading="lazy" unavailableLabel="Receipt image unavailable. Open to try again." />
            </button>
          </details>}
          <div className="order-actions">
            <button className="button reject" onClick={() => openDecision({ type: "review", orderId: order.id, paid: false, code: order.garment.code })}><X size={17} strokeWidth={1.5} /> Reject receipt</button>
            <button className="button primary" onClick={() => openDecision({ type: "review", orderId: order.id, paid: true, code: order.garment.code })}><Check size={18} strokeWidth={1.5} /> Confirm Paid</button>
          </div>
        </article>)}
        <section className="stack">
          <div className="section-heading"><div><h2 id="seller-transfers" tabIndex={-1}>Reported bank transfers</h2><p className="muted">Check your bank or eWallet and contact the buyer if you need a clearer receipt.</p></div></div>
          {!transferReports.length && <p className="muted">No open transfer reports.</p>}
          {transferReports.map(report => <article key={report.id} className="surface receipt-order stack">
            <h3>{report.title ?? report.code}</h3>
            <p>Order {report.id} · {money(report.total)}</p>
            <p>Bank reference <strong>{report.reference}</strong></p>
            <p>{report.buyerName} · <a href={whatsapp(report.buyerPhone)} target="_blank" rel="noreferrer">+{report.buyerPhone}</a></p>
            {report.transferEscalated && <p className="muted">The buyer requested help from LockDulu.</p>}
            {report.refundDisputed ? <p>The buyer says they haven’t received the full refund. Check the transfer and contact them.</p>
              : report.transferResolution === "REFUNDED" ? <p>Refund reported. Waiting for the buyer to confirm receipt.</p>
              : report.transferResolution === "TRANSFER_NOT_FOUND" ? <p>Waiting for the buyer to check the payment reference.</p> : null}
            {report.refundAmount && <p>Reported refund {money(report.refundAmount)} · {report.refundSentOn} · Reference {report.refundReference}</p>}
            <div className="order-actions">
              {report.transferResolution === "REFUNDED" && <a className="button" href={whatsapp(report.buyerPhone, `Hi, I’m following up about the refund for LockDulu order ${report.id}.`)} target="_blank" rel="noreferrer">Message buyer</a>}
              {(!report.transferResolution || report.transferResolution === "TRANSFER_NOT_FOUND" || report.refundDisputed || !report.refundReference) &&
                <button type="button" className="button primary" onClick={() => openDecision({ type: "transfer", report })}>{report.transferResolution ? "Update report" : "Record outcome"}</button>}
            </div>
          </article>)}
        </section>
      </section>}
      {tab === "shipping" && <section className="dash-section stack">
        <div className="section-heading"><div><h2 id="seller-shipping" tabIndex={-1}>Ship Now fulfillment</h2><p className="muted">Pack and dispatch orders with verified payment.</p></div>
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
          const canEdit = item.status === "AVAILABLE" || item.status === "LOCKED" && !reservationActive;
          const protectedReason = reservationActive ? "Active reservation" : item.status === "PENDING_VERIFICATION" ? "Receipt under review" : item.status === "HOLD_BOX" ? "Open Hold Box order" : "";
          return <div className="inventory-row" key={item.id}>
            {held || item.hidden ? <div className="inventory-item">{details}</div> : <Link href={`/item/${item.id}`} className="inventory-item">{details}</Link>}
            {!held && <div className="inventory-row-actions">
              <button type="button" className="button inventory-visibility" aria-label={`${visibilityAction} ${item.code}`}
                title={reservationActive && !item.hidden ? "Wait for the active reservation to end before hiding" : visibilityAction}
                disabled={!!changingVisibility || reservationActive && !item.hidden} onClick={() => changeVisibility(item)}>
                {item.hidden ? <Eye size={17} strokeWidth={1.5} /> : <EyeOff size={17} strokeWidth={1.5} />}
                {item.hidden ? "Show" : "Hide"}
              </button>
              {canEdit && <button type="button" className="button" aria-label={`Edit ${item.code} ${item.title}`} onClick={() => setListing(item)}>Edit</button>}
              <button type="button" className="icon-button inventory-delete" aria-label={`Delete ${item.code} ${item.title}`}
                disabled={!!protectedReason}
                onClick={() => setDeleting({ id: item.id, code: item.code, title: item.title })}><Trash2 size={18} strokeWidth={1.5} /></button>
            </div>}
            {!held && protectedReason && <small className="muted inventory-protection">{protectedReason} · Listing protected</small>}
          </div>;
        })}{visible.length === 0 && <p className="empty">No pieces match this filter.</p>}</div>
      </section>}
      {tab === "hold" && <section className="dash-section stack">
        <div className="section-heading"><div><h2 id="seller-hold" tabIndex={-1}>Hold Box fulfillment</h2><p className="muted">Pack the pieces in each buyer-confirmed parcel.</p></div><span className="piece-count">{groups.size} to pack</span></div>
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
        <div className="section-heading"><div><h2 id="seller-payment-settings" tabIndex={-1}><QrCode size={23} strokeWidth={1.5} /> DuitNow and delivery</h2><p className="muted">Changes apply to new checkouts.</p></div></div>
        <StoreSettings seller={seller} onSaved={async () => { setSuccess("Store settings saved."); await refresh(); }} />
      </section>}
      {tab === "history" && <SellerHistory onReceipt={setReceiptOpen} />}
    </main>
    <Footer storeName={seller.storeName} />
    {!held && listing && <QuickList data={data} item={listing === true ? undefined : listing} onClose={() => setListing(null)} onListed={async code => {
      setListing(null); setTab("inventory"); setFilter("all"); setVisibility("all"); setQuery(""); setError(""); setSuccess(listing === true ? `${code} was listed.` : `${code} was updated.`); await refresh();
    }} />}
    {!held && deleting && <Sheet title="Delete listing?" closeDisabled={busy} onClose={() => setDeleting(null)}>
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
    {decision && <Sheet title={decision.type === "ship" ? (decision.legacy ? "Review shipment status" : "Mark shipment sent?") : decision.type === "transfer" ? "Update transfer report" : decision.paid ? "Confirm payment?" : "Reject this receipt?"} closeDisabled={busy} onClose={() => setDecision(null)}>
      <form className="stack" onSubmit={event => { event.preventDefault(); void confirm(false, new FormData(event.currentTarget)); }}>
        {decision.type === "ship" ? <>
          <p>{decision.legacy ? `Has the order for ${decision.buyer} already shipped? We’ll record the review date and show the shipment date as unknown.` :
            `Record shipment of ${decision.ids.length} ${decision.ids.length === 1 ? "piece" : "pieces"} for ${decision.buyer}.`}</p>
          <p><strong>Delivery address</strong><br />{decision.address}</p>
        </> : decision.type === "transfer" ? <>
          <p>Check bank reference <strong>{decision.report.reference}</strong>. Issue any refund through your bank or eWallet before recording it here.</p>
          <label>Transfer outcome<select value={reason} required disabled={busy} onChange={event => setReason(event.target.value)}>
            <option value="">Choose an outcome</option>
            <option value="REFUNDED">Refund sent</option>
            {!decision.report.transferResolution && <option value="TRANSFER_NOT_FOUND">Could not match the transfer</option>}
          </select></label>
          {reason === "REFUNDED" && <fieldset className="stack" disabled={busy}>
            <label>Total refunded so far (RM)<input name="refundAmount" type="number" required min="0.01" max={decision.report.total} step="0.01" defaultValue={decision.report.total} /></label>
            <label>Date of latest refund transfer<input name="refundSentOn" type="date" required /></label>
            <label>Latest refund transfer reference<input name="refundReference" required minLength={3} maxLength={120} /></label>
            <label>Message for the buyer (optional)<textarea name="refundNote" rows={2} maxLength={500} /></label>
            <p className="muted">Share the transfer reference here. Keep bank account numbers and sensitive payment details out of the message.</p>
          </fieldset>}
        </> : <p>{decision.paid ? `Confirm ${decision.code} after checking that the DuitNow transfer reached your bank or eWallet. The listing will show as sold out.` : `${decision.code} will be available for another buyer immediately.`}</p>}
        {decision.type === "review" && !decision.paid && <label>Reason shown to the buyer<select value={reason} disabled={busy} onChange={event => setReason(event.target.value)}>
          <option value="">Choose a reason</option>{Object.entries(receiptRejectionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>}
        {decisionError && <Notice>{decisionError}</Notice>}
        <div className="button-row">
          <button type="button" className="button" disabled={busy} onClick={() => setDecision(null)}>Cancel</button>
          {decision.type === "ship" && decision.legacy && <button type="button" className="button" disabled={busy} onClick={() => confirm(true)}>Move to shipping queue</button>}
          <button className={`button ${decision.type === "review" && !decision.paid ? "reject" : "primary"}`} disabled={busy}>
            {busy ? "Saving…" : decision.type === "ship" ? (decision.legacy ? "Record already shipped" : "Mark shipped") : decision.type === "transfer" ? "Save outcome" : decision.paid ? "Confirm Paid" : "Reject receipt"}
          </button>
        </div>
      </form>
    </Sheet>}
    {receiptOpen && <Sheet title="Payment receipt" className="image-sheet" onClose={() => setReceiptOpen(null)}>
      <GarmentPhoto src={`/api/receipt/${receiptOpen}`} alt="Full-size payment receipt" unavailableLabel="Receipt image unavailable" />
    </Sheet>}
  </>;
}
