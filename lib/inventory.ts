import type { Drop, Garment, Order, Prisma } from "@/generated/prisma/client";
import { db, writeTransaction } from "./db.ts";
import type { GarmentView, Pin, Quote } from "./catalog";
import { HttpError } from "./http.ts";
import { hashToken } from "./security.ts";
import { activeShop, requireActiveSeller } from "./shop-status.ts";
import type { z } from "zod";
import type { delivery } from "./validation";

async function closeAbandonedOrders(tx: Prisma.TransactionClient, garmentIds: string[]) {
  if (!garmentIds.length) return;
  await tx.order.updateMany({
    where: { paymentStatus: "AWAITING_RECEIPT", items: { some: { garmentId: { in: garmentIds } } } },
    data: { paymentStatus: "EXPIRED" },
  });
  await tx.orderItem.deleteMany({
    where: { garmentId: { in: garmentIds }, order: { paymentStatus: "EXPIRED" } },
  });
}

export async function releaseExpired(scope: { sellerId: string } | { id: string }) {
  const where = { ...scope, seller: activeShop, status: "LOCKED" as const, lockedUntil: { lte: new Date() } };
  if (!await db().garment.findFirst({ where, select: { id: true } })) return;
  await writeTransaction(async tx => {
    const released = await tx.garment.updateManyAndReturn({
      where,
      data: { status: "AVAILABLE", lockedUntil: null, lockSessionToken: null },
      select: { id: true },
    });
    await closeAbandonedOrders(tx, released.map(item => item.id));
  });
}

export async function openDueDrops(sellerId: string) {
  const where = { sellerId, seller: activeShop, status: "UPCOMING" as const, scheduledAt: { lte: new Date() } };
  if (!await db().drop.findFirst({ where, select: { id: true } })) return;
  await writeTransaction(tx => tx.drop.updateMany({
    where,
    data: { status: "LIVE" },
  }));
}

export function garmentImages(images: Prisma.JsonValue): string[] {
  return Array.isArray(images) ? images.filter(image => typeof image === "string") : [];
}

export function garmentView(item: Garment & { drop: Drop | null }): GarmentView {
  return {
    id: item.id, code: item.code, title: item.title, brand: item.brand, category: item.category,
    price: item.price.toFixed(2), pitInches: item.pitInches, lengthInches: item.lengthInches,
    conditionGrade: item.conditionGrade, conditionNotes: item.conditionNotes, images: garmentImages(item.images),
    flawPins: Array.isArray(item.flawPins) ? item.flawPins as Pin[] : [],
    status: item.status, lockedUntil: item.lockedUntil?.toISOString() ?? null, dropId: item.dropId,
    locksOpen: !item.drop || item.drop.status === "LIVE",
  };
}

export const storeSelect = { storeName: true, storeSlug: true, bio: true, whatsappNumber: true } as const;

export async function readStore(slug: string) {
  const storeSlug = slug.toLowerCase();
  const activeStore = { storeSlug, ...activeShop };
  const [seller, initialItems, initialDrops] = await Promise.all([
    db().seller.findUnique({ where: activeStore, select: { ...storeSelect, id: true } }),
    db().garment.findMany({ where: { seller: activeStore }, include: { drop: true }, orderBy: { code: "asc" } }),
    db().drop.findMany({ where: { seller: activeStore, status: { not: "ENDED" } }, orderBy: { scheduledAt: "asc" } }),
  ]);
  if (!seller) return null;
  const now = Date.now();
  const hasExpiredLocks = initialItems.some(item => item.status === "LOCKED" && item.lockedUntil && item.lockedUntil.getTime() <= now);
  const hasDueDrops = initialDrops.some(drop => drop.status === "UPCOMING" && drop.scheduledAt.getTime() <= now);
  let items = initialItems;
  let drops = initialDrops;
  if (hasExpiredLocks || hasDueDrops) {
    await Promise.all([
      hasExpiredLocks && releaseExpired({ sellerId: seller.id }),
      hasDueDrops && openDueDrops(seller.id),
    ]);
    [items, drops] = await Promise.all([
      db().garment.findMany({ where: { sellerId: seller.id, seller: activeShop }, include: { drop: true }, orderBy: { code: "asc" } }),
      db().drop.findMany({ where: { sellerId: seller.id, seller: activeShop, status: { not: "ENDED" } }, orderBy: { scheduledAt: "asc" } }),
    ]);
  }
  const { id: _sellerId, ...store } = seller;
  return { store, items: items.map(garmentView), drops: drops.map(drop => ({ id: drop.id, title: drop.title, status: drop.status, scheduledAt: drop.scheduledAt.toISOString() })), serverTime: Date.now() };
}

