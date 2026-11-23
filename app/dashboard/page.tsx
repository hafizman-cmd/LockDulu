import { currentSeller } from "@/lib/security";
import { dashboardData } from "@/lib/seller";
import { Dashboard, SellerLogin } from "@/components/dashboard";

export const metadata = { title: "Seller dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const id = await currentSeller();
  const data = id ? await dashboardData(id) : null;
  return data ? <Dashboard initial={data} /> : <SellerLogin />;
}
