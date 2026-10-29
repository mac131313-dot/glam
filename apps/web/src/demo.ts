// Konta demo dostępne bez logowania (tryb demo). Ten sam seed co w apps/api/src/seed.ts.
// Pierwsza persona na liście jest domyślna.
export const PERSONAS: Record<'panel' | 'app', Record<string, { phone: string; label: string }>> = {
  panel: {
    ssg: { phone: '500000201', label: 'SS&G · właścicielka' },
    recepcja: { phone: '500000202', label: 'SS&G · recepcja' },
    weronika: { phone: '500000203', label: 'Weronika · trenerka SS&G' },
  },
  app: {
    julia: { phone: '500000212', label: 'Julia · klientka SS&G' },
    recepcja: { phone: '500000202', label: 'SS&G · recepcja (konto firmowe)' },
  },
};
