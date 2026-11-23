import { notFound } from "next/navigation";
import { readItem } from "@/lib/inventory";
import { ItemDetail } from "@/components/item-detail";

export const dynamic = "force-dynamic";
export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const data = await readItem((await params).id);
  if (!data) notFound();
  return <ItemDetail initial={data} />;
}
