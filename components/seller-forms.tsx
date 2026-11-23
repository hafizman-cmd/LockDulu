"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Minus, Plus, QrCode, Trash2 } from "lucide-react";
import { categories, grades, type Pin } from "@/lib/catalog";
import { garmentBackgrounds, makeGarmentPhoto, prepareGarmentCutout, type GarmentBackground } from "@/lib/garment-background";
import type { DashboardData } from "@/lib/seller";
import { action, message, upload } from "./client";
import { Notice, Sheet } from "./common";

async function sendImage(file: File, kind: "garment" | "qr") {
  const form = new FormData();
  form.set("file", file);
  return (await upload<{ url: string }>(kind, form)).url;
}

type FrontCutout = {
  source: string;
  image: { canvas: HTMLCanvasElement; preview: string } | null;
};

function Stepper({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const update = (amount: number) => onChange(String(Math.min(100, Math.max(5, (Number(value) || 0) + amount))));
  return <label>{label}<div className="stepper">
    <button type="button" className="icon-button" onClick={() => update(-0.5)} aria-label={`Decrease ${label}`}><Minus size={16} strokeWidth={1.5} /></button>
    <input required type="number" inputMode="decimal" min="5" max="100" step=".1" value={value} onChange={event => onChange(event.target.value)} />
    <button type="button" className="icon-button" onClick={() => update(0.5)} aria-label={`Increase ${label}`}><Plus size={16} strokeWidth={1.5} /></button>
  </div></label>;
}

export function QuickList({ data, onClose, onListed }: { data: DashboardData; onClose: () => void; onListed: (code: string) => Promise<void> }) {
  const [grade, setGrade] = useState<keyof typeof grades>("VINTAGE_FADE");
  const [photos, setPhotos] = useState<(string | null)[]>([null, null, null]);
  const [background, setBackground] = useState<GarmentBackground>("White");
  const [cutout, setCutout] = useState<FrontCutout | null>(null);
  const savedFront = useRef<{ source: string; background: GarmentBackground; url: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [pins, setPins] = useState<Pin[]>([]);
  const [activePin, setActivePin] = useState<number | null>(null);
  const [pinPhoto, setPinPhoto] = useState<"front" | "back">("front");
  const [pit, setPit] = useState("22");
  const [length, setLength] = useState("28");
  const [category, setCategory] = useState<string>("Tee");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const front = photos[0];
  const frontCutout = cutout?.source === front ? cutout : null;
  const preparing = Boolean(front && !frontCutout);
  const useOriginal = background === "Original" || frontCutout?.image === null;
  const color = useOriginal ? undefined : garmentBackgrounds[background];
  const preview = color ? frontCutout?.image?.preview ?? front : front;
  const previewColor = frontCutout?.image ? color : undefined;

  useEffect(() => {
    if (!front) return;
    const controller = new AbortController();
    let previewUrl: string | undefined;
    prepareGarmentCutout(front, controller.signal).then(({ canvas, preview }) => {
      if (controller.signal.aborted) return;
      previewUrl = URL.createObjectURL(preview);
      setCutout({ source: front, image: { canvas, preview: previewUrl } });
    }).catch(() => {
      if (!controller.signal.aborted) setCutout({ source: front, image: null });
    });
    return () => {
      controller.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [front]);

  async function attach(file: File, index: number) {
    setUploading(count => count + 1); setError("");
    try {
      const url = await sendImage(file, "garment");
      setPhotos(current => current.map((photo, i) => i === index ? url : photo));
      if (index === 0) {
        setBackground("White");
        setCutout(null);
        savedFront.current = null;
      }
      if (index < 2) {
        const photo = index === 0 ? "front" : "back";
        setPins(current => current.filter(pin => (pin.photo ?? "front") !== photo));
        setActivePin(null);
        if (index === 1 && !photos[0]) setPinPhoto("back");
      }
    } catch (exception) { setError(message(exception)); } finally { setUploading(count => count - 1); }
  }

  return <Sheet title="Quick list a garment" onClose={() => { if (!busy) onClose(); }}>
    <form className="stack" onSubmit={async event => {
      event.preventDefault();
      if (busy || uploading || (preparing && !useOriginal)) return;
      setError("");
      if (!front || (photos[2] && !photos[1])) { setError("Upload a front photo first. Add a back photo before the tag photo."); return; }
      if (pins.some(pin => !pin.note.trim())) { setError("Add a note to each flaw pin or remove it."); return; }
      const fields = new FormData(event.currentTarget);
      setBusy(true);
      try {
        let frontUrl = front;
        if (color && frontCutout?.image) {
          const saved = savedFront.current;
          if (saved?.source === front && saved.background === background) {
            frontUrl = saved.url;
          } else {
            frontUrl = await sendImage(await makeGarmentPhoto(frontCutout.image.canvas, color), "garment");
            savedFront.current = { source: front, background, url: frontUrl };
          }
        }
        const listed = await action<{ code: string }>("list", {
          dropId: fields.get("dropId") || null,
          listing: { title: fields.get("title"), brand: fields.get("brand"), price: fields.get("price"),
            category: fields.get("category"), conditionNotes: fields.get("conditionNotes"),
            pitInches: Number(pit), lengthInches: Number(length), conditionGrade: grade,
            images: [frontUrl, ...photos.slice(1).filter(Boolean)], flawPins: pins,
          },
        });
        await onListed(listed.code);
      } catch (exception) { setError(message(exception)); } finally { setBusy(false); }
    }}>
      <div className="order-ref"><span>Next item code</span><strong>B-{String(data.seller.nextItemNumber).padStart(3, "0")}</strong></div>
      <label>Garment title<input name="title" required maxLength={100} placeholder="Carhartt Detroit Work Jacket" /></label>
      <div className="field-grid"><label>Brand<input name="brand" required maxLength={70} /></label><label>Price (RM)<input name="price" required type="number" min=".01" max="999999" step=".01" inputMode="decimal" /></label></div>
      <div className="field-grid"><label>Category<select name="category" value={category} onChange={event => setCategory(event.target.value)}>{categories.map(entry => <option key={entry}>{entry}</option>)}</select></label>
        <label>Drop<select name="dropId" defaultValue={data.drops.find(drop => drop.status === "LIVE")?.id ?? ""}><option value="">No drop</option>{data.drops.map(drop => <option value={drop.id} key={drop.id}>{drop.title}</option>)}</select></label></div>
      <div className="field-grid"><Stepper label={category === "Pants" ? "Waist (in)" : "Pit (in)"} value={pit} onChange={setPit} /><Stepper label={category === "Pants" ? "Outseam (in)" : "Labuh (in)"} value={length} onChange={setLength} /></div>
      <fieldset><legend>Condition grade</legend><div className="grade-pills">{Object.entries(grades).map(([key, value]) => <button type="button" aria-pressed={key === grade} key={key} className={key === grade ? "selected" : ""} onClick={() => setGrade(key as keyof typeof grades)}>{value}</button>)}</div></fieldset>
      <label>Condition notes<textarea name="conditionNotes" maxLength={1000} rows={2} /></label>
      <fieldset><legend>Photos</legend><div className="photo-fields">
        {["Front", "Back", "Tag"].map((label, i) => <label className="file-field" key={label}>
          {photos[i] ? <img src={(i === 0 ? preview : photos[i])!} alt="" style={i === 0 ? { backgroundColor: previewColor } : undefined} /> : <ImagePlus size={21} strokeWidth={1.5} />}
          <span>{label}</span><input type="file" aria-label={`${label} photo`} accept="image/*" disabled={busy || uploading > 0} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ""; if (file) void attach(file, i);
          }} />
        </label>)}
      </div></fieldset>
      {front && preview && <fieldset className="front-background" disabled={busy || uploading > 0}>
        <legend>Front photo background</legend>
        <div className="grade-pills">
          {(Object.keys(garmentBackgrounds) as GarmentBackground[]).map(option => {
            const selected = option === (useOriginal ? "Original" : background);
            return <button type="button" key={option} aria-pressed={selected} className={selected ? "selected" : ""}
              disabled={option !== "Original" && frontCutout?.image === null} onClick={() => setBackground(option)}>{option}</button>;
          })}
        </div>
        <div role="status" className="muted">
          {preparing ? "Preparing the cutout. You can use Original now."
            : frontCutout?.image === null ? "Background removal was unavailable. You can use Original or try another front photo."
              : "Check that the garment and any flaws are visible. Photos of the garment on its own work best."}
        </div>
        <img className="front-background-preview" src={preview} alt="Front photo preview" style={{ backgroundColor: previewColor }} />
      </fieldset>}
      {(photos[0] || photos[1]) && <fieldset className="pin-editor">
        <legend>Flaw pins</legend><p className="muted">Tap the image to mark a flaw and describe it below.</p>
        <div className="grade-pills" aria-label="Photo to mark">
          {(["front", "back"] as const).map((photo, i) => <button type="button" key={photo}
            disabled={!photos[i]} aria-pressed={pinPhoto === photo} className={pinPhoto === photo ? "selected" : ""}
            onClick={() => { setPinPhoto(photo); setActivePin(null); }}>{photo === "front" ? "Front" : "Back"}</button>)}
        </div>
        {photos[pinPhoto === "front" ? 0 : 1] && <>
        <div className="pin-canvas">
          <button type="button" aria-label={`Place a flaw pin on the ${pinPhoto} photo`} onClick={event => {
            if (pins.length >= 12) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            const clamp = (value: number) => Math.round(Math.min(100, Math.max(0, value)) * 100) / 100;
            const x = event.detail ? clamp((event.clientX - bounds.left) / bounds.width * 100) : 50;
            const y = event.detail ? clamp((event.clientY - bounds.top) / bounds.height * 100) : 50;
            setPins([...pins, { x, y, note: "", photo: pinPhoto }]); setActivePin(pins.length);
          }}><img src={(pinPhoto === "front" ? preview : photos[1])!} style={pinPhoto === "front" ? { backgroundColor: previewColor } : undefined}
            alt={`${pinPhoto === "front" ? "Front" : "Back"} garment photo for marking flaws`} /></button>
          {pins.map((pin, i) => (pin.photo ?? "front") === pinPhoto && <button type="button" key={i} className="flaw-pin" aria-label={`Edit flaw ${i + 1}`} aria-pressed={activePin === i} style={{ left: `${pin.x}%`, top: `${pin.y}%` }} onClick={() => setActivePin(i)}>{i + 1}</button>)}
        </div>
        {activePin !== null && pins[activePin] && <div className="pin-editor-field"><label>Flaw {activePin + 1} note<input required maxLength={180} value={pins[activePin].note}
          onChange={event => setPins(pins.map((pin, i) => i === activePin ? { ...pin, note: event.target.value } : pin))} /></label>
          <button className="icon-button" type="button" aria-label="Remove flaw pin" onClick={() => { setPins(pins.filter((_, i) => i !== activePin)); setActivePin(null); }}><Trash2 size={18} strokeWidth={1.5} /></button></div>}
        </>}
      </fieldset>}
      {error && <Notice>{error}</Notice>}
      <button className="button primary" disabled={busy || !!uploading || (preparing && !useOriginal)}>
        {busy ? "Listing…" : uploading ? "Uploading photo…" : preparing && !useOriginal ? "Preparing front photo…" : "Publish garment"}
      </button>
    </form>
  </Sheet>;
}

export function ShopProfile({ seller, onSaved }: { seller: DashboardData["seller"]; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [banner, setBanner] = useState(seller.bannerImageUrl);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!bannerFile) { setPreview(null); return; }
    const url = URL.createObjectURL(bannerFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [bannerFile]);
  return <form className="surface stack settings-form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    const fields = new FormData(event.currentTarget);
    try {
      const bannerImageUrl = bannerFile ? await sendImage(bannerFile, "garment") : banner;
      if (bannerFile) { setBanner(bannerImageUrl); setBannerFile(null); }
      await action("shopProfile", { profile: { storeName: fields.get("storeName"), bio: fields.get("bio"), bannerImageUrl } });
      await onSaved();
    } catch (exception) { setError(message(exception)); } finally { setBusy(false); }
  }}>
    <label>Shop name<input name="storeName" required minLength={2} maxLength={100} defaultValue={seller.storeName} /></label>
    <label>Shop description<textarea name="bio" maxLength={500} rows={3} defaultValue={seller.bio} placeholder="Tell buyers about your shop" /></label>
    <p className="muted">Your description appears in Browse shops and on your storefront.</p>
    <div className="stack">
      <strong>Storefront image</strong>
      <img className="banner-preview" src={preview ?? banner ?? "/sample/drop-jacket.svg"} alt="Storefront image preview" />
      <label className="file-field"><ImagePlus size={22} strokeWidth={1.5} /><span>Choose image<small>JPG, PNG, WebP or HEIF, under 4 MB. The image is cropped to fit the storefront.</small></span>
        <input type="file" aria-label="Choose storefront image" accept="image/jpeg,image/png,image/webp,image/heif,image/heic,image/avif" disabled={busy} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = "";
          if (!file) return;
          if (file.size > 4 * 1024 * 1024 || !file.size) { setError("Choose an image smaller than 4 MB."); return; }
          setError(""); setBannerFile(file);
        }} />
      </label>
      {(banner || bannerFile) && <button type="button" className="button" disabled={busy} onClick={() => { setBanner(null); setBannerFile(null); setError(""); }}>Use default image</button>}
      <p className="muted">Save your shop profile to publish this image.</p>
    </div>
    {error && <Notice>{error}</Notice>}
    <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save shop profile"}</button>
  </form>;
}

