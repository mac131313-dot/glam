// Logo studia (T4: marka studia w aplikacji). Wgrywa właścicielka, widzą klientki.
import type { FastifyInstance } from 'fastify';
import { ctx, requireStudio, type Deps } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';

export const LOGO_MAX_BYTES = 1_000_000;

const MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
type LogoMime = (typeof MIME)[number];

/** Sprawdza faktyczną zawartość pliku (sygnaturę), a nie tylko deklarowany typ. */
export function validateLogo(dataUrl: string): { mime: LogoMime; data: Buffer } {
  return validateImage(dataUrl, { what: 'Logo', maxBytes: LOGO_MAX_BYTES, svg: true });
}

/** Wspólna walidacja obrazów (logo, zdjęcia zajęć): format z nagłówka data URL + zgodna sygnatura pliku. */
export function validateImage(dataUrl: string, opts: { what: string; maxBytes: number; svg: boolean }): { mime: LogoMime; data: Buffer } {
  const m = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m || (!opts.svg && m[1] === 'image/svg+xml')) throw badRequest(`${opts.what} musi być plikiem PNG, JPG${opts.svg ? ', WebP albo SVG' : ' albo WebP'}.`);
  const mime = m[1] as LogoMime;
  const data = Buffer.from(m[2], 'base64');
  if (data.length === 0) throw badRequest(`Plik (${opts.what.toLowerCase()}) jest pusty.`);
  if (data.length > opts.maxBytes) throw badRequest(`${opts.what}: plik może mieć najwyżej ${Math.round(opts.maxBytes / 100_000) / 10} MB.`);

  const starts = (sig: number[], offset = 0) => sig.every((b, i) => data[offset + i] === b);
  const ok =
    mime === 'image/png'
      ? starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      : mime === 'image/jpeg'
        ? starts([0xff, 0xd8, 0xff])
        : mime === 'image/webp'
          ? starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)
          : isSafeSvg(data.toString('utf8'));
  if (!ok) throw badRequest('Zawartość pliku nie pasuje do formatu obrazu. Wgraj inny plik.');
  return { mime, data };
}

/** SVG to tekst, który może zawierać skrypt – odrzucamy wszystko, co aktywne. */
function isSafeSvg(text: string): boolean {
  if (!/<svg[\s>]/i.test(text)) return false;
  return !/<script|<foreignObject|\son[a-z]+\s*=|javascript:|<iframe|<embed|<object/i.test(text);
}

export function logoRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const owner = { preHandler: requireStudio(db, ['owner']) };

  app.put<{ Body: { dataUrl: string; ratio?: number } }>('/api/owner/logo', { ...owner, bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const { scope } = ctx(req);
    const { mime, data } = validateLogo(req.body?.dataUrl);
    const ratio = Math.min(8, Math.max(0.2, Number(req.body?.ratio) || 1));
    scope.run('UPDATE studios SET logo_mime = $mime, logo_data = $data, logo_ratio = $ratio, logo_version = logo_version + 1 WHERE id = $studio', {
      mime,
      data,
      ratio,
    });
    return { ok: true };
  });

  app.delete('/api/owner/logo', owner, async (req) => {
    ctx(req).scope.run('UPDATE studios SET logo_mime = NULL, logo_data = NULL, logo_ratio = NULL, logo_version = logo_version + 1 WHERE id = $studio');
    return { ok: true };
  });

  // Publiczne – logo to znak marki, który i tak widzi każda klientka; nie zawiera danych osobowych.
  app.get<{ Params: { id: string } }>('/api/studios/:id/logo', async (req, reply) => {
    const row = db.prepare('SELECT logo_mime, logo_data FROM studios WHERE id = ?').get(req.params.id) as
      | { logo_mime: string | null; logo_data: Uint8Array | null }
      | undefined;
    if (!row?.logo_mime || !row.logo_data) throw notFound('To studio nie ma logo.');
    return reply
      .header('content-type', row.logo_mime)
      .header('cache-control', 'public, max-age=31536000, immutable') // adres zawiera wersję
      .header('x-content-type-options', 'nosniff')
      // Nawet otwarte bezpośrednio, logo nie może niczego uruchomić.
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox")
      .send(Buffer.from(row.logo_data));
  });
}
