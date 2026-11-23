import { db } from "@/lib/db";
import { imageResponse, storage } from "@/lib/storage";
import { HttpError, respond } from "@/lib/http";
import { currentSeller } from "@/lib/security";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const sellerId = await currentSeller();
    if (!sellerId) throw new HttpError("Sign in to view receipts.", 401);
    const order = await db().order.findUnique({ where: { id: (await params).id, sellerId }, select: { receiptImageUrl: true } });
    if (!order?.receiptImageUrl) throw new HttpError("Receipt not found.", 404);
    return imageResponse(await storage.read(order.receiptImageUrl, true), true);
  });
}
