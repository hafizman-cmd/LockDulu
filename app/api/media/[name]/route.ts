import { imageResponse, storage } from "@/lib/storage";
import { respond } from "@/lib/http";
export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  return respond(async () => imageResponse(await storage.read((await params).name)));
}
