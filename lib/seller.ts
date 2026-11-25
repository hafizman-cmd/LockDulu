import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db, writeTransaction } from "./db.ts";
import { HttpError } from "./http.ts";
import { garmentImages, garmentView, openDueDrops, releaseExpired } from "./inventory.ts";
import { paymentConfigured } from "./payment.ts";
import { hashToken } from "./security.ts";
import { existingShop, requireActiveSeller, requireOrderSeller, unresolvedOrder } from "./shop-status.ts";
import type { z } from "zod";
import type { listing, newDrop, settings, shopProfile } from "./validation";

const orderInclude = { items: { include: { garment: { include: { drop: true } } } } } as const;

function transferView(order: Prisma.OrderGetPayload<{}>) {
  return {
    transferReported: !!order.transferReportedAt,
    transferResolution: order.transferResolution,
    transferVersion: order.transferVersion,
    transferResolvedAt: order.transferResolvedAt?.toISOString() ?? null,
    transferEscalated: !!order.transferEscalatedAt,
    transferReference: order.transferReference,
    refundDisputed: !!order.refundDisputedAt,
    refundAmount: order.refundAmount?.toFixed(2) ?? null,
    refundSentOn: order.refundSentOn,
    refundReference: order.refundReference,
    refundNote: order.refundNote,
  };
}

export async function dashboardData(sellerId: string) {
  const seller = await db().seller.findUnique({
    where: { id: sellerId, ...existingShop },
    select: { storeName: true, storeSlug: true, bio: true, bannerImageUrl: true, qrCodeUrl: true, qrAccountName: true, qrBankLabel: true,
      shippingFee: true, holdBoxDays: true, nextItemNumber: true, status: true, whatsappNumber: true },
  });
  if (!seller) return null;
  if (seller.status === "ACTIVE") await Promise.all([releaseExpired({ sellerId }), openDueDrops(sellerId)]);
  const [items, orders, drops] = await Promise.all([
    db().garment.findMany({ where: { sellerId, deletedAt: null }, include: { drop: true }, orderBy: { code: "asc" } }),
    db().order.findMany({
      where: { sellerId, ...unresolvedOrder },
      include: orderInclude, orderBy: { createdAt: "asc" },
    }),
    db().drop.findMany({ where: { sellerId, status: { not: "ENDED" } }, orderBy: { scheduledAt: "asc" } }),
  ]);
  return {
    seller: { ...seller, paymentReady: paymentConfigured(seller), shippingFee: seller.shippingFee.toFixed(2) },
    items: items.map(garmentView),
    drops: drops.map(drop => ({ id: drop.id, title: drop.title, status: drop.status, scheduledAt: drop.scheduledAt.toISOString() })),
    transferReports: orders.filter(order => order.transferReportedAt && !order.transferResolvedAt).map(order => ({
      id: order.id, code: order.garmentCode, title: order.garmentTitle, reference: order.transferReference,
      buyerName: order.buyerName, buyerPhone: order.buyerPhone, total: order.totalAmount.toFixed(2), ...transferView(order),
    })),
    orders: orders.flatMap(order => {
      const garment = order.items[0]?.garment;
      if (!garment) return [];
      return [{
        id: order.id, buyerName: order.buyerName, buyerPhone: order.buyerPhone, shippingAddress: order.shippingAddress,
        fulfillmentType: order.fulfillmentType, totalAmount: order.totalAmount.toFixed(2), paymentStatus: order.paymentStatus,
        holdBoxDays: order.holdBoxDays, verifiedAt: order.verifiedAt?.toISOString() ?? null,
        dispatchRequestedAt: order.dispatchRequestedAt?.toISOString() ?? null, garment: garmentView(garment),
        dispatchGroupId: order.dispatchGroupId, shipmentUnconfirmed: order.shipmentUnconfirmed,
        hasReceipt: !!order.receiptImageUrl,
        receiptSubmittedAt: (order.receiptSubmittedAt ?? order.createdAt).toISOString(),
      }];
    }),
    serverTime: Date.now(),
  };
}

