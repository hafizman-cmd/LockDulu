import { cache } from "react";
import { notFound } from "next/navigation";
import { readItem } from "@/lib/inventory";
import { ItemDetail } from "@/components/item-detail";
import { publicPageMetadata } from "../../public-metadata";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ id: string }> };
const loadItem = cache(readItem);

export async function generateMetadata({ params }: Props) {
  const data = await loadItem((await params).id);
  if (!data) notFound();
  const { item, store } = data;
  return publicPageMetadata({
    path: `/item/${encodeURIComponent(item.id)}`,
    title: `${item.title} · ${store.storeName}`,
    description: item.conditionNotes.trim() || `View this ${item.brand} piece from ${store.storeName} on LockDulu.`,
    previews: item.images.slice(0, 2).map(src => ({ src, alt: item.title })),
  });
}

export default async function ItemPage({ params }: Props) {
  const data = await loadItem((await params).id);
  if (!data) notFound();
  return <ItemDetail key={data.item.id} initial={data} />;
}
