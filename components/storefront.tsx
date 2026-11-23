"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Clock3, Globe2, Grid2x2, MapPin, ScanLine, SlidersHorizontal, Tag } from "lucide-react";
import type { readStore } from "@/lib/inventory";
import { categories, measurements, money, timer } from "@/lib/catalog";
import { ActiveLock, Footer, GarmentPhoto, Header, Sheet, Stage } from "./common";
import { json, readLocal, useClock, usePolling, writeLocal } from "./client";

type StoreData = NonNullable<Awaited<ReturnType<typeof readStore>>>;
type Fit = { minPit: string; maxPit: string; minLength: string; maxLength: string };
const emptyFit: Fit = { minPit: "", maxPit: "", minLength: "", maxLength: "" };
const fitFields = [["minPit", "Min pit"], ["maxPit", "Max pit"], ["minLength", "Min labuh"], ["maxLength", "Max labuh"]] as const;
const fits = (value: number, min: string, max: string) => (!min || value >= Number(min)) && (!max || value <= Number(max));

export function Storefront({ initial }: { initial: StoreData }) {
  const slug = initial.store.storeSlug;
  const get = useCallback((signal?: AbortSignal) => json<StoreData>(`/api/store/${encodeURIComponent(slug)}`, { signal }), [slug]);
  const [data] = usePolling(initial, get);
  const now = useClock(data.serverTime);
  const [category, setCategory] = useState<string>("All pieces");
  const [onlyFit, setOnlyFit] = useState(false);
  const [fit, setFit] = useState<Fit>(emptyFit);
  const [draft, setDraft] = useState<Fit | null>(null);
  const [fitError, setFitError] = useState("");
  const [dropId, setDropId] = useState<string | null>(null);
  useEffect(() => {
    setFit(readLocal("lockdulu.fit", emptyFit));
    setOnlyFit(readLocal("lockdulu.onlyFit", false));
  }, []);
  const drop = data.drops.find(entry => entry.id === dropId) ?? data.drops.find(entry => entry.status === "LIVE") ?? data.drops[0];
  const upcoming = drop?.status === "UPCOMING";
  const selectableItems = data.items.filter(item => drop ? item.dropId === drop.id || (drop.status === "LIVE" && !item.dropId) : !item.dropId);
  const visible = selectableItems.filter(item => (category === "All pieces" || item.category === category) &&
    (!onlyFit || (fits(item.pitInches, fit.minPit, fit.maxPit) && fits(item.lengthInches, fit.minLength, fit.maxLength))));

  return <>
    <Header storeSlug={slug} />
    <main className="wrap storefront">
      <div className="store-line">
        <div className="store-emblem"><Tag size={25} strokeWidth={1.5} /></div>
        <div><p className="store-name">{data.store.storeName}</p><p className="muted store-handle">@{slug}</p></div>
        <div className="store-location"><MapPin size={15} strokeWidth={1.5} /> Kuala Lumpur, MY</div>
      </div>
      <section className="hero" aria-label="Current drop">
        <div className="hero-content">
          <div className="hero-meta"><span className="hero-badge"><span />{upcoming ? "Upcoming drop" : drop ? "Live drop" : "Storefront"}</span><span> / </span><span>{data.store.storeName}</span></div>
          <h1>{drop?.title ?? data.store.storeName}</h1>
          <p>{data.store.bio}</p>
          <a href="#pieces" className="hero-button"><Grid2x2 size={16} strokeWidth={1.5} /> {upcoming ? "Preview pieces" : "Browse the drop"}</a>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="hero-outline"/><span className="hero-axis axis-a"/><span className="hero-axis axis-b"/><img src="/sample/drop-jacket.svg" alt="" /></div>
      </section>
      {data.drops.length > 1 && <label className="drop-selector">Browse drop <select value={drop?.id ?? ""} onChange={event => { setDropId(event.target.value); setCategory("All pieces"); }}>
        {data.drops.map(entry => <option key={entry.id} value={entry.id}>{entry.title} ({entry.status === "LIVE" ? "live" : "upcoming"})</option>)}
      </select></label>}
      {upcoming && <div className="launch glass"><Clock3 size={22} strokeWidth={1.5} /><div><strong>Locks open at launch</strong><p className="muted">Days / hours / minutes / seconds</p></div><strong className="timer">{timer(Date.parse(drop.scheduledAt) - now, true)}</strong></div>}
      <section id="pieces" className="pieces">
        <div className="section-heading"><div><span className="eyebrow"><ScanLine size={15} strokeWidth={1.5} /> {upcoming ? "Drop preview" : "Drop inventory"}</span>
          <h2>{upcoming ? "Preview the pieces" : "Shop the drop"}</h2></div>
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
            <div className="card-meta"><div className="card-row"><strong>{money(item.price)}</strong><Stage item={item} now={now} showCondition /></div><p><span>{item.category === "Pants" ? "Waist × Outseam" : "Pit × Labuh"}</span><b>{measurements(item)}</b></p></div>
          </Link>)}
        </div> : <div className="empty surface"><Globe2 size={25} strokeWidth={1.5} /><h3>No matching pieces</h3><p>Change the category or adjust your My Fit range.</p></div>}
      </section>
    </main>
    <Footer storeName={data.store.storeName} />
    <ActiveLock slug={slug} now={now} />
    {draft && <Sheet title="My Fit" onClose={() => setDraft(null)}>
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        if ((draft.minPit && draft.maxPit && Number(draft.minPit) > Number(draft.maxPit)) || (draft.minLength && draft.maxLength && Number(draft.minLength) > Number(draft.maxLength))) {
          setFitError("Each minimum must be at or below its maximum."); return;
        }
        setFit(draft); writeLocal("lockdulu.fit", draft); setOnlyFit(true); writeLocal("lockdulu.onlyFit", true); setDraft(null);
      }}>
        <p className="muted">Set the garment measurements that fit you. Leave a field blank for an open range.</p>
        <div className="field-grid">{fitFields.map(([key, label]) => <label key={key}>{label} (in)<input type="number" inputMode="decimal" min="0" max="100" step=".1" value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })} /></label>)}</div>
        {fitError && <p role="alert" className="timer">{fitError}</p>}
        <button className="button primary">Save and apply</button>
      </form>
    </Sheet>}
  </>;
}
