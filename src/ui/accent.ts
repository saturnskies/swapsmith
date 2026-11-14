/** Reads the pixels of a saved art image for color sampling. The browser-only half of the accent suggestions; the color math is in src/lib/art.ts. */

/** The side of the square the image is scaled to before its pixels are read: bounds the work for any image size. */
export const SAMPLE_SIZE = 32;

/** RGBA bytes of the image scaled to SAMPLE_SIZE square, or null when it cannot be decoded or read. Never throws. */
export async function samplePixels(blob: Blob): Promise<Uint8ClampedArray | null> {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_SIZE;
    canvas.height = SAMPLE_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    return ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
