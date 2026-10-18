// Społeczność (3: zakładka 4): wiadomości, grupy, wyzwania, zaproszenia, muzyka. Zamknięta w obrębie studia
// (decyzja 10). Zakładki pokazujemy tylko dla funkcji włączonych w planie studia.
import { useState } from 'react';
import { Lazy, Tabs } from '../ui.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';
// Te same leniwe moduły co podstrony – statyczny import wciągał je (i całe Ustawienia) do głównej paczki.
import { AccountPages, CommunityPages } from './router.tsx';

type T = 'messages' | 'groups' | 'challenges' | 'invites' | 'music';

export function Community() {
  const { studio } = useClient();
  // Kolejność: wiadomości, grupy, wyzwania – pierwsza zakładka otwiera się domyślnie.
  const options: [T, string][] = [
    ['messages', 'Wiadomości'],
    ...(hasFeature(studio, 'community') ? ([['groups', 'Grupy']] as [T, string][]) : []),
    ...(hasFeature(studio, 'challenges') ? ([['challenges', 'Wyzwania']] as [T, string][]) : []),
    ['invites', 'Zaproś znajomą'],
    ...(hasFeature(studio, 'music') ? ([['music', 'Muzyka']] as [T, string][]) : []),
  ];
  const [tab, setTab] = useState<T>(options[0][0]);
  const close = () => setTab(options[0][0]);
  return (
    <div className="stack-lg">
      <h1>
        Razem <span className="serif">raźniej</span>
      </h1>
      <Tabs label="Społeczność" value={tab} onChange={setTab} options={options} />
      <Lazy>{tab === 'messages' ? <AccountPages route="messages" arg={null} close={close} /> : <CommunityPages route={tab} arg={null} close={close} />}</Lazy>
    </div>
  );
}
