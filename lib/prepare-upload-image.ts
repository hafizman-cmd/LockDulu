import { imageSelectionSizeMessage, maxSelectedImage, maxUpload, uploadImageSides, type UploadKind } from "./upload-limits";

function encode(canvas: HTMLCanvasElement, type: "image/webp" | "image/png", quality?: number) {
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
}

export async function prepareUploadImage(file: File, kind: UploadKind) {
  if (!file.size) throw new Error("Choose a readable image.");
  if (file.size <= maxUpload) return file;
  if (file.size > maxSelectedImage) throw new Error(imageSelectionSizeMessage);

  const image = new Image();
  const url = URL.createObjectURL(file);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 0;
  try {
    image.src = url;
    await image.decode().catch(() => {
      throw new Error("This device could not open the image. Try a JPG or PNG copy.");
    });
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser could not resize the image. Try a smaller copy.");

    const maxSide = uploadImageSides[kind];
    const longSide = Math.max(image.naturalWidth, image.naturalHeight);
    const scales = kind === "receipt" ? [1, 0.9, 0.8] : [1, 0.85, 0.7];
    for (const scale of scales) {
      const ratio = Math.min(1, maxSide * scale / longSide);
      const width = Math.max(1, Math.round(image.naturalWidth * ratio));
      const height = Math.max(1, Math.round(image.naturalHeight * ratio));
      if (width === canvas.width && height === canvas.height) continue;
      canvas.width = width;
      canvas.height = height;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      // Keep payment images lossless so the QR edges and small receipt text stay clear.
      const blob = kind === "garment" ? await encode(canvas, "image/webp", 0.92) : await encode(canvas, "image/png");
      if (blob?.size && blob.size <= maxUpload) {
        return new File([blob], blob.type === "image/webp" ? "photo.webp" : "photo.png", { type: blob.type });
      }
    }
    if (kind === "receipt") throw new Error("This receipt is still too large. Try a screenshot or crop around the payment details.");
    if (kind === "qr") throw new Error("This QR image is still too large. Try the original image from your bank or eWallet.");
    throw new Error("This photo is still too large after resizing. Try a smaller copy.");
  } finally {
    image.removeAttribute("src");
    URL.revokeObjectURL(url);
    canvas.width = canvas.height = 0;
  }
}
