import { cache } from "react";
import { notFound } from "next/navigation";
import { readStore } from "@/lib/inventory";
import { Storefront } from "@/components/storefront";
import { publicPageMetadata } from "../public-metadata";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ storeSlug: string }> };
const loadStore = cache(readStore);

async function storeSlug({ params }: Props) {
  return (await params).storeSlug.replace(/^(?:@|%40)/, "").toLowerCase();
}

export async function generateMetadata(props: Props) {
  const data = await loadStore(await storeSlug(props));
  if (!data) notFound();
  const { store, items } = data;
  return publicPageMetadata({
    path: `/${encodeURIComponent(store.storeSlug)}`,
    title: store.storeName,
    description: store.bio.trim() || `Browse vintage pieces and upcoming drops from ${store.storeName} on LockDulu.`,
    previews: [
      { src: store.bannerImageUrl, alt: `${store.storeName} storefront` },
      ...items.map(item => ({ src: item.images[0], alt: item.title })),
    ],
  });
}

export default async function StorePage(props: Props) {
  const data = await loadStore(await storeSlug(props));
  if (!data) notFound();
  return <Storefront initial={data} />;
}
