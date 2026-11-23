import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }

  status: number;
}

export async function respond(handler: () => Promise<Response | object>) {
  try {
    const result = await handler();
    return result instanceof Response ? result : Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof ZodError) return Response.json({ error: error.issues[0]?.message ?? "Check the provided details." }, { status: 400 });
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid request." }, { status: 400 });
    console.error(error);
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

export function requireOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin === process.env.APP_ORIGIN || origin === new URL(request.url).origin) return;
  const host = request.headers.get("host");
  const clientOrigin = URL.parse(origin);
  if (host && clientOrigin && ["http:", "https:"].includes(clientOrigin.protocol) && clientOrigin.host === host) return;
  throw new HttpError("This request must come from LockDulu.", 403);
}

export async function limitBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new HttpError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError("Request body is required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new HttpError("Request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(new Blob(chunks as Uint8Array<ArrayBuffer>[]), { headers: { "Content-Type": request.headers.get("content-type") ?? "" } });
}
