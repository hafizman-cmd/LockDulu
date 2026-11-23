import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { appKey } from "./security";
import { HttpError } from "./http";

const imageName = /^[a-f0-9-]{36}\.webp$/;
const receiptName = /^[a-f0-9-]{36}\.bin$/;
export const maxUpload = 10 * 1024 * 1024;
const root = path.join(process.cwd(), "public", "uploads");

function encrypt(image: Buffer) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", appKey("receipt encryption"), iv);
  const data = Buffer.concat([cipher.update(image), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]);
}

function decrypt(data: Buffer) {
  const cipher = createDecipheriv("aes-256-gcm", appKey("receipt encryption"), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]);
}

export const storage = {
  async save(file: File, kind: "garment" | "qr" | "receipt") {
    if (file.size > maxUpload || !file.size) throw new HttpError("Choose an image under 10 MB.", 413);
    let image: Buffer;
    try {
      const input = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 });
      const { format } = await input.metadata();
      if (!format || !["jpeg", "png", "webp", "heif", "avif"].includes(format)) throw new Error("Unsupported image");
      const size = kind === "garment" ? 1600 : 2600;
      image = await input.rotate().resize(size, size, { fit: "inside", withoutEnlargement: true })
        .webp({ lossless: kind !== "garment", quality: 87 }).toBuffer();
    } catch {
      throw new HttpError("Choose a readable JPG, PNG, WebP or HEIF image.");
    }
    const sealed = kind === "receipt";
    const name = randomUUID() + (sealed ? ".bin" : ".webp");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, name), sealed ? encrypt(image) : image, { flag: "wx" });
    return { name, url: sealed ? name : `/api/media/${name}` };
  },
  async removeReceipt(name: string) {
    if (receiptName.test(name)) await unlink(path.join(root, name)).catch(error => console.error(error));
  },
  async read(name: string, sealed = false) {
    if (!(sealed ? receiptName : imageName).test(name)) throw new HttpError("Image not found.", 404);
    const content = await readFile(path.join(root, name)).catch(() => null);
    if (!content) throw new HttpError("Image not found.", 404);
    return sealed ? decrypt(content) : content;
  },
};

export function imageResponse(image: Buffer, sealed = false) {
  return new Response(new Uint8Array(image), { headers: {
    "Content-Type": "image/webp",
    "Cache-Control": sealed ? "private, no-store" : "public, max-age=31536000, immutable",
    "Cross-Origin-Resource-Policy": "same-origin",
  } });
}
