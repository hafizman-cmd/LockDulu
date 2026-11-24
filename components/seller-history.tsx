"use client";
import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ImagePlus, ReceiptText } from "lucide-react";
import { money, receiptRejectionLabels, whatsapp } from "@/lib/catalog";
import type { SellerHistory } from "@/lib/seller";
import { action, message } from "./client";
import { GarmentPhoto, Notice } from "./common";

const dates = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kuala_Lumpur" });
const statuses = {
  AWAITING_RECEIPT: "Awaiting receipt",
  PENDING_VERIFICATION: "Awaiting payment approval",
  VERIFIED_PAID: "Payment confirmed",
  REJECTED: "Receipt rejected",
  EXPIRED: "Reservation expired",
} as const;

export function SellerHistory({ onReceipt }: { onReceipt: (id: string) => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SellerHistory | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(current => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    action<SellerHistory>("history", { page }, controller.signal).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(exception => {
      if (!controller.signal.aborted) setError(message(exception));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [page, version]);

  return <section className="dash-section stack">
    <div className="section-heading"><div><h2>Order history</h2><p className="muted">Reservations, payment reviews and fulfillment for your shop.</p></div>
      <button type="button" className="button" disabled={loading} onClick={refresh}>Refresh</button></div>
    <p className="muted">Merchandise revenue excludes shipping charged to buyers. Profit requires your item costs and expenses, which are not recorded.</p>
    {error && <Notice>{error}</Notice>}
    {loading && <p role="status" className="muted">Loading history…</p>}
    {!loading && !error && data?.orders.length === 0 && <div className="surface empty">
      <ReceiptText size={30} strokeWidth={1.5} /><h3>No orders yet</h3><p>Reservations will appear here.</p>
    </div>}
    {!loading && !error && data?.orders.map(order => {
      const reason = order.rejectionReason && order.rejectionReason in receiptRejectionLabels
        ? receiptRejectionLabels[order.rejectionReason as keyof typeof receiptRejectionLabels] : null;
      const events = [
        { label: "Reserved", time: order.createdAt },
        { label: "Receipt submitted", time: order.receiptSubmittedAt },
        { label: order.status === "REJECTED" ? "Receipt rejected" : "Payment confirmed", time: order.reviewedAt },
        { label: "Dispatch requested", time: order.dispatchRequestedAt },
        { label: order.shipmentUnconfirmed ? "Shipment recorded" : "Shipped", time: order.shippedAt },
      ].filter(event => event.time);
      return <article className="surface receipt-order stack" key={order.id}>
        <div className="order-body">
          <GarmentPhoto className="order-thumb" src={order.image ?? undefined} alt="" />
          <div className="order-copy"><span className="eyebrow">{order.code}</span><h3>{order.title}</h3><code className="muted">{order.id}</code>
            {order.buyerName && <p>{order.buyerName}{order.buyerPhone && <> · <a href={whatsapp(order.buyerPhone)} target="_blank" rel="noreferrer">+{order.buyerPhone}</a></>}</p>}
            {order.shippingAddress && <p className="muted">{order.shippingAddress}</p>}
          </div>
          <div className="order-total"><span className="badge">{statuses[order.status]}</span></div>
        </div>
        {order.status === "REJECTED" && <p>Reason · {reason ?? "Not recorded"}</p>}
        {order.status === "VERIFIED_PAID" && <dl className="history-amounts">
          <div><dt>Payment received</dt><dd>{money(order.total)}</dd></div>
          <div><dt>Shipping charged</dt><dd>{money(order.shippingCharged)}</dd></div>
          <div><dt>Merchandise revenue</dt><dd>{money(order.itemAmount)}</dd></div>
        </dl>}
        {order.status !== "AWAITING_RECEIPT" && order.status !== "EXPIRED" && <p className="muted">
          {order.fulfillmentType === "HOLD_BOX" ? "Hold Box" : "Ship Now"}
          {order.status === "VERIFIED_PAID" && !order.shippedAt ? order.shipmentUnconfirmed ? " · Shipment status unknown" : " · Not yet shipped" : ""}
        </p>}
        <ul className="history-events">{events.map(event => <li key={event.label}>{event.label} · <time dateTime={event.time!}>{dates.format(new Date(event.time!))}</time></li>)}</ul>
        {order.hasReceipt && <details className="receipt-details"><summary><ImagePlus size={17} strokeWidth={1.5} /> Receipt screenshot <ChevronDown size={17} strokeWidth={1.5} /></summary>
          <button type="button" className="receipt-preview" onClick={() => onReceipt(order.id)} aria-label="Open full-size payment receipt">
            <img src={`/api/receipt/${order.id}`} alt="Payment receipt screenshot" loading="lazy" />
          </button>
        </details>}
      </article>;
    })}
    {!loading && !error && data && data.pageCount > 1 && <nav className="button-row" aria-label="History pages">
      <button type="button" className="button" disabled={data.page <= 1} onClick={() => setPage(data.page - 1)}>Previous</button>
      <span>Page {data.page} of {data.pageCount}</span>
      <button type="button" className="button" disabled={data.page >= data.pageCount} onClick={() => setPage(data.page + 1)}>Next</button>
    </nav>}
  </section>;
}
