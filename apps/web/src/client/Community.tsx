// Społeczność (3: zakładka 4): feed studia, grupy, wyzwania, zaproszenia, muzyka. Zamknięta w obrębie studia
// (decyzja 10). Zakładki pokazujemy tylko dla funkcji włączonych w planie studia.
import { useState } from 'react';
import { Tabs } from '../ui.tsx';
import CommunityPages from './CommunityPages.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';

type T = 'feed' | 'groups' | 'challenges' | 'invites' | 'music';

export function Community() {
  const { studio } = useClient();
  const options: [T, string][] = [
    ...(hasFeature(studio, 'community') ? ([['feed', 'Feed'], ['groups', 'Grupy']] as [T, string][]) : []),
    ...(hasFeature(studio, 'challenges') ? ([['challenges', 'Wyzwania']] as [T, string][]) : []),
    ['invites', 'Zaproś znajomą'],
    ...(hasFeature(studio, 'music') ? ([['music', 'Muzyka']] as [T, string][]) : []),
  ];
  const [tab, setTab] = useState<T>(options[0][0]);
  return (
    <div className="stack-lg">
      <h1>
        Razem <span className="serif">raźniej</span>
      </h1>
      <Tabs label="Społeczność" value={tab} onChange={setTab} options={options} />
      <CommunityPages route={tab} arg={null} close={() => setTab(options[0][0])} />
    </div>
  );
}
