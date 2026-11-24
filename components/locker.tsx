"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Box, Clock3, MessageCircle, PackageCheck, Search } from "lucide-react";
import type { LockerOrder } from "@/lib/seller";
import { holdBoxDaysLeft, money, rejectionMessage, whatsapp } from "@/lib/catalog";
import { action, message, savedLocks } from "./client";
import { Footer, GarmentPhoto, Header, Notice, Sheet } from "./common";

type View = "orders" | "hold" | "history";
type Parcel = { orders: LockerOrder[]; selected: string[] };

function openHoldBox(order: LockerOrder) {
  return order.status === "VERIFIED_PAID" && order.fulfillmentType === "HOLD_BOX" && !order.shippedAt;
}

function isPastOrder(order: LockerOrder) {
  return !!order.shippedAt || order.status === "REJECTED" || order.status === "EXPIRED";
}

function orderLabel(order: LockerOrder, now: number) {
  if (order.status === "AWAITING_RECEIPT") return "Awaiting receipt upload";
  if (order.status === "EXPIRED") return "Reservation expired";
  if (order.status === "PENDING_VERIFICATION") return "Awaiting payment approval";
  if (order.status === "REJECTED") return "Receipt rejected";
  if (order.shippedAt) return order.shipmentUnconfirmed ? "Shipment recorded" : "Shipped";
  if (order.shipmentUnconfirmed) return order.shopStatus === "DELETED" ? "Shipment status unavailable" : "Shipment status being confirmed";
  if (!openHoldBox(order)) return "Payment confirmed · Awaiting shipment";
  if (order.dispatchRequestedAt) return "Dispatch requested";
  if (!order.verifiedAt) return "In Hold Box";
  const days = holdBoxDaysLeft(order.verifiedAt, order.holdBoxDays, now);
  return days <= 0 ? "Hold Box overdue" : `${days} ${days === 1 ? "day" : "days"} left in Hold Box`;
}