export function DropSettings({ drops, onCreated }: { drops: DashboardData["drops"]; onCreated: () => Promise<void> }) {
  const [scheduled, setScheduled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="surface stack settings-form">
    {drops.length ? <ul className="drop-settings-list">{drops.map(drop => <li key={drop.id}>
      <strong>{drop.title}</strong> <span className="badge">{drop.status === "LIVE" ? "Live" : `Upcoming · ${new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" }).format(new Date(drop.scheduledAt))}`}</span>
    </li>)}</ul> : <p className="muted">No drops yet. Create one to group your listings.</p>}
    <form className="stack" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setError("");
      const form = event.currentTarget;
      const fields = new FormData(form);
      try {
        const value = String(fields.get("scheduledAt") ?? "");
        const time = scheduled ? new Date(value) : null;
        if (scheduled && (!time || Number.isNaN(time.getTime()))) throw new Error("Choose a valid launch date and time.");
        await action("createDrop", { drop: { title: fields.get("title"), scheduledAt: time?.toISOString() ?? null } });
        form.reset(); setScheduled(false);
        await onCreated();
      } catch (exception) { setError(message(exception)); } finally { setBusy(false); }
    }}>
      <label>Drop name<input name="title" required minLength={2} maxLength={100} placeholder="e.g. The Weekend Edit" /></label>
      <label>Launch<select value={scheduled ? "scheduled" : "now"} onChange={event => setScheduled(event.target.value === "scheduled")}>
        <option value="now">Go live now</option><option value="scheduled">Schedule for later</option>
      </select></label>
      {scheduled && <label>Launch date and time<input type="datetime-local" name="scheduledAt" required /></label>}
      {scheduled && <p className="muted">Uses your device’s local time. Buyers can preview the drop before it opens.</p>}
      {error && <Notice>{error}</Notice>}
      <button className="button primary" disabled={busy}>{busy ? "Creating…" : "Create drop"}</button>
    </form>
  </div>;
}

