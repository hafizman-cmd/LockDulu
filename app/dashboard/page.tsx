import { currentSeller } from "@/lib/security";
import { dashboardData } from "@/lib/seller";
import { Dashboard, SellerLogin } from "@/components/dashboard";

export const metadata = { title: "Seller dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const id = await currentSeller();
  const data = id ? await dashboardData(id) : null;
  return data ? <Dashboard initial={data} publicOrigin={process.env.APP_ORIGIN} /> : <SellerLogin />;
}
