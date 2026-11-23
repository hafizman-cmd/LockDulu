import { notFound } from "next/navigation";
import { readStore } from "@/lib/inventory";
import { Storefront } from "@/components/storefront";

export const dynamic = "force-dynamic";
export default async function StorePage({ params }: { params: Promise<{ storeSlug: string }> }) {
  const { storeSlug } = await params;
  const data = await readStore(storeSlug.replace(/^@/, ""));
  if (!data) notFound();
  return <Storefront initial={data} />;
}
