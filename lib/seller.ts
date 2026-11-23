import { db, writeTransaction } from "./db";
import { HttpError } from "./http";
import { garmentImages, garmentView, openDueDrops, releaseExpired } from "./inventory";
import { hashToken } from "./security";
import type { z } from "zod";
import type { listing, settings } from "./validation";

const orderInclude = { items: { include: { garment: { include: { drop: true } } } } } as const;

export async function dashboardData(sellerId: string) {
  const seller = await db().seller.findUnique({
    where: { id: sellerId },
    select: { storeName: true, storeSlug: true, qrCodeUrl: true, qrAccountName: true, qrBankLabel: true,
      shippingFee: true, holdBoxDays: true, nextItemNumber: true },
  });
  if (!seller) return null;
  await Promise.all([releaseExpired({ sellerId }), openDueDrops(sellerId)]);
  const [items, orders, drops] = await Promise.all([
    db().garment.findMany({ where: { sellerId }, include: { drop: true }, orderBy: { code: "asc" } }),
    db().order.findMany({
      where: { sellerId, OR: [{ paymentStatus: "PENDING_VERIFICATION" }, { paymentStatus: "VERIFIED_PAID", fulfillmentType: "HOLD_BOX", shippedAt: null }] },
      include: orderInclude, orderBy: { createdAt: "asc" },
    }),
    db().drop.findMany({ where: { sellerId, status: { not: "ENDED" } }, orderBy: { scheduledAt: "asc" } }),
  ]);
  return {
    seller: { ...seller, shippingFee: seller.shippingFee.toFixed(2) },
    items: items.map(garmentView),
    drops: drops.map(drop => ({ id: drop.id, title: drop.title, status: drop.status, scheduledAt: drop.scheduledAt.toISOString() })),
    orders: orders.flatMap(order => {
      const garment = order.items[0]?.garment;
      if (!garment) return [];
      return [{
        id: order.id, buyerName: order.buyerName, buyerPhone: order.buyerPhone, shippingAddress: order.shippingAddress,
        fulfillmentType: order.fulfillmentType, totalAmount: order.totalAmount.toFixed(2), paymentStatus: order.paymentStatus,
        holdBoxDays: order.holdBoxDays, verifiedAt: order.verifiedAt?.toISOString() ?? null,
        dispatchRequestedAt: order.dispatchRequestedAt?.toISOString() ?? null, garment: garmentView(garment),
        hasReceipt: !!order.receiptImageUrl,
      }];
    }),
    serverTime: Date.now(),
  };
}

export type DashboardData = NonNullable<Awaited<ReturnType<typeof dashboardData>>>;

export async function listGarment(sellerId: string, data: z.infer<typeof listing>, dropId: string | null) {
  return writeTransaction(async tx => {
    if (dropId && !await tx.drop.findFirst({ where: { id: dropId, sellerId, status: { not: "ENDED" } } })) {
      throw new HttpError("Select an active or upcoming drop.", 409);
    }
    const seller = await tx.seller.update({
      where: { id: sellerId }, data: { nextItemNumber: { increment: 1 } }, select: { nextItemNumber: true },
    });
    const code = `B-${String(seller.nextItemNumber - 1).padStart(3, "0")}`;
    const item = await tx.garment.create({ data: { ...data, code, sellerId, dropId }, select: { id: true, code: true } });
    return item;
  });
}

export async function updateSettings(sellerId: string, data: z.infer<typeof settings>) {
  await db().seller.update({ where: { id: sellerId }, data });
  return { ok: true };
}

export async function markShipped(sellerId: string, orderIds: string[]) {
  return writeTransaction(async tx => {
    const orders = await tx.order.findMany({
      where: { sellerId, id: { in: orderIds }, paymentStatus: "VERIFIED_PAID", fulfillmentType: "HOLD_BOX", shippedAt: null },
      include: { items: true },
    });
    if (orders.length !== orderIds.length || new Set(orders.map(order => order.buyerPhone)).size !== 1) {
      throw new HttpError("The parcel has changed. Refresh the Hold Box before packing.", 409);
    }
    const ids = orders.flatMap(order => order.items.map(item => item.garmentId));
    const updated = await tx.garment.updateMany({
      where: { id: { in: ids }, sellerId, status: "HOLD_BOX" }, data: { status: "SOLD" },
    });
    if (updated.count !== orders.length) throw new HttpError("Some garments are already shipped.", 409);
    await tx.order.updateMany({ where: { id: { in: orderIds } }, data: { shippedAt: new Date() } });
    return { ok: true };
  });
}

export async function lockerLookup(phone: string, tokens: string[]) {
  const orders = await db().order.findMany({
    where: {
      buyerPhone: phone, buyerAccessHash: { in: tokens.map(hashToken) },
      OR: [{ paymentStatus: "PENDING_VERIFICATION" }, { paymentStatus: "VERIFIED_PAID", fulfillmentType: "HOLD_BOX", shippedAt: null }],
    },
    include: { ...orderInclude, seller: { select: { storeName: true, whatsappNumber: true } } },
    orderBy: { createdAt: "desc" },
  });
  return orders.flatMap(order => {
    const item = order.items[0]?.garment;
    if (!item) return [];
    return [{
      id: order.id, code: order.garmentCode, title: item.title, image: garmentImages(item.images)[0],
      storeName: order.seller.storeName, sellerPhone: order.seller.whatsappNumber,
      status: order.paymentStatus, holdBoxDays: order.holdBoxDays, total: order.totalAmount.toFixed(2),
      verifiedAt: order.verifiedAt?.toISOString() ?? null,
      dispatchRequestedAt: order.dispatchRequestedAt?.toISOString() ?? null,
    }];
  });
}

export type LockerOrder = Awaited<ReturnType<typeof lockerLookup>>[number];

export async function requestDispatch(phone: string, token: string) {
  const order = await db().order.findUnique({
    where: { buyerAccessHash: hashToken(token), buyerPhone: phone, paymentStatus: "VERIFIED_PAID", fulfillmentType: "HOLD_BOX", shippedAt: null },
    select: { id: true, sellerId: true, seller: { select: { whatsappNumber: true } } },
  });
  if (!order) throw new HttpError("This Hold Box order is no longer available for dispatch.", 409);
  await db().order.updateMany({
    where: { sellerId: order.sellerId, buyerPhone: phone, paymentStatus: "VERIFIED_PAID", fulfillmentType: "HOLD_BOX",
      shippedAt: null, dispatchRequestedAt: null },
    data: { dispatchRequestedAt: new Date() },
  });
  return { orderId: order.id, sellerPhone: order.seller.whatsappNumber };
}