export type DashboardData = NonNullable<Awaited<ReturnType<typeof dashboardData>>>;

const historyPageSize = 20;
export async function sellerHistory(sellerId: string, requestedPage: number) {
  await requireOrderSeller(db(), sellerId);
  const where = { sellerId };
  const count = await db().order.count({ where });
  const pageCount = Math.max(1, Math.ceil(count / historyPageSize));
  const page = Math.min(requestedPage, pageCount);
  const orders = await db().order.findMany({
    where, include: orderInclude, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * historyPageSize, take: historyPageSize,
  });
  return {
    page, pageCount, count,
    orders: orders.map(order => {
      const garment = order.items[0]?.garment;
      return {
        id: order.id, code: order.garmentCode, title: order.garmentTitle ?? garment?.title ?? order.garmentCode,
        image: garment ? garmentImages(garment.images)[0] ?? null : null,
        buyerName: order.buyerName, buyerPhone: order.buyerPhone, shippingAddress: order.shippingAddress,
        status: order.paymentStatus, fulfillmentType: order.fulfillmentType,
        total: order.totalAmount.toFixed(2), itemAmount: order.itemAmount.toFixed(2),
        shippingCharged: (order.fulfillmentType === "SHIP_NOW" ? order.shippingFee : order.shippingFee.minus(order.shippingFee)).toFixed(2),
        rejectionReason: order.rejectionReason, hasReceipt: !!order.receiptImageUrl,
        createdAt: order.createdAt.toISOString(), receiptSubmittedAt: order.receiptSubmittedAt?.toISOString() ?? null,
        reviewedAt: order.reviewedAt?.toISOString() ?? null, dispatchRequestedAt: order.dispatchRequestedAt?.toISOString() ?? null,
        shippedAt: order.shippedAt?.toISOString() ?? null, shipmentUnconfirmed: order.shipmentUnconfirmed,
        shipmentReconciledAt: order.shipmentReconciledAt?.toISOString() ?? null,
        transferReportedAt: order.transferReportedAt?.toISOString() ?? null,
        ...transferView(order),
      };
    }),
  };
}
export type SellerHistory = Awaited<ReturnType<typeof sellerHistory>>;

export async function updateShopProfile(sellerId: string, data: z.infer<typeof shopProfile>) {
  return writeTransaction(async tx => {
    await requireActiveSeller(tx, sellerId);
    await tx.seller.update({ where: { id: sellerId }, data });
    return { ok: true };
  });
}

export async function createDrop(sellerId: string, data: z.infer<typeof newDrop>) {
  return writeTransaction(async tx => {
    await requireActiveSeller(tx, sellerId);
    const now = new Date();
    const scheduledAt = data.scheduledAt ? new Date(data.scheduledAt) : now;
    if (data.scheduledAt && scheduledAt <= now) throw new HttpError("Choose a future launch time, or publish the drop now.");
    return tx.drop.create({ data: {
      sellerId, title: data.title, scheduledAt, status: data.scheduledAt ? "UPCOMING" : "LIVE",
    }, select: { id: true, title: true } });
  });
}

async function requireListingDrop(tx: Prisma.TransactionClient, sellerId: string, dropId: string | null) {
  if (dropId && !await tx.drop.findFirst({ where: { id: dropId, sellerId, status: { not: "ENDED" } } })) {
    throw new HttpError("Select an active or upcoming drop.", 409);
  }
}

export async function listGarment(sellerId: string, data: z.infer<typeof listing>, dropId: string | null, publishRequestId?: string) {
  return writeTransaction(async tx => {
    await requireActiveSeller(tx, sellerId);
    if (publishRequestId) {
      const existing = await tx.garment.findUnique({ where: { sellerId_publishRequestId: { sellerId, publishRequestId } }, select: { id: true, code: true } });
      if (existing) return existing;
    }
    await requireListingDrop(tx, sellerId, dropId);
    const seller = await tx.seller.update({
      where: { id: sellerId }, data: { nextItemNumber: { increment: 1 } }, select: { nextItemNumber: true },
    });
    const code = `B-${String(seller.nextItemNumber - 1).padStart(3, "0")}`;
    const item = await tx.garment.create({ data: { ...data, code, sellerId, dropId, publishRequestId }, select: { id: true, code: true } });
    return item;
  });
}

