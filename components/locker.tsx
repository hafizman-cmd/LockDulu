"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Box, Clock3, MessageCircle, PackageCheck, RefreshCw, Search } from "lucide-react";
import type { LockerOrder } from "@/lib/seller";
import { holdBoxDaysLeft, money, rejectionMessage, transferResolutionLabel, whatsapp } from "@/lib/catalog";
import { action, message, savedLocks } from "./client";
import { Footer, GarmentPhoto, Header, Notice, Sheet } from "./common";

type View = "orders" | "hold" | "history";
type Parcel = { orders: LockerOrder[]; selected: string[] };
const transferActions = {
  CORRECT_REFERENCE: "Update payment reference",
  CONFIRM_REFUND: "I received the full refund",
  DISPUTE_REFUND: "I haven’t received the full refund",
  REQUEST_HELP: "Get help from LockDulu",
} as const;
type TransferAction = keyof typeof transferActions;

function openHoldBox(order: LockerOrder) {
  return order.status === "VERIFIED_PAID" && order.fulfillmentType === "HOLD_BOX" && !order.shippedAt;
}

function isPastOrder(order: LockerOrder) {
  return !!(order.shippedAt || order.shipmentReconciledAt) || (order.status === "REJECTED" || order.status === "EXPIRED") && (!order.transferReported || !!order.transferResolvedAt);
}

function orderView(order: LockerOrder): View {
  return isPastOrder(order) ? "history" : openHoldBox(order) ? "hold" : "orders";
}

async function loadSavedOrders(signal?: AbortSignal) {
  const tokens = savedLocks().filter(entry => entry.orderId).map(entry => entry.token);
  if (!tokens.length) return [];
  const result = await action<{ orders: LockerOrder[] }>("lockerSaved", { tokens }, signal);
  return result.orders;
}

const orderNotFound = "This order wasn’t found. Check the order number and open My orders in the same browser you used at checkout, with its saved site data.";

function orderLabel(order: LockerOrder, now: number) {
  if (order.transferResolvedAt) return "You confirmed your refund";
  if (order.refundDisputed) return "Refund follow-up needed";
  if (order.transferReported) return order.transferResolution ? transferResolutionLabel(order.transferResolution) : "Transfer report awaiting review";
  if (order.status === "AWAITING_RECEIPT") return "Awaiting receipt upload";
  if (order.status === "EXPIRED") return "Reservation expired";
  if (order.status === "PENDING_VERIFICATION") return "Awaiting payment approval";
  if (order.status === "REJECTED") return "Receipt rejected";
  if (order.shippedAt) return "Shipped";
  if (order.shipmentReconciledAt) return "Already shipped · Date unknown";
  if (order.shipmentUnconfirmed) return order.shopStatus === "DELETED" ? "Shipment status unavailable" : "Shipment status being confirmed";
  if (!openHoldBox(order)) return "Payment confirmed · Awaiting shipment";
  if (order.dispatchRequestedAt) return "Dispatch requested";
  if (!order.verifiedAt) return "In Hold Box";
  const days = holdBoxDaysLeft(order.verifiedAt, order.holdBoxDays, now);
  return days <= 0 ? "Hold Box overdue" : `${days} ${days === 1 ? "day" : "days"} left in Hold Box`;
}

