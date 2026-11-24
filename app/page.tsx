import Link from "next/link";
import { ArrowUpRight, Search, Store } from "lucide-react";
import { Footer, Header } from "@/components/common";
import { readDirectoryPage } from "./shop-directory";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const { q, page: pageParam } = await searchParams;
  const query = (Array.isArray(q) ? q[0] : q)?.trim() ?? "";
  const requestedPage = Number(Array.isArray(pageParam) ? pageParam[0] : pageParam);
  const { shops, total, page, pageCount } = await readDirectoryPage(
    query, Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
  );
  const pageLink = (target: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (target > 1) params.set("page", String(target));
    return params.size ? `/?${params}` : "/";
  };

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
      {pageCount > 1 && <p className="shop-page-count muted">{total.toLocaleString("en-MY")} {query ? "matching shops" : "shops"}</p>}
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
      {pageCount > 1 && <nav className="shop-pagination" aria-label="Shop directory pages">
        {page > 1 && <Link className="button" href={pageLink(page - 1)}>Previous page</Link>}
        <p className="muted">Page {page} of {pageCount}</p>
        {page < pageCount && <Link className="button" href={pageLink(page + 1)}>Next page</Link>}
      </nav>}
    </main>
    <Footer />
  </>;
}
