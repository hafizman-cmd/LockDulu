import { HttpError, limitBody, requireOrigin, respond } from "@/lib/http";
import { db } from "@/lib/db";
import { authorizeReceiptUpload, requireReceiptDelivery, submitReceipt } from "@/lib/inventory";
import { checkoutClientKey, limitReceiptUpload, limitSellerUpload } from "@/lib/request-budget";
import { currentSeller } from "@/lib/security";
import { storage } from "@/lib/storage";
import { requireActiveSeller } from "@/lib/shop-status";
import { maxMultipartUpload } from "@/lib/upload-limits";
import { delivery, id, token } from "@/lib/validation";

const maxConcurrentUploads = 4;
const uploadBodyTimeoutMs = 20_000;
let activeUploads = 0;

async function withUploadSlot<T>(upload: () => Promise<T>) {
  if (activeUploads >= maxConcurrentUploads) throw new HttpError("Uploads are busy. Try again shortly.", 429);
  activeUploads += 1;
  try {
    return await upload();
  } finally {
    activeUploads -= 1;
  }
}

async function readUpload(request: Request) {
  const form = await (await limitBody(request, maxMultipartUpload, uploadBodyTimeoutMs)).formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) throw new HttpError("Choose an image to upload.");
  return { form, file };
}

async function uploadReceipt(request: Request) {
  const auth = request.headers.get("authorization");
  const accessToken = token.safeParse(auth?.startsWith("Bearer ") ? auth.slice(7) : null);
  const orderId = id.safeParse(request.headers.get("x-lockdulu-order"));
  if (!accessToken.success || !orderId.success) throw new HttpError("Return to your checkout to upload a receipt.", 401);
  const authorized = await authorizeReceiptUpload(orderId.data, accessToken.data);
  if (authorized.completed) return authorized.completed;

  return withUploadSlot(async () => {
    await limitReceiptUpload(orderId.data, authorized.order.sellerId, checkoutClientKey(request));
    const { form, file } = await readUpload(request);
    const details = delivery.parse(JSON.parse(String(form.get("delivery"))));
    requireReceiptDelivery(authorized.order, details);
    const receipt = await storage.save(file, "receipt");
    try {
      const result = await submitReceipt(orderId.data, accessToken.data, details, receipt.url);
      if (!result.stored) await storage.removeReceipt(receipt.name);
      return { orderId: orderId.data, code: result.code, status: result.status };
    } catch (error) {
      // Keep the file if the database cannot confirm the transaction outcome.
      if (error instanceof HttpError) await storage.removeReceipt(receipt.name);
      throw error;
    }
  });
}

export async function POST(request: Request) {
  return respond(async () => {
    requireOrigin(request);
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind === "receipt") return uploadReceipt(request);
    if (kind !== "garment" && kind !== "qr") throw new HttpError("Select an upload type.");
    const sellerId = await currentSeller();
    if (!sellerId) throw new HttpError("Sign in to upload photos.", 401);
    await requireActiveSeller(db(), sellerId);
    return withUploadSlot(async () => {
      await limitSellerUpload(sellerId);
      const { file } = await readUpload(request);
      // Recheck after reading the upload in case moderation happened while the request body arrived.
      await requireActiveSeller(db(), sellerId);
      const image = await storage.save(file, kind);
      try {
        await requireActiveSeller(db(), sellerId);
      } catch (error) {
        await storage.removeImage(image.name);
        throw error;
      }
      return { url: image.url };
    });
  });
}
