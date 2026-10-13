// Przygotowanie logo w przeglądarce przed wysłaniem:
// zdjęcia/PNG/JPG/WebP → zmniejszone do 800 px i zapisane jako PNG (przezroczystość zostaje, metadane znikają);
// SVG → bez zmian (wektor), ale serwer i tak sprawdza, czy nie zawiera skryptów.

const MAX_SIDE = 800;
const MAX_INPUT = 8 * 1024 * 1024;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nie udało się odczytać obrazu.'));
    img.src = src;
  });

function svgRatio(text: string, img: HTMLImageElement): number {
  if (img.naturalWidth && img.naturalHeight) return img.naturalWidth / img.naturalHeight;
  const vb = /viewBox\s*=\s*["']\s*[\d.-]+[\s,]+[\d.-]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  return vb ? Number(vb[1]) / Number(vb[2]) : 1;
}

export async function prepareLogo(file: File): Promise<{ dataUrl: string; ratio: number }> {
  if (file.size > MAX_INPUT) throw new Error('Ten plik jest za duży (max 8 MB przed zmniejszeniem).');

  if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg')) {
    const text = await file.text();
    if (text.length > 900_000) throw new Error('Plik SVG jest za duży (max ok. 0,9 MB).');
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    try {
      const img = await loadImage(url);
      const bytes = new TextEncoder().encode(text);
      let bin = '';
      bytes.forEach((b) => (bin += String.fromCharCode(b)));
      return { dataUrl: `data:image/svg+xml;base64,${btoa(bin)}`, ratio: svgRatio(text, img) };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Wgraj plik PNG, JPG, WebP albo SVG.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), ratio: img.naturalWidth / img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Zdjęcie zajęć (tło karty w grafiku): zmniejszone do 1600 px i zapisane jako JPG – zdjęcia nie potrzebują
 * przezroczystości, a JPG jest kilka razy lżejszy od PNG. Metadane (np. lokalizacja z telefonu) znikają przy przerysowaniu.
 */
export async function preparePhoto(file: File): Promise<string> {
  if (file.size > 15 * 1024 * 1024) throw new Error('To zdjęcie jest za duże (max 15 MB przed zmniejszeniem).');
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Wgraj zdjęcie JPG, PNG albo WebP.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
