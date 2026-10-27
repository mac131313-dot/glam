// Sklep i kursy (zakładka 4): treningi do domu i kursy od trenerek oraz sklep studia w jednym miejscu.
// Zakładki pokazujemy tylko wtedy, gdy jest w nich co kupić; jedna zakładka = bez paska wyboru.
import { useState } from 'react';
import { useApi } from '../api.ts';
import { Empty, Lazy, lazyRetry, Pending, Tabs } from '../ui.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';
import type { CourseCard } from './CoursePages.tsx';

const CourseCatalog = lazyRetry(() => import('./CoursePages.tsx').then((m) => ({ default: m.Catalog })));
const ShopCatalog = lazyRetry(() => import('./ShopPages.tsx').then((m) => ({ default: m.Shop })));

type T = 'workouts' | 'courses' | 'shop';

export function Store() {
  const { studio } = useClient();
  const courses = useApi<CourseCard[]>(hasFeature(studio, 'courses') ? '/courses' : null);
  const [picked, setPicked] = useState<T | null>(null);
  // Błąd sieci = „spróbuj ponownie”; wyłączone kursy w planie = po prostu bez tych zakładek.
  const loading = hasFeature(studio, 'courses') && !courses.data && courses.error?.code !== 'feature_off';
  const list = courses.data ?? [];
  const options: [T, string][] = [
    ...(list.some((c) => c.kind === 'workout') ? ([['workouts', 'Treningi do domu']] as [T, string][]) : []),
    ...(list.some((c) => c.kind !== 'workout') ? ([['courses', 'Kursy']] as [T, string][]) : []),
    ...(hasFeature(studio, 'shop') ? ([['shop', 'Sklep']] as [T, string][]) : []),
  ];
  const tab = picked && options.some((o) => o[0] === picked) ? picked : options[0]?.[0];
  return (
    <div className="stack-lg">
      <h1>
        Sklep <span className="serif">i kursy</span>
      </h1>
      {loading ? (
        <Pending error={courses.error} reload={courses.reload} />
      ) : !tab ? (
        <Empty>Studio nie ma jeszcze nic w sprzedaży online. Zajrzyj tu wkrótce.</Empty>
      ) : (
        <>
          {options.length > 1 && <Tabs label="Sklep i kursy" value={tab} onChange={setPicked} options={options} />}
          <Lazy>{tab === 'shop' ? <ShopCatalog embedded /> : <CourseCatalog only={tab === 'workouts' ? 'workout' : 'courses'} list={courses} />}</Lazy>
        </>
      )}
    </div>
  );
}
