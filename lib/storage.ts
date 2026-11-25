import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";
import sharp from "sharp";
import { appKey } from "./security.ts";
import { HttpError } from "./http.ts";
import { maxUpload, uploadImageSides, uploadSizeMessage, type UploadKind } from "./upload-limits.ts";

const imageName = /^[a-f0-9-]{36}\.webp$/;
const receiptName = /^[a-f0-9-]{36}\.bin$/;
const root = path.join(process.cwd(), "public", "uploads");
const jpegSignature = Buffer.from([0xff, 0xd8, 0xff]);
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const heifBrands = new Set(["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

function imageFormat(bytes: Buffer) {
  if (bytes.subarray(0, jpegSignature.length).equals(jpegSignature)) return "jpeg";
  if (bytes.subarray(0, pngSignature.length).equals(pngSignature)) return "png";
  if (bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "webp";
  if (bytes.length < 16 || bytes.toString("latin1", 4, 8) !== "ftyp") return null;
  const end = bytes.readUInt32BE(0);
  if (end < 16 || end > Math.min(bytes.length, 4096) || end % 4 !== 0) return null;
  if (heifBrands.has(bytes.toString("latin1", 8, 12))) return "heif";
  for (let offset = 16; offset < end; offset += 4) {
    if (heifBrands.has(bytes.toString("latin1", offset, offset + 4))) return "heif";
  }
  return null;
}

function useBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN ||
    (process.env.BLOB_STORE_ID && (process.env.VERCEL || process.env.VERCEL_OIDC_TOKEN)));
}

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

async function removeFile(name: string, pattern: RegExp) {
  if (!pattern.test(name)) return;
  if (useBlob()) {
    await del(`lockdulu/${name}`).catch(error => console.error(error));
  } else {
    await unlink(path.join(root, name)).catch(error => console.error(error));
  }
}

export const storage = {
  async save(file: File, kind: UploadKind) {
    if (file.size > maxUpload) throw new HttpError(uploadSizeMessage, 413);
    const bytes = Buffer.from(await file.arrayBuffer());
    const expected = imageFormat(bytes);
    const readError = "Choose a readable JPG, PNG, WebP, AVIF or HEIF image.";
    if (!expected) throw new HttpError(readError);
    let image: Buffer;
    try {
      const input = sharp(bytes, { limitInputPixels: 40_000_000 });
      const { format } = await input.metadata();
      if (format !== expected) throw new Error("Unsupported image");
      const size = uploadImageSides[kind];
      image = await input.rotate().resize(size, size, { fit: "inside", withoutEnlargement: true })
        .webp({ lossless: kind !== "garment", quality: 87 }).toBuffer();
    } catch {
      throw new HttpError(readError);
    }
    const sealed = kind === "receipt";
    const name = randomUUID() + (sealed ? ".bin" : ".webp");
    const content = sealed ? encrypt(image) : image;
    if (useBlob()) {
      await put(`lockdulu/${name}`, content, {
        access: "private", contentType: sealed ? "application/octet-stream" : "image/webp",
      });
    } else {
      if (process.env.VERCEL) throw new Error("Connect a Blob store to this Vercel project.");
      await mkdir(root, { recursive: true });
      await writeFile(path.join(root, name), content, { flag: "wx" });
    }
    return { name, url: sealed ? name : `/api/media/${name}` };
  },
  async removeReceipt(name: string) {
    await removeFile(name, receiptName);
  },
  async removeImage(name: string) {
    await removeFile(name, imageName);
  },
  async read(name: string, sealed = false) {
    if (!(sealed ? receiptName : imageName).test(name)) throw new HttpError("Image not found.", 404);
    let content: Buffer | null = null;
    if (useBlob()) {
      const result = await get(`lockdulu/${name}`, { access: "private" });
      if (result?.statusCode === 200) content = Buffer.from(await new Response(result.stream).arrayBuffer());
    }
    if (!content && !process.env.VERCEL) content = await readFile(path.join(root, name)).catch(() => null);
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