export function StoreSettings({ seller, onSaved }: { seller: DashboardData["seller"]; onSaved: () => Promise<void> }) {
  const [qr, setQr] = useState(seller.qrCodeUrl);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form className="surface stack settings-form" onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError("");
    const fields = new FormData(event.currentTarget);
    try {
      await action("settings", { settings: { ...Object.fromEntries(fields), qrCodeUrl: qr, holdBoxDays: Number(fields.get("holdBoxDays")) } });
      await onSaved();
    } catch (exception) { setError(message(exception)); } finally { setBusy(false); }
  }}>
    <div className="qr-settings">{qr && <img src={qr} alt="Current DuitNow QR" />}
      <label className="file-field"><QrCode size={23} strokeWidth={1.5} /><span>{uploading ? "Uploading QR…" : qr ? "Replace DuitNow QR" : "Upload DuitNow QR"}<small>Upload the static QR from your bank or eWallet.</small></span>
        <input type="file" aria-label="Replace DuitNow QR" accept="image/*" disabled={uploading || busy} onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
          setUploading(true); setError("");
          try { setQr(await sendImage(file, "qr")); }
          catch (exception) { setError(message(exception)); } finally { setUploading(false); }
        }} /></label></div>
    <label>QR account name<input name="qrAccountName" required maxLength={100} defaultValue={seller.qrAccountName} /></label>
    <label>Bank / eWallet label<input name="qrBankLabel" required maxLength={100} defaultValue={seller.qrBankLabel} /></label>
    <div className="field-grid"><label>Shipping fee (RM)<input name="shippingFee" required type="number" inputMode="decimal" min="0" max="999999" step=".01" defaultValue={seller.shippingFee} /></label>
      <label>Hold Box days<input name="holdBoxDays" required type="number" inputMode="numeric" min="1" max="90" defaultValue={seller.holdBoxDays} /></label></div>
    {error && <Notice>{error}</Notice>}
    <button className="button primary" disabled={busy || uploading}>{busy ? "Saving…" : "Save settings"}</button>
  </form>;
}
