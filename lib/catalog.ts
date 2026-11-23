import type { GarmentCategory, ConditionGrade, GarmentStatus } from "@/generated/prisma/enums";

export const categories = ["Tee", "Jacket", "Shirt", "Pants", "Sweatshirt"] as const;
export const grades = {
  DEADSTOCK: "Deadstock",
  LIKE_NEW: "9.5/10 Like New",
  VINTAGE_FADE: "8.5/10 Vintage Fade",
  DISTRESSED: "7/10 Distressed",
} satisfies Record<ConditionGrade, string>;
export const statuses = {
  AVAILABLE: "Available",
  LOCKED: "Locked",
  PENDING_VERIFICATION: "Payment under review",
  HOLD_BOX: "Hold Box",
  SOLD: "Sold",
} satisfies Record<GarmentStatus, string>;

export type Pin = { x: number; y: number; note: string };
export type GarmentView = {
  id: string; code: string; title: string; brand: string; category: GarmentCategory;
  price: string; pitInches: number; lengthInches: number; conditionGrade: ConditionGrade;
  conditionNotes: string; images: string[]; flawPins: Pin[]; status: GarmentStatus;
  lockedUntil: string | null; dropId: string | null; locksOpen: boolean;
};
export type DropView = { id: string; title: string; scheduledAt: string; status: "UPCOMING" | "LIVE" | "ENDED" };
export type StoreView = { storeName: string; storeSlug: string; bio: string; whatsappNumber: string };
export type Quote = {
  orderId: string; lockedUntil: string; itemAmount: string; shippingFee: string; shipTotal: string;
  holdBoxDays: number; qrCodeUrl: string; qrAccountName: string; qrBankLabel: string;
};
export function money(amount: string | number) { return `RM${Number(amount).toFixed(2)}`; }
export function measurements(item: Pick<GarmentView, "pitInches" | "lengthInches">) {
  return `${item.pitInches}" × ${item.lengthInches}"`;
}
export function timer(ms: number, days = false) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const units = days
    ? [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60]
    : [Math.floor(seconds / 60), seconds % 60];
  return units.map(unit => String(unit).padStart(2, "0")).join(days ? " : " : ":");
}
export function whatsapp(phone: string, message?: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}