export function Locker({ reference }: { reference: string }) {
  const [number, setNumber] = useState(reference);
  const [trackedId, setTrackedId] = useState("");
  const [orders, setOrders] = useState<LockerOrder[] | null>(null);
  const [view, setView] = useState<View>("orders");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [now, setNow] = useState(0);
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState("");
  const [reportOrder, setReportOrder] = useState<LockerOrder | null>(null);
  const [followUp, setFollowUp] = useState<{ order: LockerOrder; type: TransferAction } | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState("");

  useEffect(() => {
    const aborter = new AbortController();
    loadSavedOrders(aborter.signal).then(loaded => {
      if (aborter.signal.aborted) return;
      setOrders(loaded);
      setNow(Date.now());
      const tracked = loaded.find(order => order.id === reference);
      if (tracked) {
        setTrackedId(tracked.id);
        setView(orderView(tracked));
      } else {
        if (reference) setError(orderNotFound);
        if (loaded.length && loaded.every(isPastOrder)) setView("history");
      }
    }).catch(exception => {
      if (!aborter.signal.aborted) setError(message(exception));
    }).finally(() => {
      if (!aborter.signal.aborted) setBusy(false);
    });
    return () => aborter.abort();
  }, [reference]);

  async function refreshOrders() {
    const loaded = await loadSavedOrders();
    setOrders(loaded);
    setNow(Date.now());
    return loaded;
  }

  async function updateOrders(orderNumber?: string) {
    setBusy(true); setError(""); setSuccess("");
    try {
      const loaded = await refreshOrders();
      const target = orderNumber?.trim().toLowerCase() ?? (trackedId || reference);
      const tracked = loaded.find(order => order.id === target);
      if (tracked) {
        const previous = orders?.find(order => order.id === tracked.id);
        setTrackedId(tracked.id);
        if (orderNumber !== undefined || !previous || view === orderView(previous)) setView(orderView(tracked));
      } else if (orderNumber !== undefined || (!orders && reference)) {
        throw new Error(orderNotFound);
      } else if (!orders && loaded.length && loaded.every(isPastOrder)) setView("history");
    } catch (exception) { setError(message(exception)); }
    finally { setBusy(false); }
  }

  function chooseParcel(order: LockerOrder) {
    const compatible = orders?.filter(entry => openHoldBox(entry) && !entry.dispatchRequestedAt &&
      entry.parcelKey === order.parcelKey) ?? [];
    setDispatchError("");
    setParcel({ orders: compatible, selected: [order.id] });
  }

  async function dispatch(event: React.FormEvent) {
    event.preventDefault();
    if (!parcel?.selected.length || dispatching) return;
    const locks = new Map(savedLocks().map(entry => [entry.orderId, entry.token]));
    const tokens = parcel.selected.map(id => locks.get(id));
    if (tokens.some(token => !token)) {
      setDispatchError("Open this tracker in the browser used to buy all selected pieces.");
      return;
    }
    setDispatching(true); setDispatchError(""); setSuccess(""); setError("");
    try {
      await action("dispatch", { tokens });
      setParcel(null);
      setSuccess("Dispatch requested. Message the seller to arrange combined shipping.");
      try { await refreshOrders(); }
      catch (exception) { setError(`Refresh your orders to see the new parcel. ${message(exception)}`); }
    } catch (exception) { setDispatchError(message(exception)); }
    finally { setDispatching(false); }
  }

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportOrder || reporting) return;
    const token = savedLocks().find(lock => lock.orderId === reportOrder.id)?.token;
    if (!token) { setReportError("Open My orders in the browser you used at checkout."); return; }
    const reference = new FormData(event.currentTarget).get("reference");
    setReporting(true); setReportError("");
    try {
      await action("reportTransfer", { id: reportOrder.id, token, reference });
      setReportOrder(null);
      setView("orders");
      setSuccess("Transfer reported. The seller can review it in LockDulu.");
      try { await refreshOrders(); }
      catch (exception) { setError(`Refresh your orders to see the transfer status. ${message(exception)}`); }
    } catch (exception) { setReportError(message(exception)); }
    finally { setReporting(false); }
  }

  async function submitFollowUp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!followUp || reporting) return;
    const { order, type } = followUp;
    const token = savedLocks().find(lock => lock.orderId === order.id)?.token;
    if (!token) { setReportError("Open My orders in the browser you used at checkout."); return; }
    const reference = new FormData(event.currentTarget).get("reference");
    setReporting(true); setReportError(""); setSuccess(""); setError("");
    try {
      await action("buyerTransferUpdate", { id: order.id, token, version: order.transferVersion,
        update: type === "CORRECT_REFERENCE" ? { type, reference } : { type } });
      setFollowUp(null);
      if (type === "CONFIRM_REFUND") setView("history");
      setSuccess(type === "CONFIRM_REFUND" ? "Refund receipt confirmed." : type === "REQUEST_HELP" ? "Help requested. You can follow the case here."
        : type === "DISPUTE_REFUND" ? "The seller can see that you haven’t received the full refund." : "Payment reference updated for the seller.");
      try { await refreshOrders(); }
      catch (exception) { setError(`Refresh your orders to see the update. ${message(exception)}`); }
    } catch (exception) { setReportError(message(exception)); }
    finally { setReporting(false); }
  }

  const visible = orders?.filter(order => view === "hold" ? openHoldBox(order)
    : view === "history" ? isPastOrder(order) : !isPastOrder(order));
  const tracked = orders?.find(order => order.id === trackedId);
  const displayed = visible && tracked && visible.includes(tracked)
    ? [tracked, ...visible.filter(order => order !== tracked)] : visible;
  const controlsDisabled = busy || dispatching || reporting;
  const parcelPieces = new Map<string, string[]>();
  for (const order of orders ?? []) {
    if (order.dispatchGroupId) {
      parcelPieces.set(order.dispatchGroupId, [...(parcelPieces.get(order.dispatchGroupId) ?? []), order.code]);
    }
  }

  return <>
    <Header />
    <main className="wrap secondary-page">
      <div className="section-intro"><span className="eyebrow"><Box size={17} strokeWidth={1.5} /> Buyer tools</span><h1>My orders</h1>
        <p>Track payments and shipments, or request dispatch for your Hold Box pieces.</p></div>
      <div className="locker-tools">
        <button className="button" type="button" disabled={controlsDisabled} onClick={() => void updateOrders()}>
          <RefreshCw size={17} aria-hidden="true" />{busy ? "Loading orders…" : "Refresh orders"}
        </button>
        {!!orders?.length && <details className="locker-search surface">
          <summary>Find by order number</summary>
          <form className="stack" onSubmit={event => { event.preventDefault(); void updateOrders(number); }}>
            <label>Order number<input required autoComplete="off" autoCapitalize="none" spellCheck={false}
              value={number} maxLength={100} disabled={controlsDisabled} onChange={event => setNumber(event.target.value)} /></label>
            <button className="button" disabled={controlsDisabled}><Search size={17} aria-hidden="true" /> Find order</button>
          </form>
        </details>}
      </div>
      {busy && <p className="muted" role="status">Checking for orders saved in this browser…</p>}
      {error && <Notice>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      {orders?.length === 0 && <div className="surface empty">
        <Box size={24} aria-hidden="true" /><h2>No saved orders</h2>
        <p>Open My orders in the same browser you used at checkout, with its saved site data, to see your orders.</p>
        <Link className="button" href="/">Browse shops</Link>
      </div>}
      {!!orders?.length && displayed && <div className="stack locker-results">
        <nav className="dashboard-tabs" aria-label="Order sections">
          {([["orders", "Active orders"], ["hold", "Hold Box"], ["history", "History"]] as const).map(([key, label]) =>
            <button type="button" key={key} className={view === key ? "selected" : ""} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
        </nav>
        {displayed.length === 0 && <div className="surface empty"><Box size={24} strokeWidth={1.5} />
          <h2>{view === "hold" ? "No open Hold Box pieces" : view === "history" ? "No past orders" : "No active orders"}</h2>
          <p>Check another order section.</p></div>}
        {displayed.map(order => {
          const pending = order.status !== "VERIFIED_PAID" || order.shipmentUnconfirmed;
          const hold = openHoldBox(order);
          return <article className="surface locker-order" key={order.id}>
            <GarmentPhoto className="order-thumb" src={order.image ?? undefined} alt="" />
            <div className="locker-order-copy"><p className="eyebrow">{order.storeName} / {order.code}</p><h2>{order.title}</h2><p>{money(order.total)} · {order.fulfillmentType === "HOLD_BOX" ? "Hold Box" : "Ship Now"}</p>
              <code className="muted">{order.id}{order.id === trackedId && <span className="tracked-order-label"> · Tracked order</span>}</code>
              <span className={`badge badge-${pending ? "pending_verification" : "hold_box"}`}>
                {pending ? <Clock3 size={13} strokeWidth={1.5} /> : <PackageCheck size={13} strokeWidth={1.5} />}
                {orderLabel(order, now)}</span>
              {!order.transferReported && order.status === "REJECTED" && <p>{rejectionMessage(order.rejectionReason)}</p>}
              {!order.transferReported && order.status === "EXPIRED" && <p>If you transferred, keep your bank reference and contact the seller before paying again.</p>}
              {(order.status === "EXPIRED" || order.status === "REJECTED") && order.canReportTransfer &&
                <button type="button" className="button primary" disabled={busy || dispatching || reporting} onClick={() => { setReportError(""); setReportOrder(order); }}>Report a bank transfer</button>}
              {order.transferReported && <div className="stack">
                {order.transferResolution === "REFUNDED" && <>
                  {!order.transferResolvedAt && <p>{order.refundDisputed
                    ? "The seller can see that you haven’t received the full refund. Message them for an update or check WhatsApp for a reply."
                    : "The seller says they sent a refund. Check the bank account or eWallet you provided. If it hasn’t arrived, message the seller or check WhatsApp for updates."}</p>}
                  {order.refundAmount ? <p className="muted">Reported refund {money(order.refundAmount)} · Latest transfer {order.refundSentOn} · Reference {order.refundReference}</p>
                    : <p className="muted">The seller recorded this refund before refund details were collected. Ask the seller for the amount, date, and transfer reference if you need them.</p>}
                  {order.refundNote && <p>Seller message · {order.refundNote}</p>}
                </>}
                {order.transferResolution === "TRANSFER_NOT_FOUND" && <p>The seller could not find this transfer. Check the payment reference you submitted and message the seller if they need more information.</p>}
                {!order.transferResolution && <p>The seller can review your report. Check My orders for updates.</p>}
                {!!order.transferReference && <p className="muted">Original payment reference · {order.transferReference}</p>}
                {order.transferEscalated && !order.transferResolvedAt && <p role="status">Help requested from LockDulu. Keep your payment and refund records.</p>}
                {!order.transferResolvedAt && <div className="button-row">
                  {(Object.keys(transferActions) as TransferAction[]).filter(type => {
                    if (type === "REQUEST_HELP") return !order.transferEscalated;
                    if (type === "CORRECT_REFERENCE") return order.transferResolution === "TRANSFER_NOT_FOUND";
                    if (order.transferResolution !== "REFUNDED") return false;
                    if (type === "DISPUTE_REFUND") return !order.refundDisputed;
                    return !order.refundAmount || Number(order.refundAmount) >= Number(order.total);
                  }).map(type => <button type="button" className="button" key={type} disabled={busy || dispatching || reporting}
                    onClick={() => { setReportError(""); setFollowUp({ order, type }); }}>{transferActions[type]}</button>)}
                </div>}
              </div>}
              {order.status === "AWAITING_RECEIPT" && order.itemId && order.shopStatus === "ACTIVE" &&
                <Link className="button primary" href={`/item/${order.itemId}`}>Resume checkout</Link>}
              {order.shopStatus === "HELD" && <p className="muted">This shop is on hold. You can still track this order and contact the seller.</p>}
              {order.shopStatus === "DELETED" && <p className="muted">This shop has closed. Your order history is still available.</p>}
              {order.dispatchGroupId && <p className="muted">Pieces in this parcel from your orders · {parcelPieces.get(order.dispatchGroupId)?.join(", ")}</p>}
              {hold && order.dispatchRequestedAt && <p className="muted">Contact the seller to arrange and pay for combined shipping.</p>}
              {hold && !order.dispatchRequestedAt && order.shopStatus !== "DELETED" && <button type="button" className="button primary" disabled={busy || dispatching} onClick={() => chooseParcel(order)}>Choose pieces for dispatch</button>}
              {order.sellerPhone ? <>
                <a className="button" href={whatsapp(order.sellerPhone, order.transferReported
                  ? `Hi, I’m following up on the transfer report for LockDulu order ${order.id} (${order.code}).`
                  : `Hi, I have a question about my LockDulu order ${order.id} (${order.code}).`)} target="_blank" rel="noreferrer">
                  <MessageCircle size={17} strokeWidth={1.5} /> Message seller</a>
                <span className="muted seller-contact">Seller WhatsApp +{order.sellerPhone}</span>
              </> : <p className="muted">This shop has no WhatsApp number on file.</p>}
            </div>
          </article>;
        })}
      </div>}
    </main>
    <Footer />
    {parcel && <Sheet title="Request Hold Box dispatch" closeDisabled={dispatching} onClose={() => setParcel(null)}>
      <form className="stack" onSubmit={dispatch}>
        <p><strong>Delivery address</strong><br />{parcel.orders[0]?.shippingAddress}</p>
        <p className="muted">Choose pieces for this address. Contact the seller first if the address needs to change.</p>
        <fieldset className="stack" disabled={dispatching}><legend>Pieces to ship together</legend>
          {parcel.orders.map(order => <label className="parcel-choice" key={order.id}>
            <input type="checkbox" checked={parcel.selected.includes(order.id)} onChange={event => {
              const selected = event.target.checked ? [...parcel.selected, order.id] : parcel.selected.filter(id => id !== order.id);
              setParcel({ ...parcel, selected });
            }} />
            <span>{order.code} · {order.title}</span>
          </label>)}
        </fieldset>
        <p className="muted">Arrange and pay any combined shipping charge with the seller.</p>
        {dispatchError && <Notice>{dispatchError}</Notice>}
        <button className="button primary" disabled={dispatching || !parcel.selected.length}>{dispatching ? "Requesting…" : "Confirm dispatch request"}</button>
      </form>
    </Sheet>}
    {reportOrder && <Sheet title="Report a bank transfer" closeDisabled={reporting} onClose={() => setReportOrder(null)}>
      <form className="stack" onSubmit={submitReport}>
        <p>Send the bank reference for order {reportOrder.id}. The seller can check the transfer and contact you on WhatsApp. The garment may already belong to another buyer.</p>
        <label>Bank transfer reference<input name="reference" required minLength={3} maxLength={120} disabled={reporting} /></label>
        {reportError && <Notice>{reportError}</Notice>}
        <button className="button primary" disabled={reporting}>{reporting ? "Reporting…" : "Send transfer reference"}</button>
      </form>
    </Sheet>}
    {followUp && <Sheet title={transferActions[followUp.type]} closeDisabled={reporting} onClose={() => setFollowUp(null)}>
      <form className="stack" onSubmit={submitFollowUp}>
        <p>Order {followUp.order.id}</p>
        {followUp.type === "CORRECT_REFERENCE" ? <>
          <p>Use the payment reference from the original transfer in your bank or eWallet.</p>
          <label>Payment reference<input name="reference" required minLength={3} maxLength={120} defaultValue={followUp.order.transferReference ?? ""} disabled={reporting} /></label>
        </> : <p>{followUp.type === "CONFIRM_REFUND" ? `Confirm once the full ${money(followUp.order.total)} is in your bank account or eWallet. This closes the transfer report.`
          : followUp.type === "DISPUTE_REFUND" ? "The seller will see that the full amount hasn’t arrived. Your case will stay open."
          : "This shares the order and transfer timeline with LockDulu admins for review. Keep your receipts and bank references for any follow-up."}</p>}
        {reportError && <Notice>{reportError}</Notice>}
        <div className="button-row">
          <button type="button" className="button" disabled={reporting} onClick={() => setFollowUp(null)}>Cancel</button>
          <button className="button primary" disabled={reporting}>{reporting ? "Saving…" : followUp.type === "REQUEST_HELP" ? "Request help" : "Confirm update"}</button>
        </div>
      </form>
    </Sheet>}
  </>;
}
