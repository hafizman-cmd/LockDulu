"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock3, Globe2, Grid2x2, ScanLine, SlidersHorizontal, Tag } from "lucide-react";
import type { readStore } from "@/lib/inventory";
import { categories, measurements, money, timer } from "@/lib/catalog";
import { ActiveLock, AvailabilityNotice, Footer, GarmentPhoto, Header, Sheet, Stage } from "./common";
import { json, readLocal, RequestError, useClock, usePolling, writeLocal } from "./client";

type StoreData = NonNullable<Awaited<ReturnType<typeof readStore>>>;
const fitFields = [
  { label: "Tops", ranges: [["minPit", "maxPit", "Pit-to-pit"], ["minLength", "maxLength", "Labuh"]] },
  { label: "Pants", ranges: [["minWaist", "maxWaist", "Flat waist"], ["minOutseam", "maxOutseam", "Outseam"]] },
] as const;
type Fit = Record<(typeof fitFields)[number]["ranges"][number][0 | 1], string>;
const emptyFit: Fit = { minPit: "", maxPit: "", minLength: "", maxLength: "", minWaist: "", maxWaist: "", minOutseam: "", maxOutseam: "" };
const fits = (value: number, min: string, max: string) => (!min || value >= Number(min)) && (!max || value <= Number(max));