export async function readItem(id: string) {
  const where = { id, seller: activeShop };
  const include = { drop: true, seller: { select: storeSelect } } as const;
  let item = await db().garment.findUnique({ where, include });
  if (!item) return null;
  const now = Date.now();
  const hasExpiredLock = item.status === "LOCKED" && item.lockedUntil && item.lockedUntil.getTime() <= now;
  const hasDueDrop = item.drop?.status === "UPCOMING" && item.drop.scheduledAt.getTime() <= now;
  if (hasExpiredLock || hasDueDrop) {
    await Promise.all([
      hasExpiredLock && releaseExpired({ id }),
      hasDueDrop && openDueDrops(item.sellerId),
    ]);
    item = await db().garment.findUnique({ where, include });
  }
  return item && { item: garmentView(item), store: item.seller, serverTime: Date.now() };
}

function quote(order: Order, lockedUntil: Date): Quote {
  return {
    orderId: order.id, lockedUntil: lockedUntil.toISOString(), itemAmount: order.itemAmount.toFixed(2),
    shippingFee: order.shippingFee.toFixed(2), shipTotal: order.itemAmount.plus(order.shippingFee).toFixed(2),
    holdBoxDays: order.holdBoxDays, qrCodeUrl: order.qrCodeUrl, qrAccountName: order.qrAccountName, qrBankLabel: order.qrBankLabel,
  };
}

export async function lockItem(id: string, token: string) {
  const hash = hashToken(token);
  const item = await db().garment.findUnique({ where: { id, seller: activeShop }, select: { sellerId: true } });
  if (!item) throw new HttpError("This garment could not be found.", 404);
  await openDueDrops(item.sellerId);
  return writeTransaction(async tx => {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + 600_000);
    const updated = await tx.garment.updateMany({
      where: { id, seller: activeShop, AND: [
        { OR: [{ dropId: null }, { drop: { status: "LIVE" } }] },
        { OR: [{ status: "AVAILABLE" }, { status: "LOCKED", lockedUntil: { lte: now } }] },
      ] },
      data: { status: "LOCKED", lockedUntil, lockSessionToken: hash },
    });
    if (!updated.count) {
      const existing = await tx.garment.findFirst({
        where: { id, seller: activeShop, status: "LOCKED", lockSessionToken: hash, lockedUntil: { gt: new Date() } },
        include: { orderItem: { include: { order: true } } },
      });
      if (existing?.lockedUntil && existing.orderItem) return { quote: quote(existing.orderItem.order, existing.lockedUntil), serverTime: Date.now() };
      throw new HttpError("This piece is no longer available to lock.", 409);
    }
    await closeAbandonedOrders(tx, [id]);
    if (await tx.order.findUnique({ where: { buyerAccessHash: hash }, select: { id: true } })) {
      throw new HttpError("This checkout token has already been used. Try locking again.", 409);
    }
    const garment = await tx.garment.findUniqueOrThrow({ where: { id }, include: { seller: true } });
    const seller = garment.seller;
    if (!seller.qrCodeUrl) throw new HttpError("This store has not set up its payment QR yet.", 409);
    const order = await tx.order.create({ data: {
      sellerId: seller.id, buyerAccessHash: hash, garmentCode: garment.code, itemAmount: garment.price,
      shippingFee: seller.shippingFee, totalAmount: garment.price.plus(seller.shippingFee), holdBoxDays: seller.holdBoxDays,
      qrCodeUrl: seller.qrCodeUrl, qrAccountName: seller.qrAccountName, qrBankLabel: seller.qrBankLabel,
      items: { create: { garmentId: id } },
    } });
    return { quote: quote(order, lockedUntil), serverTime: Date.now() };
  });
}

