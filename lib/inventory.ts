import type { Drop, Garment, Order, Prisma } from "@/generated/prisma/client";
import { db, writeTransaction } from "./db.ts";
import type { GarmentView, Pin, Quote } from "./catalog";
import { HttpError } from "./http.ts";
import { paymentConfigured, samplePaymentQr } from "./payment.ts";
import { limitLockRequest, limitNewReservation } from "./request-budget.ts";
import { hashToken } from "./security.ts";
import { activeShop, existingShop, requireOrderSeller } from "./shop-status.ts";
import type { z } from "zod";
import type { buyerTransferUpdate, delivery, receiptRejection, sellerTransferUpdate } from "./validation";

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
  const where = { ...scope, status: "LOCKED" as const, lockedUntil: { lte: new Date() } };
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
    status: item.status, hidden: item.hidden, lockedUntil: item.lockedUntil?.toISOString() ?? null, dropId: item.dropId,
    locksOpen: !item.drop || item.drop.status === "LIVE",
  };
}

export const storeSelect = { storeName: true, storeSlug: true, bio: true, whatsappNumber: true } as const;
const paymentSelect = { qrCodeUrl: true, qrAccountName: true, qrBankLabel: true } as const;

export async function readStore(slug: string) {
  const storeSlug = slug.toLowerCase();
  const activeStore = { storeSlug, ...activeShop };
  const [seller, initialItems, initialDrops] = await Promise.all([
    db().seller.findUnique({ where: activeStore, select: { ...storeSelect, ...paymentSelect, bannerImageUrl: true, id: true } }),
    db().garment.findMany({ where: { seller: activeStore, hidden: false, deletedAt: null }, include: { drop: true }, orderBy: { code: "asc" } }),
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
      db().garment.findMany({ where: { sellerId: seller.id, seller: activeShop, hidden: false, deletedAt: null }, include: { drop: true }, orderBy: { code: "asc" } }),
      db().drop.findMany({ where: { sellerId: seller.id, seller: activeShop, status: { not: "ENDED" } }, orderBy: { scheduledAt: "asc" } }),
    ]);
  }
  const { storeName, bio, whatsappNumber, bannerImageUrl } = seller;
  return { store: { storeName, storeSlug, bio, whatsappNumber, bannerImageUrl, paymentReady: paymentConfigured(seller) },
    items: items.map(garmentView), drops: drops.map(drop => ({ id: drop.id, title: drop.title, status: drop.status, scheduledAt: drop.scheduledAt.toISOString() })), serverTime: Date.now() };
}

export async function readItem(id: string) {
  const where = { id, seller: activeShop, hidden: false, deletedAt: null };
  const include = { drop: true, seller: { select: { ...storeSelect, ...paymentSelect } } } as const;
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
  if (!item) return null;
  const { storeName, storeSlug, bio, whatsappNumber } = item.seller;
  return { item: garmentView(item), store: { storeName, storeSlug, bio, whatsappNumber, paymentReady: paymentConfigured(item.seller) }, serverTime: Date.now() };
}

function quote(order: Order, lockedUntil: Date): Quote {
  return {
    orderId: order.id, lockedUntil: lockedUntil.toISOString(), itemAmount: order.itemAmount.toFixed(2),
    shippingFee: order.shippingFee.toFixed(2), shipTotal: order.itemAmount.plus(order.shippingFee).toFixed(2),
    holdBoxDays: order.holdBoxDays, qrCodeUrl: order.qrCodeUrl, qrAccountName: order.qrAccountName, qrBankLabel: order.qrBankLabel,
  };
}

