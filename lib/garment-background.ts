import type { InferenceSession } from "onnxruntime-web/wasm";

export const garmentBackgrounds = {
  White: "#fff",
  Black: "#000",
  Original: undefined,
} as const;

export type GarmentBackground = keyof typeof garmentBackgrounds;

const side = 320;
const pixels = side * side;
const mean = [0.485, 0.456, 0.406];
const std = [0.229, 0.224, 0.225];
let model: Promise<InferenceSession> | undefined;

function canvasContext(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image editing is unavailable.");
  return context;
}

function encode(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob?.size) resolve(blob);
      else reject(new Error("Could not prepare the front photo."));
    }, type, quality);
  });
}

async function predictMask(image: ImageBitmap, signal: AbortSignal) {
  const { env, InferenceSession, Tensor } = await import("onnxruntime-web/wasm");
  model ??= (async () => {
    env.wasm.numThreads = 1;
    env.wasm.wasmPaths = {
      mjs: new URL("../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs", import.meta.url).href,
      wasm: new URL("../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm", import.meta.url).href,
    };
    return InferenceSession.create("/models/u2netp.onnx", { executionProviders: ["wasm"] });
  })().catch(error => {
    model = undefined;
    throw error;
  });

  const sample = canvasContext(side, side);
  sample.imageSmoothingQuality = "high";
  sample.fillStyle = "#fff";
  sample.fillRect(0, 0, side, side);
  sample.drawImage(image, 0, 0, side, side);
  const rgba = sample.getImageData(0, 0, side, side).data;
  let maxChannel = 1;
  for (let i = 0; i < pixels; i++) {
    maxChannel = Math.max(maxChannel, rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
  }
  const normalized = new Float32Array(3 * pixels);
  for (let channel = 0; channel < 3; channel++) {
    for (let i = 0; i < pixels; i++) {
      normalized[channel * pixels + i] = (rgba[i * 4 + channel] / maxChannel - mean[channel]) / std[channel];
    }
  }

  const session = await model;
  signal.throwIfAborted();
  const input = new Tensor("float32", normalized, [1, 3, side, side]);
  const outputName = session.outputNames[0];
  const result = await session.run({ [session.inputNames[0]]: input }, [outputName]).finally(() => input.dispose());
  const output = result[outputName];
  try {
    const scores = output.data;
    if (!(scores instanceof Float32Array) || scores.length !== pixels) throw new Error("Invalid garment mask.");
    let lo = 1, hi = 0;
    for (const score of scores) {
      lo = Math.min(lo, score);
      hi = Math.max(hi, score);
    }
    if (!(hi - lo > 0.25)) throw new Error("No clear garment was detected.");

    const mask = sample.createImageData(side, side);
    let foreground = 0;
    for (let i = 0; i < pixels; i++) {
      const opacity = (scores[i] - lo) / (hi - lo);
      if (opacity >= 0.5) foreground++;
      mask.data[i * 4 + 3] = Math.round(opacity * 255);
    }
    if (foreground < pixels * 0.01 || foreground > pixels * 0.98) throw new Error("No clear garment was detected.");
    sample.putImageData(mask, 0, 0);
    return sample.canvas;
  } finally {
    output.dispose();
  }
}

export async function prepareGarmentCutout(url: string, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("Could not load the front photo.");
  const image = await createImageBitmap(await response.blob());
  try {
    signal.throwIfAborted();
    const mask = await predictMask(image, signal);
    signal.throwIfAborted();
    // Keep the original framing so changing the background preserves flaw pin coordinates.
    const cutout = canvasContext(image.width, image.height);
    cutout.drawImage(image, 0, 0);
    cutout.globalCompositeOperation = "destination-in";
    cutout.imageSmoothingQuality = "high";
    cutout.drawImage(mask, 0, 0, image.width, image.height);
    return { canvas: cutout.canvas, preview: await encode(cutout.canvas, "image/png") };
  } finally {
    image.close();
  }
}

export async function makeGarmentPhoto(cutout: HTMLCanvasElement, background: string) {
  const photo = canvasContext(cutout.width, cutout.height);
  photo.fillStyle = background;
  photo.fillRect(0, 0, cutout.width, cutout.height);
  photo.drawImage(cutout, 0, 0);
  const blob = await encode(photo.canvas, "image/jpeg", 0.94);
  return new File([blob], "garment-front.jpg", { type: blob.type });
}