export function Storefront({ initial }: { initial: StoreData }) {
  const slug = initial.store.storeSlug;
  const router = useRouter();
  const get = useCallback(async (signal?: AbortSignal) => {
    try { return await json<StoreData>(`/api/store/${encodeURIComponent(slug)}`, { signal }); }
    catch (error) {
      if (error instanceof RequestError && error.status === 404) router.refresh();
      throw error;
    }
  }, [slug, router]);
  const [data, , stale] = usePolling(initial, get);
  const now = useClock(data.serverTime);
  const [category, setCategory] = useState<string>("All pieces");
  const [onlyFit, setOnlyFit] = useState(false);
  const [fit, setFit] = useState<Fit>(emptyFit);
  const [draft, setDraft] = useState<Fit | null>(null);
  const [fitError, setFitError] = useState("");
  const [selection, setSelection] = useState("all");
  const [failedBanner, setFailedBanner] = useState<string | null>(null);
  useEffect(() => {
    setFit({ ...emptyFit, ...readLocal<Partial<Fit>>("lockdulu.fit", {}) });
    setOnlyFit(readLocal("lockdulu.onlyFit", false));
  }, []);
  const drop = data.drops.find(entry => entry.id === selection);
  const filter = drop || selection === "available" || selection === "no-drop" ? selection : "all";
  const upcoming = drop?.status === "UPCOMING";
  const selectableItems = data.items.filter(item => {
    if (drop) return item.dropId === drop.id;
    if (filter === "no-drop") return !item.dropId;
    if (filter === "available") return item.status === "AVAILABLE" && item.locksOpen;
    return true;
  });
  const visible = selectableItems.filter(item => {
    if (category !== "All pieces" && item.category !== category) return false;
    if (!onlyFit) return true;
    return item.category === "Pants"
      ? fits(item.pitInches, fit.minWaist, fit.maxWaist) && fits(item.lengthInches, fit.minOutseam, fit.maxOutseam)
      : fits(item.pitInches, fit.minPit, fit.maxPit) && fits(item.lengthInches, fit.minLength, fit.maxLength);
  });

  return <>
    <Header storeSlug={slug} />
    <main className="wrap storefront">
      <div className="store-line">
        <div className="store-emblem"><Tag size={25} strokeWidth={1.5} /></div>
        <div><p className="store-name">{data.store.storeName}</p><p className="muted store-handle">@{slug}</p></div>
      </div>
      <section className="hero" aria-label="Current drop">
        <div className="hero-content">
          <div className="hero-meta"><span className="hero-badge"><span />{upcoming ? "Upcoming drop" : drop ? "Live drop" : "Storefront"}</span><span> / </span><span>{data.store.storeName}</span></div>
          <h1>{drop?.title ?? data.store.storeName}</h1>
          <p>{data.store.bio}</p>
          <a href="#pieces" className="hero-button"><Grid2x2 size={16} strokeWidth={1.5} /> {upcoming ? "Preview pieces" : "Browse pieces"}</a>
        </div>
        {data.store.bannerImageUrl && data.store.bannerImageUrl !== failedBanner ?
          <div className="hero-art hero-art-custom" aria-hidden="true"><img src={data.store.bannerImageUrl} alt="" onError={() => setFailedBanner(data.store.bannerImageUrl)} /></div> :
          <div className="hero-art" aria-hidden="true"><div className="hero-outline"/><span className="hero-axis axis-a"/><span className="hero-axis axis-b"/><img src="/sample/drop-jacket.svg" alt="" /></div>}
      </section>
      {stale && <AvailabilityNotice serverTime={data.serverTime} />}
      {!data.store.paymentReady && data.items.length > 0 && <p className="muted">You can browse this shop while the seller sets up payments.</p>}
      <label className="drop-selector">Browse pieces <select value={filter} onChange={event => { setSelection(event.target.value); setCategory("All pieces"); }}>
        <option value="all">All pieces</option>
        <option value="available">Available now</option>
        <option value="no-drop">No drop</option>
        {data.drops.map(entry => <option key={entry.id} value={entry.id}>{entry.title} ({entry.status === "LIVE" ? "live" : "upcoming"})</option>)}
      </select></label>
      {upcoming && <div className="launch glass"><Clock3 size={22} strokeWidth={1.5} /><div><strong>Locks open at launch</strong><p className="muted">Days / hours / minutes / seconds</p></div><strong className="timer">{timer(Date.parse(drop.scheduledAt) - now, true)}</strong></div>}
      <section id="pieces" className="pieces">
        <div className="section-heading"><div><span className="eyebrow"><ScanLine size={15} strokeWidth={1.5} /> {upcoming ? "Drop preview" : "Inventory"}</span>
          <h2>{drop?.title ?? (filter === "available" ? "Available now" : filter === "no-drop" ? "Pieces with no drop" : "All pieces")}</h2></div>
          <span className="piece-count">{visible.length} {visible.length === 1 ? "piece" : "pieces"}</span>
        </div>
        <div className="filter-bar glass">
          <div className="category-list" aria-label="Garment category">
            {["All pieces", ...categories.filter(kind => selectableItems.some(item => item.category === kind)).map(String)].map(kind =>
              <button key={kind} className={category === kind ? "selected" : ""} aria-pressed={category === kind} onClick={() => setCategory(kind)}>{kind}</button>
            )}
          </div>
          <div className="fit-actions">
            <button className="fit-config" onClick={() => { setFitError(""); setDraft(fit); }}><SlidersHorizontal size={17} strokeWidth={1.5} /> My Fit</button>
            <label className="toggle"><input type="checkbox" checked={onlyFit} onChange={event => {
              setOnlyFit(event.target.checked); writeLocal("lockdulu.onlyFit", event.target.checked);
            }} /><span />My Fit Only</label>
          </div>
        </div>
        {visible.length ? <div className="garment-grid">
          {visible.map(item => <Link key={item.id} href={`/item/${item.id}`} className="garment-card" aria-label={`${item.title}, ${money(item.price)}, ${measurements(item)}`}>
            <GarmentPhoto className="card-photo" src={item.images[0]} alt={item.title} loading="lazy" />
            <div className="card-meta"><h3>{item.title}</h3><div className="card-row"><strong>{money(item.price)}</strong><Stage item={item} now={now} showCondition buyer /></div><p><span>{item.category === "Pants" ? "Waist × Outseam" : "Pit × Labuh"}</span><b>{measurements(item)}</b></p></div>
          </Link>)}
        </div> : <div className="empty surface"><Globe2 size={25} strokeWidth={1.5} />
          <h3>{!data.items.length ? "This shop has no pieces yet" : !selectableItems.length ? (drop ? "This drop has no pieces yet" : filter === "available" ? "No pieces available right now" : "All pieces belong to a drop") : "No matching pieces"}</h3>
          {!!selectableItems.length && <button type="button" className="button" onClick={() => { setCategory("All pieces"); setOnlyFit(false); writeLocal("lockdulu.onlyFit", false); }}>Clear filters</button>}
        </div>}
      </section>
    </main>
    <Footer storeName={data.store.storeName} />
    <ActiveLock slug={slug} now={now} />
    {draft && <Sheet title="My Fit" onClose={() => setDraft(null)}>
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        if (fitFields.some(group => group.ranges.some(([min, max]) => draft[min] && draft[max] && Number(draft[min]) > Number(draft[max])))) {
          setFitError("Each minimum must be at or below its maximum."); return;
        }
        setFit(draft); writeLocal("lockdulu.fit", draft); setOnlyFit(true); writeLocal("lockdulu.onlyFit", true); setDraft(null);
      }}>
        <p className="muted">Set the garment measurements that fit you. Leave a field blank for an open range.</p>
        {fitFields.map(group => <fieldset key={group.label}><legend>{group.label}</legend><div className="field-grid">
          {group.ranges.flatMap(([min, max, label]) => ([min, max] as const).map((key, index) => <label key={key}>{index === 0 ? "Min" : "Max"} {label} (in)
            <input type="number" inputMode="decimal" min="0" max="100" step=".1" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} />
          </label>))}
        </div></fieldset>)}
        {fitError && <p role="alert" className="timer">{fitError}</p>}
        <button className="button primary">Save and apply</button>
      </form>
    </Sheet>}
  </>;
}
