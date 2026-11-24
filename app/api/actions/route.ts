import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, limitBody, requireOrigin, respond } from "@/lib/http";
import { lockItem, orderState, preparePayment, reviewOrder } from "@/lib/inventory";
import { checkPassword, passwordHash } from "@/lib/password";
import { currentSeller, sellerSession, sessionCookie, sessionSeconds } from "@/lib/security";
import { createDrop, dashboardData, deleteGarment, listGarment, lockerLookup, markShipped, queueShipment, requestDispatch, sellerHistory, setGarmentHidden, updateSettings, updateShopProfile } from "@/lib/seller";
import { delivery, id, listing, newDrop, orderNumber, phone, receiptRejection, settings, shopProfile, token } from "@/lib/validation";
import { existingShop } from "@/lib/shop-status";

const attempts = new Map<string, { count: number; until: number }>();
const perMinute = 60_000;

function limitAttempts(key: string, message: string) {
  const now = Date.now();
  for (const [name, entry] of attempts) if (entry.until <= now) attempts.delete(name);
  const entry = attempts.get(key) ?? { count: 0, until: now + perMinute };
  if (entry.count >= 8) throw new HttpError(message, 429);
  entry.count += 1;
  attempts.set(key, entry);
}

export async function POST(request: Request) {
  return respond(async () => {
    requireOrigin(request);
    const body = z.record(z.string(), z.unknown()).parse(await (await limitBody(request, 64_000)).json());
    switch (body.action) {
      case "lock": return lockItem(id.parse(body.id), token.parse(body.token));
      case "order": return orderState(id.parse(body.id), token.parse(body.token));
      case "preparePayment": return preparePayment(id.parse(body.id), token.parse(body.token), delivery.parse(body.delivery));
      case "locker": return { orders: await lockerLookup(orderNumber.parse(body.orderNumber), z.array(token).max(100).parse(body.tokens)) };
      case "dispatch": return requestDispatch(z.array(token).min(1).max(100).parse(body.tokens));
      case "register": {
        limitAttempts("register", "Too many registration attempts. Try again in a minute.");
        const storeName = z.string().trim().min(2).max(100).parse(body.storeName);
        const slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{1,78}[a-z0-9]$/, "Use 3 to 80 letters, numbers, dots, hyphens or underscores for the handle.").parse(body.slug);
        if (["api", "dashboard", "item", "locker", "sample", "uploads", "_next"].includes(slug)) throw new HttpError("This store handle is reserved.", 409);
        const password = z.string().min(12, "Use at least 12 characters for your password.").max(256).parse(body.password);
        const whatsappNumber = phone.parse(body.whatsappNumber);
        try {
          await db().seller.create({ data: { storeName, storeSlug: slug, passwordHash: passwordHash(password), whatsappNumber,
            bio: "", qrCodeUrl: "", qrAccountName: "", qrBankLabel: "" } });
        } catch (error) {
          if (error && typeof error === "object" && "code" in error && error.code === "P2002") throw new HttpError("That store handle is already in use.", 409);
          throw error;
        }
        return { ok: true };
      }
      case "login": {
        const slug = z.string().trim().min(1).max(80).parse(body.slug).toLowerCase().replace(/^@/, "");
        const password = z.string().min(1).max(256).parse(body.password);
        const seller = await db().seller.findUnique({ where: { storeSlug: slug, ...existingShop }, select: { id: true, passwordHash: true } });
        limitAttempts(seller?.id ?? "unknown", "Too many sign-in attempts. Try again in a minute.");
        const valid = checkPassword(password, seller?.passwordHash ?? `${"0".repeat(64)}:${"0".repeat(128)}`);
        if (!seller || !valid) throw new HttpError("Check the store handle and password.", 401);
        attempts.delete(seller.id);
        const response = NextResponse.json({ ok: true });
        response.cookies.set(sessionCookie, sellerSession(seller.id), {
          httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: sessionSeconds,
        });
        return response;
      }
      case "logout": {
        const response = NextResponse.json({ ok: true });
        response.cookies.delete(sessionCookie);
        return response;
      }
    }
    const seller = await currentSeller();
    if (!seller) throw new HttpError("Sign in to manage this store.", 401);
    switch (body.action) {
      case "dashboard": {
        const data = await dashboardData(seller);
        if (!data) throw new HttpError("Store not found.", 404);
        return data;
      }
      case "review": {
        const paid = z.boolean().parse(body.paid);
        return reviewOrder(seller, id.parse(body.id), paid, paid ? undefined : receiptRejection.parse(body.reason));
      }
      case "history": return sellerHistory(seller, z.number().int().min(1).max(1_000_000).parse(body.page));
      case "list": return listGarment(seller, listing.parse(body.listing), id.nullable().parse(body.dropId));
      case "deleteListing": return deleteGarment(seller, id.parse(body.id));
      case "hideListing": return setGarmentHidden(seller, id.parse(body.id), z.boolean().parse(body.hidden));
      case "settings": return updateSettings(seller, settings.parse(body.settings));
      case "shopProfile": return updateShopProfile(seller, shopProfile.parse(body.profile));
      case "createDrop": return createDrop(seller, newDrop.parse(body.drop));
      case "ship": return markShipped(seller, [...new Set(z.array(id).min(1).max(200).parse(body.ids))]);
      case "queueShipment": return queueShipment(seller, id.parse(body.id));
      default: throw new HttpError("Unknown action.", 404);
    }
  });
}
