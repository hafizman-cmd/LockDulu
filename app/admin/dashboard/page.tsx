import Link from "next/link";
import { ArrowUpRight, LayoutGrid, LogOut, ShieldCheck, Store, Tag, CirclePause } from "lucide-react";
import { AdminLogin } from "@/components/admin-login";
import { AdminShopActions, AdminShopFeedback } from "@/components/admin-shop-actions";
import { Footer, Header, Notice } from "@/components/common";
import { adminTransferCases } from "@/lib/admin";
import { adminPasswordMaxLength, adminPath, adminSignInEnabled, currentAdmin } from "@/lib/admin-auth";
import { money, rejectionMessage, transferEventLabels, whatsapp } from "@/lib/catalog";
import { logoutAdmin } from "./actions";
import { readShopOverview } from "./shop-overview";

export const metadata = { title: "Admin dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const numbers = new Intl.NumberFormat("en-MY");
const dates = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur" });

function pageNumber(value: string | undefined) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

type SearchParams = Record<string, string | string[] | undefined>;
const first = (value: SearchParams[string]) => Array.isArray(value) ? value[0] : value;

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!await currentAdmin()) {
    return <>
      <Header />
      <main className="wrap secondary-page">
        <div className="section-intro">
          <h1>Admin sign in</h1>
          <p>Sign in to view the LockDulu platform overview.</p>
        </div>
        {adminSignInEnabled() ? <AdminLogin maxLength={adminPasswordMaxLength} /> : <Notice>Admin sign-in is unavailable.</Notice>}
      </main>
      <Footer />
    </>;
  }

  const params = await searchParams;
  const handle = (first(params.handle) ?? "").trim().replace(/^@/, "").trim().toLowerCase().slice(0, 80);
  const requestedStatus = first(params.status);
  const status = requestedStatus === "ACTIVE" || requestedStatus === "HELD" ? requestedStatus : undefined;
  const [overview, cases] = await Promise.all([
    readShopOverview(pageNumber(first(params.page)), handle, status),
    adminTransferCases(pageNumber(first(params.helpPage))),
  ]);
  const pageHref = (shopPage: number, helpPage: number, section: string, keepFilters = true) => {
    const query = new URLSearchParams({ page: String(shopPage), helpPage: String(helpPage) });
    if (keepFilters && handle) query.set("handle", handle);
    if (keepFilters && status) query.set("status", status);
    return `${adminPath}?${query}#${section}`;
  };
  const filtered = !!(handle || status);
  const metrics = [
    { label: "Shops excluding deleted", value: overview.shops, icon: Store },
    { label: "Listings", value: overview.listings, icon: Tag },
    { label: "Active shops", value: overview.activeShops, icon: ShieldCheck },
    { label: "Shops on hold", value: overview.heldShops, icon: CirclePause },
  ];

  return <>
    <Header />
    <main className="wrap dashboard admin-dashboard">
      <div className="admin-heading">
        <div className="section-intro">
          <h1>Admin dashboard</h1>
          <p>Manage shops across LockDulu.</p>
        </div>
        <form action={logoutAdmin}>
          <button className="button"><LogOut size={17} aria-hidden="true" /> Sign out</button>
        </form>
      </div>

      <dl className="admin-metrics" aria-label="Platform totals">
        {metrics.map(({ label, value, icon: Icon }) => <div className="surface admin-metric" key={label}>
          <dt><Icon size={18} strokeWidth={1.6} aria-hidden="true" /> {label}</dt>
          <dd>{numbers.format(value)}</dd>
        </div>)}
      </dl>

      <section className="surface admin-shops stack" aria-labelledby="transfer-help">
        <h2 id="transfer-help">Transfer help requests ({cases.count})</h2>
        {cases.orders.length === 0 && <p className="muted">No open transfer help requests.</p>}
        {cases.orders.map(order => <details className="surface receipt-order stack" key={order.id}>
          <summary>{order.seller.storeName} · {order.garmentCode} · {money(order.totalAmount.toFixed(2))}</summary>
          <p>Order {order.id} · @{order.seller.storeSlug}</p>
          <p>Original payment reference · {order.transferReference}</p>
          {order.refundNote && <p>Seller message · {order.refundNote}</p>}
          {order.rejectionReason && <p>{rejectionMessage(order.rejectionReason)}</p>}
          <div className="button-row">
            {order.buyerPhone && <a className="button" href={whatsapp(order.buyerPhone)} target="_blank" rel="noreferrer">Message buyer</a>}
            {order.seller.whatsappNumber && <a className="button" href={whatsapp(order.seller.whatsappNumber)} target="_blank" rel="noreferrer">Message seller</a>}
          </div>
          <ul className="history-events">
            {order.transferReportedAt && <li>Buyer reported a bank transfer · <time dateTime={order.transferReportedAt.toISOString()}>{dates.format(order.transferReportedAt)}</time></li>}
            {[...order.transferEvents].reverse().map(event => <li key={event.version}>
              {transferEventLabels[event.kind] ?? "Transfer report updated"} · <time dateTime={event.createdAt.toISOString()}>{dates.format(event.createdAt)}</time>
              {event.detail && <> · {event.detail}</>}
            </li>)}
          </ul>
        </details>)}
        {cases.pageCount > 1 && <nav className="admin-pagination" aria-label="Transfer help pages">
          {cases.page > 1 && <Link className="button" href={pageHref(overview.page, cases.page - 1, "transfer-help")}>Previous</Link>}
          <p className="muted">Page {cases.page} of {cases.pageCount}</p>
          {cases.page < cases.pageCount && <Link className="button" href={pageHref(overview.page, cases.page + 1, "transfer-help")}>Next</Link>}
        </nav>}
      </section>

      <section className="surface admin-shops" aria-labelledby="manage-shops">
        <h2 id="manage-shops"><LayoutGrid size={20} aria-hidden="true" /> Manage shops</h2>
        <form className="admin-shop-filters" action={`${adminPath}#manage-shops`} role="search" aria-label="Shop filters">
          <input type="hidden" name="helpPage" value={cases.page} />
          <div className="admin-filter-field">
            <label htmlFor="admin-handle">Shop handle</label>
            <input key={handle} id="admin-handle" name="handle" type="search" maxLength={80} defaultValue={handle} placeholder="@shop.handle" />
          </div>
          <div className="admin-filter-field">
            <label htmlFor="admin-status">Status</label>
            <select key={status ?? "all"} id="admin-status" name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="HELD">On hold</option>
            </select>
          </div>
          <button className="button primary" type="submit">Apply filters</button>
          {filtered && <Link className="button" href={pageHref(1, cases.page, "manage-shops", false)}>Clear filters</Link>}
        </form>
        <p className="muted admin-shop-result">{numbers.format(overview.matches)} {overview.matches === 1 ? "shop" : "shops"}{filtered ? " match your filters" : ""}</p>
        <AdminShopFeedback>
          {overview.shopRows.length ? <ul className="admin-shop-list" role="list" aria-label="Shops">
            {overview.shopRows.map(shop => {
              const held = shop.status === "HELD";
              const unresolved = shop._count.orders;
              return <li className="surface admin-shop-card" key={shop.id}>
                <div className="admin-shop-identity">
                  <div>
                    <h3>{held ? shop.storeName : <Link href={`/${shop.storeSlug}`}>{shop.storeName} <ArrowUpRight size={14} aria-hidden="true" /></Link>}</h3>
                    <p className="muted">@{shop.storeSlug}</p>
                  </div>
                  <span className={`badge ${held ? "badge-pending_verification" : "badge-available"}`}>{held ? "On hold" : "Active"}</span>
                </div>
                <p className="muted">Joined <time dateTime={shop.createdAt.toISOString()}>{dates.format(shop.createdAt)}</time></p>
                <dl className="admin-shop-counts">
                  <div><dt>Listings</dt><dd>{numbers.format(shop._count.garments)}</dd></div>
                  <div><dt>Pending receipts</dt><dd>{numbers.format(shop.pendingReceipts)}</dd></div>
                  <div><dt>Open shipments</dt><dd>{numbers.format(shop.openShipments)}</dd></div>
                </dl>
                <AdminShopActions shopId={shop.id} shopName={shop.storeName} held={held} unresolvedOrders={unresolved} />
                {unresolved > 0 && <p className="muted">Resolve {numbers.format(unresolved)} open {unresolved === 1 ? "order" : "orders"} before deleting this shop.</p>}
              </li>;
            })}
          </ul> : <p className="muted">{filtered ? "Try another handle or status." : "No active or held shops yet."}</p>}
        </AdminShopFeedback>
        {overview.pageCount > 1 && <nav className="admin-pagination" aria-label="Shop pages">
          {overview.page > 1 && <Link className="button" href={pageHref(overview.page - 1, cases.page, "manage-shops")}>Previous</Link>}
          <p className="muted">Page {overview.page} of {overview.pageCount}</p>
          {overview.page < overview.pageCount && <Link className="button" href={pageHref(overview.page + 1, cases.page, "manage-shops")}>Next</Link>}
        </nav>}
      </section>
    </main>
    <Footer />
  </>;
}