export async function editGarment(sellerId: string, garmentId: string, data: z.infer<typeof listing>, dropId: string | null) {
  await releaseExpired({ id: garmentId, sellerId });
  return writeTransaction(async tx => {
    await requireActiveSeller(tx, sellerId);
    const where = { id: garmentId, sellerId, deletedAt: null, status: "AVAILABLE", orderItem: null } as const;
    const existing = await tx.garment.findFirst({ where, select: { code: true, dropId: true, images: true } });
    if (!existing) throw new HttpError("Only available listings without an open order can be edited.", 409);
    if (dropId !== existing.dropId) await requireListingDrop(tx, sellerId, dropId);
    const previousImages = garmentImages(existing.images);
    if (data.images.some(url => !/^\/api\/media\/[a-f0-9-]{36}\.webp$/.test(url) && !previousImages.includes(url))) {
      throw new HttpError("Upload a photo to replace a listing image.");
    }
    return tx.garment.update({ where, data: { ...data, dropId }, select: { id: true, code: true } });
  });
}

export async function deleteGarment(sellerId: string, garmentId: string) {
  await releaseExpired({ sellerId });
  return writeTransaction(async tx => {
    await requireActiveSeller(tx, sellerId);
    const deleted = await tx.garment.updateMany({
      where: { id: garmentId, sellerId, deletedAt: null, OR: [
        { status: "AVAILABLE", orderItem: null },
        { status: "SOLD", orderItem: { order: { paymentStatus: "VERIFIED_PAID" } } },
      ] },
      data: { deletedAt: new Date(), hidden: true },
    });
    if (deleted.count) return { ok: true };
    const item = await tx.garment.findFirst({ where: { id: garmentId, sellerId, deletedAt: null }, select: { id: true } });
    if (!item) throw new HttpError("This listing could not be found.", 404);
    throw new HttpError("This listing cannot be deleted while a reservation, receipt review, or Hold Box is active.", 409);
  });
}

export async function setGarmentHidden(sellerId: string, garmentId: string, hidden: boolean) {
  return writeTransaction(async tx => {
    await requireActiveSeller(tx, sellerId);
    const { count } = await tx.garment.updateMany({
      where: {
        id: garmentId, sellerId, deletedAt: null,
        ...(hidden ? { OR: [{ status: { not: "LOCKED" } }, { lockedUntil: { lte: new Date() } }] } : {}),
      },
      data: { hidden },
    });
    if (count) return { ok: true };
    const item = await tx.garment.findFirst({ where: { id: garmentId, sellerId, deletedAt: null }, select: { id: true } });
    if (!item) throw new HttpError("This listing could not be found.", 404);
    throw new HttpError("Wait for the active reservation to end before hiding this listing.", 409);
  });
}

export async function updateSettings(sellerId: string, data: z.infer<typeof settings>) {
  return writeTransaction(async tx => {
    await requireActiveSeller(tx, sellerId);
    await tx.seller.update({ where: { id: sellerId }, data });
    return { ok: true };
  });
}

