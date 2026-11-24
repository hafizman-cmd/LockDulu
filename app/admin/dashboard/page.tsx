import Link from "next/link";
import { ArrowUpRight, LayoutGrid, LogOut, ShieldCheck, Store, Tag, CirclePause } from "lucide-react";
import { AdminLogin } from "@/components/admin-login";
import { AdminShopActions } from "@/components/admin-shop-actions";
import { Footer, Header, Notice } from "@/components/common";
import { adminOverview } from "@/lib/admin";
import { adminPasswordMaxLength, adminPath, adminSignInEnabled, currentAdmin } from "@/lib/admin-auth";
import { logoutAdmin } from "./actions";

export const metadata = { title: "Admin dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const numbers = new Intl.NumberFormat("en-MY");
const dates = new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeZone: "Asia/Kuala_Lumpur" });

export default async function AdminDashboardPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
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

  const requestedPage = Number((await searchParams).page);
  const overview = await adminOverview(Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1);
  const metrics = [
    { label: "Registered shops", value: overview.shops, icon: Store },
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

      <section className="surface admin-shops" aria-labelledby="manage-shops">
        <h2 id="manage-shops"><LayoutGrid size={20} aria-hidden="true" /> Manage shops</h2>
        {overview.shopRows.length ? <div className="admin-table-scroll" role="region" aria-label="Shops table" tabIndex={0}>
          <table>
            <thead><tr><th scope="col">Shop</th><th scope="col">Joined</th><th scope="col">Listings</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
            <tbody>{overview.shopRows.map(shop => <tr key={shop.id}>
              <th scope="row">
                {shop.status === "HELD" ? shop.storeName : <Link href={`/${shop.storeSlug}`}>
                  {shop.storeName} <ArrowUpRight size={14} aria-hidden="true" />
                </Link>}
                <span className="muted">@{shop.storeSlug}</span>
              </th>
              <td><time dateTime={shop.createdAt.toISOString()}>{dates.format(shop.createdAt)}</time></td>
              <td>{numbers.format(shop._count.garments)}</td>
              <td><span className={`badge ${shop.status === "HELD" ? "badge-pending_verification" : "badge-available"}`}>{shop.status === "HELD" ? "On hold" : "Active"}</span></td>
              <td>
                <AdminShopActions shopId={shop.id} shopName={shop.storeName} held={shop.status === "HELD"} unresolvedOrders={shop.unresolvedOrders} />
                {shop.unresolvedOrders > 0 && <p className="muted">{shop.unresolvedOrders} unresolved {shop.unresolvedOrders === 1 ? "order" : "orders"}</p>}
              </td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="muted">No shops have registered yet.</p>}
        {overview.pageCount > 1 && <nav className="admin-pagination" aria-label="Shop pages">
          {overview.page > 1 && <Link className="button" href={`${adminPath}?page=${overview.page - 1}`}>Previous</Link>}
          <p className="muted">Page {overview.page} of {overview.pageCount}</p>
          {overview.page < overview.pageCount && <Link className="button" href={`${adminPath}?page=${overview.page + 1}`}>Next</Link>}
        </nav>}
      </section>
    </main>
    <Footer />
  </>;
}
