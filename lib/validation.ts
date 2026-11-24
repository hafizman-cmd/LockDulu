import { z } from "zod";
import { categories, grades, receiptRejectionLabels } from "./catalog";
import { normalizePhone, tokenPattern } from "./security";

export const id = z.string().min(1).max(100);
export const orderNumber = z.string().trim().min(1, "Enter your order number.").max(100).toLowerCase();
export const token = z.string().regex(tokenPattern);
export const receiptRejection = z.enum(Object.keys(receiptRejectionLabels) as (keyof typeof receiptRejectionLabels)[], {
  error: "Choose a reason for rejecting this receipt.",
});
export const phone = z.string().trim().max(30).transform(normalizePhone).pipe(z.string().regex(/^60[1-9]\d{7,9}$/, "Enter a valid Malaysian WhatsApp number."));
export const delivery = z.object({
  buyerName: z.string().trim().min(2, "Enter the buyer's name.").max(100),
  buyerPhone: phone,
  shippingAddress: z.string().trim().min(8, "Enter a complete delivery address.").max(500),
  fulfillmentType: z.enum(["SHIP_NOW", "HOLD_BOX"]),
});
export const assetUrl = z.string().regex(/^\/api\/media\/[a-f0-9-]{36}\.webp$/);
const price = z.string().regex(/^\d{1,6}(\.\d{1,2})?$/, "Enter a valid RM amount.");
export const listing = z.object({
  title: z.string().trim().min(2).max(100),
  brand: z.string().trim().min(1).max(70),
  category: z.enum(categories),
  price,
  pitInches: z.number().min(5).max(100),
  lengthInches: z.number().min(5).max(100),
  conditionGrade: z.enum(Object.keys(grades) as [keyof typeof grades, ...(keyof typeof grades)[]]),
  conditionNotes: z.string().trim().max(1000),
  images: z.array(assetUrl).min(1).max(3),
  flawPins: z.array(z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100), note: z.string().trim().min(1).max(180), photo: z.enum(["front", "back"]).optional() })).max(12),
}).refine(value => value.images.length > 1 || !value.flawPins.some(pin => pin.photo === "back"), {
  message: "Add a back photo before marking back flaws.",
  path: ["flawPins"],
});
export const settings = z.object({
  qrCodeUrl: z.union([assetUrl, z.literal("/sample/duitnow.svg")]),
  qrAccountName: z.string().trim().min(2).max(100),
  qrBankLabel: z.string().trim().min(2).max(100),
  shippingFee: price,
  holdBoxDays: z.number().int().min(1).max(90),
});
export const shopProfile = z.object({
  storeName: z.string().trim().min(2, "Use at least 2 characters for your shop name.").max(100),
  bio: z.string().trim().max(500, "Keep the shop description under 500 characters."),
  bannerImageUrl: assetUrl.nullable().optional(),
  whatsappNumber: phone.optional(),
});
export const newDrop = z.object({
  title: z.string().trim().min(2, "Use at least 2 characters for the drop name.").max(100),
  scheduledAt: z.iso.datetime().nullable(),
});