export async function orderState(orderId: string, token: string) {
  const order = await db().order.findUnique({
    where: { id: orderId, buyerAccessHash: hashToken(token), seller: activeShop },
    include: { items: { include: { garment: true } } },
  });
  if (!order) throw new HttpError("This checkout could not be found.", 404);
  const garment = order.items[0]?.garment;
  if (order.paymentStatus === "AWAITING_RECEIPT" && garment?.lockedUntil && garment.lockedUntil <= new Date()) {
    await releaseExpired({ id: garment.id });
    return orderState(orderId, token);
  }
  return {
    status: order.paymentStatus, code: order.garmentCode, serverTime: Date.now(),
    quote: order.paymentStatus === "AWAITING_RECEIPT" && garment?.lockedUntil ? quote(order, garment.lockedUntil) : null,
  };
}

export async function submitReceipt(orderId: string, token: string, details: z.infer<typeof delivery>, receiptImageUrl: string) {
  return writeTransaction(async tx => {
    const hash = hashToken(token);
    const order = await tx.order.findUnique({ where: { id: orderId, buyerAccessHash: hash, seller: activeShop }, include: { items: true } });
    if (!order) throw new HttpError("This checkout could not be found.", 404);
    const garmentId = order.items[0]?.garmentId;
    if (!garmentId) throw new HttpError("Your lock has expired.", 409);
    const changed = await tx.garment.updateMany({
      where: { id: garmentId, seller: activeShop, status: "LOCKED", lockSessionToken: hash, lockedUntil: { gt: new Date() } },
      data: { status: "PENDING_VERIFICATION", lockSessionToken: null, lockedUntil: null },
    });
    if (!changed.count) {
      const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true } });
      if (current.paymentStatus === "PENDING_VERIFICATION" || current.paymentStatus === "VERIFIED_PAID") {
        return { orderId, code: order.garmentCode, stored: false };
      }
      throw new HttpError("Your lock has expired or been released.", 409);
    }
    await tx.order.update({ where: { id: orderId }, data: {
      ...details, receiptImageUrl, paymentStatus: "PENDING_VERIFICATION",
      totalAmount: details.fulfillmentType === "HOLD_BOX" ? order.itemAmount : order.itemAmount.plus(order.shippingFee),
    } });
    return { orderId, code: order.garmentCode, stored: true };
  });
}

export async function reviewOrder(sellerId: string, orderId: string, paid: boolean) {
  return writeTransaction(async tx => {
    await requireActiveSeller(tx, sellerId);
    const order = await tx.order.findUnique({
      where: { id: orderId, sellerId, paymentStatus: "PENDING_VERIFICATION" }, include: { items: true },
    });
    if (!order || !order.items[0]) throw new HttpError("This receipt has already been reviewed.", 409);
    const changed = await tx.garment.updateMany({
      where: { id: order.items[0].garmentId, status: "PENDING_VERIFICATION", orderItem: { orderId } },
      data: { status: paid ? (order.fulfillmentType === "HOLD_BOX" ? "HOLD_BOX" : "SOLD") : "AVAILABLE" },
    });
    if (!changed.count) throw new HttpError("This receipt has already been reviewed.", 409);
    const reviewed = await tx.order.updateMany({ where: { id: orderId, paymentStatus: "PENDING_VERIFICATION" }, data: {
      paymentStatus: paid ? "VERIFIED_PAID" : "REJECTED", verifiedAt: paid ? new Date() : null,
    } });
    if (!reviewed.count) throw new HttpError("This receipt has already been reviewed.", 409);
    if (!paid) await tx.orderItem.delete({ where: { id: order.items[0].id } });
    return { ok: true };
  });
}
