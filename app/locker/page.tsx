import { Locker } from "@/components/locker";
export const metadata = { title: "My orders", robots: { index: false, follow: false } };
export default async function LockerPage({ searchParams }: { searchParams: Promise<{ order?: string | string[] }> }) {
  const { order } = await searchParams;
  const reference = (Array.isArray(order) ? order[0] : order)?.trim().toLowerCase().slice(0, 100) ?? "";
  return <Locker key={reference} reference={reference} />;
}
