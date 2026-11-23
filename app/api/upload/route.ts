import { HttpError, limitBody, requireOrigin, respond } from "@/lib/http";
import { db } from "@/lib/db";
import { orderState, submitReceipt } from "@/lib/inventory";
import { currentSeller } from "@/lib/security";
import { maxUpload, storage } from "@/lib/storage";
import { requireActiveSeller } from "@/lib/shop-status";
import { delivery, id, token } from "@/lib/validation";

export async function POST(request: Request) {
  return respond(async () => {
    requireOrigin(request);
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind !== "garment" && kind !== "qr" && kind !== "receipt") throw new HttpError("Select an upload type.");
    const sellerId = kind === "receipt" ? null : await currentSeller();
    if (kind !== "receipt" && !sellerId) throw new HttpError("Sign in to upload photos.", 401);
    if (sellerId) await requireActiveSeller(db(), sellerId);
    const form = await (await limitBody(request, maxUpload + 32_768)).formData().catch(() => null);
    const file = form?.get("file");
    if (!form || !(file instanceof File)) throw new HttpError("Choose an image to upload.");
    if (kind !== "receipt" && sellerId) {
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
    }
    const orderId = id.parse(form.get("orderId"));
    const accessToken = token.parse(form.get("token"));
    const details = delivery.parse(JSON.parse(String(form.get("delivery"))));
    const existing = await orderState(orderId, accessToken);
    if (existing.status === "PENDING_VERIFICATION" || existing.status === "VERIFIED_PAID") {
      return { orderId, code: existing.code, status: existing.status };
    }
    if (!existing.quote) throw new HttpError("Your lock has expired or been released.", 409);
    const receipt = await storage.save(file, "receipt");
    try {
      const result = await submitReceipt(orderId, accessToken, details, receipt.url);
      if (!result.stored) await storage.removeReceipt(receipt.name);
      return { orderId, code: result.code, status: result.status };
    } catch (error) {
      // Keep the file if the database cannot confirm the transaction outcome.
      if (error instanceof HttpError) await storage.removeReceipt(receipt.name);
      throw error;
    }
  });
}
