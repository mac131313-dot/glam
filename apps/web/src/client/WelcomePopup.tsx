// Popup powitalny (sekcja 6). Pojawia się raz; po zamknięciu trafia do skrzynki „Od Twojej trenerki”.
// Pisze człowiek, nie automat (6.6): powitanie trenerki jest podpisane jej imieniem, a zapasowe – „Od studia”
// (decyzja 3). Wideo do 30 s, pionowe; dostępne też jako tekst dla czytnika ekranu (6.4).
import { AuthVideo, Avatar, Sheet } from '../ui.tsx';

export function WelcomePopup(props: { welcome: { body: string; trainer_name: string | null; kind?: string; video_id?: string | null }; onClose: () => void; onBook: () => void; onStudio?: () => void; onCourses?: () => void }) {
  const { welcome } = props;
  const fromStudio = welcome.kind === 'studio' || !welcome.trainer_name;
  const who = fromStudio ? 'Od studia' : welcome.trainer_name!;
  return (
    <Sheet onClose={props.onClose} label={fromStudio ? 'Wiadomość od studia' : `Wiadomość od ${who}`}>
      <div className="stack-lg">
        <div className="welcome-hero stack">
          <div className="row">
            <Avatar name={fromStudio ? 'S' : who} />
            <div>
              <div className="eyebrow" style={{ marginBottom: 0 }}>
                {fromStudio ? 'Od studia' : welcome.kind === 'trainer_change' ? 'Twoja nowa trenerka' : 'Od Twojej trenerki'}
              </div>
              <div className="card-title">{fromStudio ? 'Cały zespół' : who}</div>
            </div>
          </div>
          {welcome.video_id && <AuthVideo className="video-916" src={`/api/media/${welcome.video_id}`} controls playsInline aria-label="Wideo powitalne – treść poniżej" />}
          <p style={{ fontSize: '1.08rem', margin: 0, lineHeight: 1.6 }}>{welcome.body}</p>
          {!fromStudio && (
            <p className="serif" style={{ fontSize: '1.5rem', margin: 0 }}>
              Twoja {who}
            </p>
          )}
        </div>
        <p className="small muted center" style={{ margin: 0 }}>
          Zabierz wodę, wygodny strój i skarpetki antypoślizgowe.
        </p>
        <div className="stack" style={{ gap: 10 }}>
          <button
            className="btn block"
            onClick={() => {
              props.onClose();
              props.onBook();
            }}
          >
            Zarezerwuj pierwsze zajęcia
          </button>
          <div className="row">
            {props.onStudio && (
              <button className="btn ghost grow" onClick={() => (props.onClose(), props.onStudio!())}>
                Poznaj studio
              </button>
            )}
            {props.onCourses && (
              <button className="btn ghost grow" onClick={() => (props.onClose(), props.onCourses!())}>
                Zobacz kursy
              </button>
            )}
          </div>
          <button className="btn quiet block" onClick={props.onClose}>
            Dziękuję, zamknij
          </button>
        </div>
      </div>
    </Sheet>
  );
}
