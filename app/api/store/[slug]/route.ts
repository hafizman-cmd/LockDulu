import { readStore } from "@/lib/inventory";
import { HttpError, respond } from "@/lib/http";
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return respond(async () => {
    const data = await readStore((await params).slug);
    if (!data) throw new HttpError("Store not found.", 404);
    return data;
  });
}