export async function markShipped(sellerId: string, orderIds: string[]) {
  return writeTransaction(async tx => {
    await requireOrderSeller(tx, sellerId);
    const orders = await tx.order.findMany({
      where: { sellerId, id: { in: orderIds }, paymentStatus: "VERIFIED_PAID" },
      include: { items: true },
    });
    const first = orders[0];
    if (!first || orders.length !== orderIds.length) {
      throw new HttpError("The parcel has changed. Refresh the Hold Box before packing.", 409);
    }
    if (first.fulfillmentType === "HOLD_BOX") {
      if (!first.dispatchGroupId || orders.some(order => order.dispatchGroupId !== first.dispatchGroupId ||
        order.fulfillmentType !== "HOLD_BOX" || order.shippingAddress !== first.shippingAddress) ||
        await tx.order.count({ where: { sellerId, dispatchGroupId: first.dispatchGroupId } }) !== orders.length) {
        throw new HttpError("Select every piece in the requested Hold Box parcel.", 409);
      }
    } else if (orders.length !== 1) {
      throw new HttpError("Mark each Ship Now order shipped separately.", 409);
    }
    if (orders.every(order => order.shippedAt || order.shipmentReconciledAt)) return { ok: true };
    if (orders.some(order => order.shippedAt || order.shipmentReconciledAt || order.shipmentUnconfirmed)) {
      throw new HttpError("The shipment status has changed. Refresh before packing.", 409);
    }
    if (first.fulfillmentType === "HOLD_BOX") {
      const ids = orders.flatMap(order => order.items.map(item => item.garmentId));
      const updated = await tx.garment.updateMany({
        where: { id: { in: ids }, sellerId, status: "HOLD_BOX" }, data: { status: "SOLD" },
      });
      if (updated.count !== orders.length) throw new HttpError("The parcel has changed. Refresh before packing.", 409);
    }
    const updated = await tx.order.updateMany({
      where: { sellerId, id: { in: orderIds }, shippedAt: null }, data: { shippedAt: new Date() },
    });
    if (updated.count !== orders.length) throw new HttpError("The parcel has changed. Refresh before packing.", 409);
    return { ok: true };
  });
}

export async function reconcileShipment(sellerId: string, orderId: string) {
  return writeTransaction(async tx => {
    await requireOrderSeller(tx, sellerId);
    const where = { id: orderId, sellerId, paymentStatus: "VERIFIED_PAID", fulfillmentType: "SHIP_NOW", shippedAt: null } as const;
    const { count } = await tx.order.updateMany({ where: { ...where, shipmentUnconfirmed: true, shipmentReconciledAt: null },
      data: { shipmentUnconfirmed: false, shipmentReconciledAt: new Date() } });
    if (count || await tx.order.findFirst({ where: { ...where, shipmentReconciledAt: { not: null } }, select: { id: true } })) return { ok: true };
    throw new HttpError("This order is no longer awaiting shipment review. Refresh the queue.", 409);
  });
}

export async function queueShipment(sellerId: string, orderId: string) {
  return writeTransaction(async tx => {
    await requireOrderSeller(tx, sellerId);
    const { count } = await tx.order.updateMany({
      where: { id: orderId, sellerId, paymentStatus: "VERIFIED_PAID", fulfillmentType: "SHIP_NOW", shippedAt: null, shipmentReconciledAt: null },
      data: { shipmentUnconfirmed: false },
    });
    if (!count) throw new HttpError("This order is no longer available to ship.", 409);
    return { ok: true };
  });
}

export async function lockerLookup(orderId: string, tokens: string[]) {
  const database = db();
  const access = { buyerAccessHash: { in: tokens.map(hashToken) } };
  const tracked = await database.order.findFirst({
    where: { id: orderId, ...access }, select: { buyerPhone: true },
  });
  if (!tracked) throw new HttpError("Order not found in this browser. Check the order number and use the browser used at checkout.", 404);
  return readLockerOrders({
    ...access, ...(tracked.buyerPhone ? { OR: [{ id: orderId }, { buyerPhone: tracked.buyerPhone }] } : { id: orderId }),
  });
}

export function lockerSavedOrders(tokens: string[]) {
  return readLockerOrders({ buyerAccessHash: { in: tokens.map(hashToken) } });
}

