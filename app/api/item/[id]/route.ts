import { readItem } from "@/lib/inventory";
import { HttpError, respond } from "@/lib/http";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const data = await readItem((await params).id);
    if (!data) throw new HttpError("Garment not found.", 404);
    return data;
  });
}
