import Link from "next/link";
import { ArrowUpRight, Search, Store } from "lucide-react";
import { Footer, Header } from "@/components/common";
import { readShopDirectory } from "@/lib/shop-directory";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim() ?? "";
  const shops = await readShopDirectory(query);

  return <>
    <Header />
    <main className="wrap shop-directory">
      <h1>Browse shops</h1>
      <form className="shop-search" action="/" role="search">
        <label htmlFor="shop-search">Search by shop name or handle</label>
        <div className="shop-search-fields">
          <input key={query} id="shop-search" name="q" type="search" defaultValue={query} />
          <button className="button primary" type="submit"><Search size={17} aria-hidden="true" /> Search</button>
        </div>
        {query && <Link className="text-button" href="/">Clear search</Link>}
      </form>
      {shops.length ? <ul className="shop-grid" aria-label="Shops">
        {shops.map(shop => <li key={shop.storeSlug}>
          <Link className="shop-card surface" href={`/${shop.storeSlug}`}>
            <span className="store-emblem"><Store size={23} strokeWidth={1.5} aria-hidden="true" /></span>
            <div className="shop-card-info">
              <h2>{shop.storeName}</h2>
              <p className="muted store-handle">@{shop.storeSlug}</p>
              {shop.bio && <p className="shop-bio muted">{shop.bio}</p>}
            </div>
            <ArrowUpRight size={20} strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </li>)}
      </ul> : <div className="empty surface">
        <h2>{query ? "No matching shops" : "No shops yet"}</h2>
        {query && <p>Try another shop name or handle.</p>}
      </div>}
    </main>
    <Footer />
  </>;
}
