// Konta demo dostępne bez logowania (tryb demo). Ten sam seed co w apps/api/src/seed.ts.
// Pierwsza persona na liście jest domyślna.
export const PERSONAS: Record<'panel' | 'app', Record<string, { phone: string; label: string }>> = {
  panel: {
    ssg: { phone: '500000201', label: 'SS&G · właścicielka' },
    recepcja: { phone: '500000202', label: 'SS&G · recepcja' },
    weronika: { phone: '500000203', label: 'Weronika · trenerka SS&G' },
    joanna: { phone: '500000001', label: 'Joanna · Centrum Ruchu (demo)' },
    marzena: { phone: '500000002', label: 'Marzena · trenerka (demo)' },
    kasia: { phone: '500000004', label: 'Kasia · recepcja (demo)' },
    beata: { phone: '500000007', label: 'Beata · Flow Pilates Kraków' },
  },
  app: {
    julia: { phone: '500000212', label: 'Julia · klientka SS&G' },
    magda: { phone: '500000005', label: 'Magda · klientka w 2 studiach (demo)' },
    ania: { phone: '500000006', label: 'Ania · nowa klientka (demo)' },
  },
};
