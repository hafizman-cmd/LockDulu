import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { HttpError, limitBody, requireOrigin, respond } from "@/lib/http";
import { lockItem, orderState, reviewOrder } from "@/lib/inventory";
import { checkPassword } from "@/lib/password";
import { currentSeller, sellerSession, sessionCookie, sessionSeconds } from "@/lib/security";
import { dashboardData, listGarment, lockerLookup, markShipped, requestDispatch, updateSettings } from "@/lib/seller";
import { id, listing, phone, settings, token } from "@/lib/validation";

const attempts = new Map<string, { count: number; until: number }>();
const perMinute = 60_000;

function limitLogin(key: string) {
  const now = Date.now();
  for (const [name, entry] of attempts) if (entry.until <= now) attempts.delete(name);
  const entry = attempts.get(key) ?? { count: 0, until: now + perMinute };
  if (entry.count >= 8) throw new HttpError("Too many sign-in attempts. Try again in a minute.", 429);
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
      case "locker": return { orders: await lockerLookup(phone.parse(body.phone), z.array(token).max(100).parse(body.tokens)) };
      case "dispatch": return requestDispatch(phone.parse(body.phone), token.parse(body.token));
      case "login": {
        const slug = z.string().trim().min(1).max(80).parse(body.slug).toLowerCase().replace(/^@/, "");
        const password = z.string().min(1).max(256).parse(body.password);
        const seller = await db().seller.findUnique({ where: { storeSlug: slug }, select: { id: true, passwordHash: true } });
        limitLogin(seller?.id ?? "unknown");
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
      case "review": return reviewOrder(seller, id.parse(body.id), z.boolean().parse(body.paid));
      case "list": return listGarment(seller, listing.parse(body.listing), id.nullable().parse(body.dropId));
      case "settings": return updateSettings(seller, settings.parse(body.settings));
      case "ship": return markShipped(seller, [...new Set(z.array(id).min(1).max(200).parse(body.ids))]);
      default: throw new HttpError("Unknown action.", 404);
    }
  });
}
