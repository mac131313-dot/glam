// Wymiary obrazu odczytane z nagłówka pliku (bez dekodowania pikseli i bez zależności).
// Zdjęcia zajęć są przerysowywane w przeglądarce przed wysłaniem, więc nie mają już EXIF-owej orientacji –
// wymiary z nagłówka to dokładnie to, co zobaczy klientka.

export function imageSize(data: Uint8Array, mime: string): { width: number; height: number } | null {
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  try {
    if (mime === 'image/png' && b.length >= 24) return valid(b.readUInt32BE(16), b.readUInt32BE(20));
    if (mime === 'image/jpeg') return jpegSize(b);
    if (mime === 'image/webp' && b.length >= 30) {
      const chunk = b.toString('ascii', 12, 16);
      if (chunk === 'VP8 ') return valid(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
      if (chunk === 'VP8L') {
        const bits = b.readUInt32LE(21);
        return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
      }
      if (chunk === 'VP8X') return valid(1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3));
    }
  } catch {
    // ucięty albo nietypowy plik – karta dostanie domyślną wysokość
  }
  return null;
}

/** JPEG: przechodzimy po segmentach do pierwszego SOF (start of frame), który niesie wymiary. */
function jpegSize(b: Buffer) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return valid(b.readUInt16BE(i + 7), b.readUInt16BE(i + 5));
    }
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += marker === 0xff ? 1 : 2; // wypełnienie albo znacznik bez długości
      continue;
    }
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

const valid = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);

/** Proporcje szerokość/wysokość albo null, gdy nie da się ich odczytać. */
export function imageRatio(data: Uint8Array, mime: string): number | null {
  const s = imageSize(data, mime);
  return s ? Math.round((s.width / s.height) * 1000) / 1000 : null;
}
