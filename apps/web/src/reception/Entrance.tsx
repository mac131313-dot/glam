// Wejście recepcji: ten sam skaner co w panelu (Wejściówki) – kamera, pole na 6 liter albo telefon,
// wybór zajęć, gdy klientka nie ma rezerwacji, i aktywacja wejściówki od znajomej.
import { CheckinPanel } from '../staff/Entrance.tsx';

export function ReceptionEntrance() {
  return (
    <div className="stack">
      <div>
        <h1 style={{ marginBottom: 0 }}>Wejście</h1>
        <p className="small muted" style={{ margin: 0 }}>
          Zeskanuj kod z aplikacji klientki – skaner sam zapisze ją na zajęcia.
        </p>
      </div>
      <CheckinPanel big scanner phone onDone={() => {}} />
    </div>
  );
}
