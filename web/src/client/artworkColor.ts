// Small, session-local cache shared by cards using the same artwork.
const colors = new Map<string, string | undefined>();

export function dominantArtworkColor(pixels: ArrayLike<number>): string | undefined {
  const buckets = new Map<number, {weight: number; r: number; g: number; b: number}>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const [r, g, b, alpha] = [pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]];
    const high = Math.max(r, g, b), low = Math.min(r, g, b);
    // Ignore transparent margins, shadows and near-white lettering.
    if (alpha < 128 || high < 35 || (low > 220 && high - low < 25)) continue;
    const weight = (alpha / 255) * (0.35 + (high - low) / high);
    const key = (r >> 5) * 64 + (g >> 5) * 8 + (b >> 5);
    const bucket = buckets.get(key) ?? {weight: 0, r: 0, g: 0, b: 0};
    bucket.weight += weight;
    bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight;
    buckets.set(key, bucket);
  }
  const best = [...buckets.values()].sort((a, b) => b.weight - a.weight)[0];
  if (!best) return;
  return `rgb(${Math.round(best.r / best.weight)}, ${Math.round(best.g / best.weight)}, ${Math.round(best.b / best.weight)})`;
}

export function artworkColor(image: HTMLImageElement): string | undefined {
  const source = image.currentSrc || image.src;
  if (colors.has(source)) return colors.get(source);
  let color: string | undefined;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const context = canvas.getContext('2d', {willReadFrequently: true});
    if (context) {
      context.drawImage(image, 0, 0, 32, 32);
      color = dominantArtworkColor(context.getImageData(0, 0, 32, 32).data);
    }
  } catch {
    // Restricted images keep the theme accent without affecting the artwork.
  }
  if (colors.size >= 128) colors.delete(colors.keys().next().value!);
  colors.set(source, color);
  return color;
}