export async function lockItem(id: string, token: string, checkPaymentImage?: (url: string) => Promise<void>, client: string | null = null) {
  const hash = hashToken(token);
  const item = await db().garment.findUnique({ where: { id, seller: activeShop, hidden: false, deletedAt: null },
    select: { sellerId: true, status: true, lockSessionToken: true, lockedUntil: true, seller: { select: paymentSelect } } });
  if (!item) throw new HttpError("This garment could not be found.", 404);
  const now = new Date();
  const resuming = item.lockSessionToken === hash && item.lockedUntil && item.lockedUntil > now;
  if (!resuming) {
    if (item.status !== "AVAILABLE" && !(item.status === "LOCKED" && item.lockedUntil && item.lockedUntil <= now)) {
      throw new HttpError("This piece is no longer available to lock.", 409);
    }
    if (client) await limitLockRequest(client);
    if (paymentConfigured(item.seller) && item.seller.qrCodeUrl !== samplePaymentQr) {
      if (!checkPaymentImage) throw new HttpError("This shop's payment QR could not be checked.", 503);
      await checkPaymentImage(item.seller.qrCodeUrl);
    }
  }
  await openDueDrops(item.sellerId);
  return writeTransaction(async tx => {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + 600_000);
    const updated = await tx.garment.updateMany({
      where: { id, seller: activeShop, hidden: false, deletedAt: null, AND: [
        { OR: [{ dropId: null }, { drop: { status: "LIVE" } }] },
        { OR: [{ status: "AVAILABLE" }, { status: "LOCKED", lockedUntil: { lte: now } }] },
      ] },
      data: { status: "LOCKED", lockedUntil, lockSessionToken: hash },
    });
    if (!updated.count) {
      const existing = await tx.garment.findFirst({
        where: { id, seller: activeShop, hidden: false, deletedAt: null, status: "LOCKED", lockSessionToken: hash, lockedUntil: { gt: new Date() } },
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
    if (resuming || !paymentConfigured(seller) || seller.qrCodeUrl !== item.seller.qrCodeUrl) {
      throw new HttpError("This shop's payment setup is unavailable. Contact the seller or try again later.", 409);
    }
    await limitNewReservation(tx, id, seller.id, client);
    const order = await tx.order.create({ data: {
      sellerId: seller.id, buyerAccessHash: hash, garmentCode: garment.code, garmentTitle: garment.title, itemAmount: garment.price,
      shippingFee: seller.shippingFee, totalAmount: garment.price.plus(seller.shippingFee), holdBoxDays: seller.holdBoxDays,
      qrCodeUrl: seller.qrCodeUrl, qrAccountName: seller.qrAccountName, qrBankLabel: seller.qrBankLabel,
      items: { create: { garmentId: id } },
    } });
    return { quote: quote(order, lockedUntil), serverTime: Date.now() };
  });
}

export async function orderState(orderId: string, token: string) {
  const order = await db().order.findUnique({
    where: { id: orderId, buyerAccessHash: hashToken(token) },
    include: { items: { include: { garment: true } } },
  });
  if (!order) throw new HttpError("This checkout could not be found.", 404);
  const garment = order.items[0]?.garment;
  if (order.paymentStatus === "AWAITING_RECEIPT" && garment?.lockedUntil && garment.lockedUntil <= new Date()) {
    await releaseExpired({ id: garment.id });
    return orderState(orderId, token);
  }
  const checkoutQuote = order.paymentStatus === "AWAITING_RECEIPT" && garment?.lockedUntil ? quote(order, garment.lockedUntil) : null;
  return {
    status: order.paymentStatus, code: order.garmentCode, serverTime: Date.now(), rejectionReason: order.rejectionReason,
    paymentTotal: checkoutQuote && order.buyerPhone && paymentConfigured(order) ? order.totalAmount.toFixed(2) : null,
    quote: checkoutQuote,
    delivery: checkoutQuote && order.buyerPhone ? {
      buyerName: order.buyerName, buyerPhone: order.buyerPhone, shippingAddress: order.shippingAddress, fulfillmentType: order.fulfillmentType,
    } : null,
  };
}

export async function preparePayment(orderId: string, token: string, details: z.infer<typeof delivery>) {
  return writeTransaction(async tx => {
    const hash = hashToken(token);
    const where = {
      id: orderId, buyerAccessHash: hash, paymentStatus: "AWAITING_RECEIPT", seller: activeShop,
      items: { some: { garment: { status: "LOCKED", lockSessionToken: hash, lockedUntil: { gt: new Date() } } } },
    } as const;
    const order = await tx.order.findUnique({ where, select: { itemAmount: true, shippingFee: true, ...paymentSelect } });
    if (!order) throw new HttpError("Your reservation has ended. Check your order status before paying.", 409);
    if (!paymentConfigured(order)) throw new HttpError("This order's payment setup is unavailable. Contact the seller.", 409);
    const totalAmount = details.fulfillmentType === "HOLD_BOX" ? order.itemAmount : order.itemAmount.plus(order.shippingFee);
    await tx.order.update({ where, data: {
      ...details, totalAmount,
    } });
    return { total: totalAmount.toFixed(2) };
  });
}

export async function reportTransfer(orderId: string, token: string, reference: string) {
  await orderState(orderId, token);
  return writeTransaction(async tx => {
    const where = { id: orderId, buyerAccessHash: hashToken(token), seller: existingShop } as const;
    const order = await tx.order.findUnique({ where, select: { paymentStatus: true, buyerPhone: true, transferReportedAt: true } });
    if (!order) throw new HttpError("This checkout could not be found or the shop has closed.", 404);
    if (order.transferReportedAt) return { ok: true };
    if (!order.buyerPhone || (order.paymentStatus !== "EXPIRED" && order.paymentStatus !== "REJECTED")) {
      throw new HttpError("This order is not eligible for a transfer report. Check your order status first.", 409);
    }
    await tx.order.update({ where, data: { transferReference: reference, transferReportedAt: new Date() } });
    return { ok: true };
  });
}

async function saveTransferUpdate(tx: Prisma.TransactionClient, orderId: string, version: number, kind: string, data: Prisma.OrderUpdateInput, detail?: string) {
  const now = new Date();
  await tx.order.update({ where: { id: orderId, transferVersion: version, transferResolvedAt: null }, data: {
    ...data, transferVersion: { increment: 1 },
    transferEvents: { create: { version: version + 1, kind, createdAt: now, detail } },
  } });
  return { ok: true };
}

const malaysiaDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Kuala_Lumpur", dateStyle: "short" });

export async function updateSellerTransfer(sellerId: string, orderId: string, version: number, update: z.infer<typeof sellerTransferUpdate>) {
  return writeTransaction(async tx => {
    await requireOrderSeller(tx, sellerId);
    const order = await tx.order.findUnique({ where: { id: orderId, sellerId, transferVersion: version,
      transferReportedAt: { not: null }, transferResolvedAt: null } });
    if (!order) throw new HttpError("This transfer report has changed. Refresh before recording an update.", 409);
    if (update.type === "TRANSFER_NOT_FOUND") {
      if (order.transferResolution) throw new HttpError("Refresh the case before recording a new outcome.", 409);
      return saveTransferUpdate(tx, orderId, version, update.type, { transferResolution: update.type });
    }
    if (order.transferResolution === "REFUNDED" && order.refundReference && !order.refundDisputedAt) {
      throw new HttpError("The buyer is checking the reported refund.", 409);
    }
    if (Number(update.amount) <= 0 || order.totalAmount.lessThan(update.amount)) {
      throw new HttpError("Enter a refund amount greater than zero and no more than the order total.");
    }
    if (update.sentOn < malaysiaDate.format(order.createdAt) || update.sentOn > malaysiaDate.format(new Date())) {
      throw new HttpError("Enter a refund date between the order date and today.");
    }
    const { amount, sentOn, reference, note } = update;
    return saveTransferUpdate(tx, orderId, version, update.type, {
      transferResolution: update.type, refundAmount: amount, refundSentOn: sentOn,
      refundReference: reference, refundNote: note || null, refundDisputedAt: null,
    }, `RM${Number(amount).toFixed(2)} · ${sentOn} · Reference ${reference}`);
  });
}

export async function updateBuyerTransfer(orderId: string, token: string, version: number, update: z.infer<typeof buyerTransferUpdate>) {
  return writeTransaction(async tx => {
    const order = await tx.order.findUnique({ where: { id: orderId, buyerAccessHash: hashToken(token), transferReportedAt: { not: null } } });
    if (!order) throw new HttpError("This transfer report could not be found.", 404);
    if (order.transferResolvedAt || order.transferVersion !== version) {
      throw new HttpError("This transfer report has changed. Refresh My orders before continuing.", 409);
    }
    if (update.type === "REQUEST_HELP") {
      if (order.transferEscalatedAt) return { ok: true };
      return saveTransferUpdate(tx, orderId, version, update.type, { transferEscalatedAt: new Date() });
    }
    if (update.type === "CORRECT_REFERENCE") {
      if (order.transferResolution !== "TRANSFER_NOT_FOUND") throw new HttpError("The seller hasn’t asked for a corrected reference.", 409);
      return saveTransferUpdate(tx, orderId, version, update.type, { transferResolution: null, transferReference: update.reference }, update.reference);
    }
    if (order.transferResolution !== "REFUNDED") throw new HttpError("The seller hasn’t reported a refund.", 409);
    if (update.type === "DISPUTE_REFUND") {
      if (order.refundDisputedAt) return { ok: true };
      return saveTransferUpdate(tx, orderId, version, update.type, { refundDisputedAt: new Date() });
    }
    if (order.refundAmount && order.refundAmount.lessThan(order.totalAmount)) {
      throw new HttpError("The seller reported less than the full order amount. You can dispute the amount or request help.", 409);
    }
    return saveTransferUpdate(tx, orderId, version, update.type, { transferResolvedAt: new Date() });
  });
}

type ReceiptDelivery = z.infer<typeof delivery>;
const receiptDeliveryFields = { buyerName: true, buyerPhone: true, shippingAddress: true, fulfillmentType: true } as const;

export function requireReceiptDelivery(order: ReceiptDelivery, details: ReceiptDelivery) {
  if (!order.buyerPhone || order.buyerPhone !== details.buyerPhone || order.buyerName !== details.buyerName ||
      order.shippingAddress !== details.shippingAddress || order.fulfillmentType !== details.fulfillmentType) {
    throw new HttpError("Checkout details changed. Review the prepared amount and delivery before submitting your receipt.", 409);
  }
}

export async function authorizeReceiptUpload(orderId: string, token: string) {
  const hash = hashToken(token);
  const order = await db().order.findUnique({
    where: { id: orderId, buyerAccessHash: hash },
    select: {
      ...receiptDeliveryFields, paymentStatus: true, garmentCode: true, sellerId: true, seller: { select: { status: true } },
      items: {
        where: { garment: { status: "LOCKED", lockSessionToken: hash, lockedUntil: { gt: new Date() } } },
        select: { id: true }, take: 1,
      },
    },
  });
  if (!order) throw new HttpError("This checkout could not be found.", 404);
  const { paymentStatus: status, garmentCode: code } = order;
  if (status === "PENDING_VERIFICATION" || status === "VERIFIED_PAID") {
    return { completed: { orderId, code, status } } as const;
  }
  if (status !== "AWAITING_RECEIPT" || order.seller.status !== "ACTIVE" || !order.items.length) {
    throw new HttpError("Your lock has expired or been released.", 409);
  }
  if (!order.buyerPhone) throw new HttpError("Prepare your payment before submitting a receipt.", 409);
  return { order } as const;
}

export async function submitReceipt(orderId: string, token: string, details: ReceiptDelivery, receiptImageUrl: string) {
  return writeTransaction(async tx => {
    const hash = hashToken(token);
    const order = await tx.order.findUnique({ where: { id: orderId, buyerAccessHash: hash, seller: activeShop }, include: { items: true } });
    if (!order) throw new HttpError("This checkout could not be found.", 404);
    if (order.paymentStatus === "PENDING_VERIFICATION" || order.paymentStatus === "VERIFIED_PAID") {
      return { orderId, code: order.garmentCode, status: order.paymentStatus, stored: false };
    }
    const garmentId = order.items[0]?.garmentId;
    if (order.paymentStatus !== "AWAITING_RECEIPT" || !garmentId) throw new HttpError("Your lock has expired.", 409);
    requireReceiptDelivery(order, details);
    const changed = await tx.garment.updateMany({
      where: { id: garmentId, seller: activeShop, status: "LOCKED", lockSessionToken: hash, lockedUntil: { gt: new Date() } },
      data: { status: "PENDING_VERIFICATION", lockSessionToken: null, lockedUntil: null },
    });
    if (!changed.count) {
      const current = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { paymentStatus: true } });
      if (current.paymentStatus === "PENDING_VERIFICATION" || current.paymentStatus === "VERIFIED_PAID") {
        return { orderId, code: order.garmentCode, status: current.paymentStatus, stored: false };
      }
      throw new HttpError("Your lock has expired or been released.", 409);
    }
    await tx.order.update({ where: { id: orderId }, data: {
      receiptImageUrl, receiptSubmittedAt: new Date(), paymentStatus: "PENDING_VERIFICATION",
    } });
    return { orderId, code: order.garmentCode, status: "PENDING_VERIFICATION" as const, stored: true };
  });
}

export async function reviewOrder(sellerId: string, orderId: string, paid: boolean, rejectionReason?: z.infer<typeof receiptRejection>) {
  return writeTransaction(async tx => {
    await requireOrderSeller(tx, sellerId);
    if (!paid && !rejectionReason) throw new HttpError("Choose a reason for rejecting this receipt.");
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
      rejectionReason: paid ? null : rejectionReason, reviewedAt: new Date(),
    } });
    if (!reviewed.count) throw new HttpError("This receipt has already been reviewed.", 409);
    if (!paid) await tx.orderItem.delete({ where: { id: order.items[0].id } });
    return { ok: true };
  });
}