export function Locker() {
  const [number, setNumber] = useState("");
  const [trackedId, setTrackedId] = useState("");
  const [orders, setOrders] = useState<LockerOrder[] | null>(null);
  const [view, setView] = useState<View>("orders");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [now, setNow] = useState(0);
  const [parcel, setParcel] = useState<Parcel | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState("");

  useEffect(() => {
    setNumber(new URLSearchParams(window.location.search).get("order") ?? "");
  }, []);

  async function lookup(value: string, showTrackedOrder = false) {
    const orderNumber = value.trim().toLowerCase();
    if (!orderNumber) throw new Error("Enter the order number from checkout.");
    const tokens = savedLocks().filter(entry => entry.orderId).map(entry => entry.token);
    if (!tokens.length) throw new Error("Open this tracker in the browser you used at checkout. No saved checkouts were found here.");
    const result = await action<{ orders: LockerOrder[] }>("locker", { orderNumber, tokens });
    const tracked = result.orders.find(order => order.id === orderNumber);
    if (!tracked) throw new Error("Could not find that order number.");
    setTrackedId(tracked.id);
    setOrders([tracked, ...result.orders.filter(order => order.id !== tracked.id)]);
    setNow(Date.now());
    if (showTrackedOrder) setView(isPastOrder(tracked) ? "history" : openHoldBox(tracked) ? "hold" : "orders");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setSuccess("");
    try { await lookup(number, true); }
    catch (exception) { setError(message(exception)); }
    finally { setBusy(false); }
  }

  function chooseParcel(order: LockerOrder) {
    const compatible = orders?.filter(entry => openHoldBox(entry) && !entry.dispatchRequestedAt &&
      entry.sellerId === order.sellerId && entry.shippingAddress === order.shippingAddress) ?? [];
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
      try { await lookup(trackedId); }
      catch (exception) { setError(`Refresh your orders to see the new parcel. ${message(exception)}`); }
    } catch (exception) { setDispatchError(message(exception)); }
    finally { setDispatching(false); }
  }

  const visible = orders?.filter(order => view === "hold" ? openHoldBox(order)
    : view === "history" ? isPastOrder(order) : !isPastOrder(order));
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
      <form className="surface stack lookup" onSubmit={submit}>
        <label>Order number<input required type="text" autoComplete="off" autoCapitalize="none" spellCheck={false}
          value={number} maxLength={100} disabled={busy || dispatching} placeholder="Paste your order number"
          onChange={event => { setNumber(event.target.value); setOrders(null); setError(""); setSuccess(""); }} /></label>
        <p className="muted">Use the order number from checkout in the browser where you placed the order.</p>
        <button className="button primary" disabled={busy || dispatching}><Search size={18} strokeWidth={1.5} />{busy ? "Looking up order…" : orders ? "Refresh orders" : "Find order"}</button>
      </form>
      {error && <Notice>{error}</Notice>}
      {success && <Notice success>{success}</Notice>}
      {visible && <div className="stack locker-results">
        <nav className="dashboard-tabs" aria-label="Order sections">
          {([["orders", "Active orders"], ["hold", "Hold Box"], ["history", "History"]] as const).map(([key, label]) =>
            <button type="button" key={key} className={view === key ? "selected" : ""} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}
        </nav>
        {visible.length === 0 && <div className="surface empty"><Box size={24} strokeWidth={1.5} />
          <h2>{view === "hold" ? "No open Hold Box pieces" : view === "history" ? "No past orders" : "No active orders"}</h2>
          <p>Check another order section.</p></div>}
        {visible.map(order => {
          const pending = order.status !== "VERIFIED_PAID" || order.shipmentUnconfirmed && !order.shippedAt;
          const hold = openHoldBox(order);
          return <article className="surface locker-order" key={order.id}>
            <GarmentPhoto className="order-thumb" src={order.image ?? undefined} alt="" />
            <div className="locker-order-copy"><p className="eyebrow">{order.storeName} / {order.code}</p><h2>{order.title}</h2><p>{money(order.total)} · {order.fulfillmentType === "HOLD_BOX" ? "Hold Box" : "Ship Now"}</p>
              <code className="muted">{order.id}{order.id === trackedId && <span className="tracked-order-label"> · Tracked order</span>}</code>
              <span className={`badge badge-${pending ? "pending_verification" : "hold_box"}`}>
                {pending ? <Clock3 size={13} strokeWidth={1.5} /> : <PackageCheck size={13} strokeWidth={1.5} />}
                {orderLabel(order, now)}</span>
              {order.status === "REJECTED" && <p>{rejectionMessage(order.rejectionReason)}</p>}
              {order.status === "EXPIRED" && <p>If you transferred, keep your bank reference and contact the seller before paying again.</p>}
              {order.status === "AWAITING_RECEIPT" && order.itemId && order.shopStatus === "ACTIVE" &&
                <Link className="button primary" href={`/item/${order.itemId}`}>Resume checkout</Link>}
              {order.shopStatus === "HELD" && <p className="muted">This shop is on hold. You can still track this order and contact the seller.</p>}
              {order.shopStatus === "DELETED" && <p className="muted">This shop has closed. Your order history is still available.</p>}
              {order.dispatchGroupId && <p className="muted">Pieces in this parcel from your orders · {parcelPieces.get(order.dispatchGroupId)?.join(", ")}</p>}
              {hold && order.dispatchRequestedAt && <p className="muted">Contact the seller to arrange and pay for combined shipping.</p>}
              {hold && !order.dispatchRequestedAt && order.shopStatus !== "DELETED" && <button type="button" className="button primary" disabled={busy || dispatching} onClick={() => chooseParcel(order)}>Choose pieces for dispatch</button>}
              {order.sellerPhone ? <>
                <a className="button" href={whatsapp(order.sellerPhone, `Hi, I have a question about my LockDulu order ${order.id} (${order.code}).`)} target="_blank" rel="noreferrer">
                  <MessageCircle size={17} strokeWidth={1.5} /> Message seller</a>
                <span className="muted seller-contact">Seller WhatsApp +{order.sellerPhone}</span>
              </> : <p className="muted">This shop has no WhatsApp number on file.</p>}
            </div>
          </article>;
        })}
      </div>}
    </main>
    <Footer />
    {parcel && <Sheet title="Request Hold Box dispatch" onClose={() => { if (!dispatching) setParcel(null); }}>
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
  </>;
}