async function readLockerOrders(where: Prisma.OrderWhereInput) {
  const orders = await db().order.findMany({
    where,
    include: { ...orderInclude, seller: { select: { id: true, status: true, storeName: true, whatsappNumber: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const now = new Date();
  const parcelGroups = new Map<string, string>();
  return orders.map(order => {
    const item = order.items[0]?.garment;
    let parcelKey = order.id;
    if (order.buyerPhone && order.fulfillmentType === "HOLD_BOX") {
      const group = JSON.stringify([order.sellerId, order.buyerPhone, order.shippingAddress]);
      parcelKey = parcelGroups.get(group) ?? order.id;
      parcelGroups.set(group, parcelKey);
    }
    return {
      id: order.id, code: order.garmentCode, title: order.garmentTitle ?? item?.title ?? order.garmentCode,
      image: item ? garmentImages(item.images)[0] ?? null : null,
      sellerId: order.seller.id, shopStatus: order.seller.status, storeName: order.seller.storeName, sellerPhone: order.seller.whatsappNumber,
      status: order.paymentStatus === "AWAITING_RECEIPT" && item?.lockedUntil && item.lockedUntil > now
        ? "AWAITING_RECEIPT" : order.paymentStatus === "AWAITING_RECEIPT" ? "EXPIRED" : order.paymentStatus,
      itemId: item?.id ?? null, holdBoxDays: order.holdBoxDays, total: order.totalAmount.toFixed(2),
      fulfillmentType: order.fulfillmentType, rejectionReason: order.rejectionReason,
      shippingAddress: order.shippingAddress, shipmentUnconfirmed: order.shipmentUnconfirmed, parcelKey,
      canReportTransfer: !!order.buyerPhone && !order.transferReportedAt && order.seller.status !== "DELETED" &&
        (order.paymentStatus === "EXPIRED" || order.paymentStatus === "REJECTED" ||
          order.paymentStatus === "AWAITING_RECEIPT" && !!item?.lockedUntil && item.lockedUntil <= now),
      ...transferView(order),
      verifiedAt: order.verifiedAt?.toISOString() ?? null,
      dispatchRequestedAt: order.dispatchRequestedAt?.toISOString() ?? null,
      dispatchGroupId: order.dispatchGroupId,
      shippedAt: order.shippedAt?.toISOString() ?? null,
      shipmentReconciledAt: order.shipmentReconciledAt?.toISOString() ?? null,
    };
  });
}

export type LockerOrder = Awaited<ReturnType<typeof lockerLookup>>[number];

export async function requestDispatch(tokens: string[]) {
  return writeTransaction(async tx => {
    const hashes = [...new Set(tokens.map(hashToken))];
    const orders = await tx.order.findMany({
      where: { buyerAccessHash: { in: hashes }, paymentStatus: "VERIFIED_PAID", fulfillmentType: "HOLD_BOX",
        seller: existingShop },
      select: { id: true, sellerId: true, buyerPhone: true, shippingAddress: true, dispatchGroupId: true, shippedAt: true },
    });
    const first = orders[0];
    if (!first?.buyerPhone || orders.length !== hashes.length || orders.some(order => order.sellerId !== first.sellerId ||
      order.buyerPhone !== first.buyerPhone ||
      order.shippingAddress !== first.shippingAddress)) {
      throw new HttpError("Choose available pieces from the same shop and delivery address.", 409);
    }
    if (first.dispatchGroupId && orders.every(order => order.dispatchGroupId === first.dispatchGroupId) &&
      await tx.order.count({ where: { sellerId: first.sellerId, dispatchGroupId: first.dispatchGroupId } }) === orders.length) {
      return { ok: true };
    }
    if (orders.some(order => order.dispatchGroupId || order.shippedAt)) {
      throw new HttpError("Some pieces already belong to a parcel. Refresh your orders.", 409);
    }
    const { count } = await tx.order.updateMany({
      where: { id: { in: orders.map(order => order.id) }, shippedAt: null, dispatchGroupId: null },
      data: { dispatchRequestedAt: new Date(), dispatchGroupId: randomUUID() },
    });
    if (count !== orders.length) throw new HttpError("The selected pieces have changed. Refresh your orders.", 409);
    return { ok: true };
  });
}
