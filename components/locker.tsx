"use client";
import { useEffect, useState } from "react";
import { Box, Clock3, MessageCircle, PackageCheck, Search } from "lucide-react";
import type { LockerOrder } from "@/lib/seller";
import { money, whatsapp } from "@/lib/catalog";
import { action, message, readLocal, savedLocks } from "./client";
import { Footer, Header, Notice } from "./common";

export function Locker() {
  const [phone, setPhone] = useState("");
  const [orders, setOrders] = useState<LockerOrder[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(0);
  const [dispatching, setDispatching] = useState<string | null>(null);

  useEffect(() => { setPhone(readLocal("lockdulu.delivery", { buyerPhone: "" }).buyerPhone); setNow(Date.now()); }, []);
  async function lookup(value: string) {
    const tokens = savedLocks().map(entry => entry.token);
    const result = await action<{ orders: LockerOrder[] }>("locker", { phone: value, tokens });
    setOrders(result.orders); setNow(Date.now());
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setOrders(null);
    try { await lookup(phone); } catch (exception) { setError(message(exception)); }
    finally { setBusy(false); }
  }
  async function dispatch(order: LockerOrder) {
    const token = savedLocks().find(entry => entry.orderId === order.id)?.token;
    if (!token) { setError("Open this tracker in the browser used at checkout."); return; }
    setDispatching(order.id); setError("");
    try { await action("dispatch", { phone, token }); await lookup(phone); }
    catch (exception) { setError(message(exception)); } finally { setDispatching(null); }
  }

  return <>
    <Header />
    <main className="wrap secondary-page">
      <div className="section-intro"><span className="eyebrow"><Box size={17} strokeWidth={1.5} /> Buyer tools</span><h1>My Hold Box</h1>
        <p>Track receipts under review and combine verified garments into one parcel.</p></div>
      <form className="surface stack lookup" onSubmit={submit}>
        <label>WhatsApp phone<input required type="tel" autoComplete="tel" value={phone} placeholder="012 345 6789" onChange={event => {
          setPhone(event.target.value); setOrders(null); setError("");
        }} /></label>
        <p className="muted">Enter your checkout number in the browser you used to submit payment.</p>
        <button className="button primary" disabled={busy}><Search size={18} strokeWidth={1.5} />{busy ? "Looking up orders…" : "Find my pieces"}</button>
      </form>
      {error && <Notice>{error}</Notice>}
      {orders && <div className="stack locker-results">
        {orders.length === 0 && <div className="surface empty"><Box size={24} strokeWidth={1.5} /><h2>No active orders</h2><p>Pending receipts and verified Hold Box pieces appear here.</p></div>}
        {orders.map(order => {
          const pending = order.status === "PENDING_VERIFICATION";
          const days = order.verifiedAt ? Math.max(0, Math.ceil((Date.parse(order.verifiedAt) + order.holdBoxDays * 86_400_000 - now) / 86_400_000)) : 0;
          return <article className="surface locker-order" key={order.id}>
            <img src={order.image} alt="" />
            <div><p className="eyebrow">{order.storeName} / {order.code}</p><h2>{order.title}</h2><p>{money(order.total)}</p>
              <span className={`badge badge-${pending ? "pending_verification" : "hold_box"}`}>
                {pending ? <Clock3 size={13} strokeWidth={1.5} /> : <PackageCheck size={13} strokeWidth={1.5} />}
                {pending ? "Payment under review" : `${days} ${days === 1 ? "day" : "days"} left in Hold Box`}</span>
              {!pending && (order.dispatchRequestedAt ? <a className="button" href={whatsapp(order.sellerPhone, `Hi, I requested dispatch for my LockDulu Hold Box. Order ${order.id} (${order.code}).`)} target="_blank" rel="noreferrer">
                <MessageCircle size={17} strokeWidth={1.5} /> Dispatch requested · Message seller</a>
                : <button type="button" className="button" disabled={!!dispatching} onClick={() => dispatch(order)}>{dispatching === order.id ? "Requesting…" : "Request combined dispatch"}</button>)}
            </div>
          </article>;
        })}
      </div>}
    </main>
    <Footer />
  </>;
}
