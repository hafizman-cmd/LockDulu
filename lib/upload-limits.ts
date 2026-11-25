export const maxUpload = 4 * 1024 * 1024;
export const maxMultipartUpload = maxUpload + 32_768;
export const uploadSizeMessage = "Choose an image of 4 MB or less.";
export const maxSelectedImage = 32 * 1024 * 1024;
export const imageSelectionSizeMessage = "Choose an image of 32 MB or less.";
export const uploadImageSides = { garment: 1600, qr: 2600, receipt: 2600 } as const;
export type UploadKind = keyof typeof uploadImageSides;
