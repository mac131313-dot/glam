// Przesyłanie lekcji na telewizor bez SDK: AirPlay w Safari (iPhone, iPad, Mac) i Remote Playback API
// w Chrome (Chromecast, Android TV). Odbiornik pobiera film sam, dlatego <video> musi mieć podpisany link
// /api/stream/… zamiast adresu blob: – inaczej telewizor nie ma czego otworzyć.
import { useEffect, useState, type RefObject } from 'react';
import { Icon } from '../icons.tsx';

type State = 'unavailable' | 'available' | 'connecting' | 'connected';

type WebKitVideo = HTMLVideoElement & {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
};

const hasAirPlay = () => typeof window !== 'undefined' && 'WebKitPlaybackTargetAvailabilityEvent' in window;

export function CastButton({ videoRef }: { videoRef: RefObject<HTMLVideoElement | null> }) {
  const [state, setState] = useState<State>('unavailable');

  useEffect(() => {
    const v = videoRef.current as WebKitVideo | null;
    if (!v) return;

    if (hasAirPlay()) {
      // Safari: przycisk tylko gdy w sieci jest Apple TV / głośnik AirPlay.
      const onAvail = (e: Event) => setState((s) => (s === 'connected' ? s : (e as Event & { availability: string }).availability === 'available' ? 'available' : 'unavailable'));
      const onWireless = () => setState(v.webkitCurrentPlaybackTargetIsWireless ? 'connected' : 'available');
      v.addEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
      v.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
      return () => {
        v.removeEventListener('webkitplaybacktargetavailabilitychanged', onAvail);
        v.removeEventListener('webkitcurrentplaybacktargetiswirelesschanged', onWireless);
      };
    }

    const remote = v.remote;
    if (!remote) return;
    const sync = () => setState(remote.state === 'connected' ? 'connected' : remote.state === 'connecting' ? 'connecting' : 'available');
    remote.addEventListener('connect', sync);
    remote.addEventListener('connecting', sync);
    remote.addEventListener('disconnect', sync);
    let watchId: number | null = null;
    remote
      .watchAvailability((ok) => setState((s) => (s === 'connected' || s === 'connecting' ? s : ok ? 'available' : 'unavailable')))
      .then((id) => (watchId = id))
      // Część urządzeń (np. Android z oszczędzaniem energii) nie śledzi dostępności – pokazujemy przycisk, prompt i tak zadziała.
      .catch(() => setState('available'));
    return () => {
      remote.removeEventListener('connect', sync);
      remote.removeEventListener('connecting', sync);
      remote.removeEventListener('disconnect', sync);
      if (watchId !== null) remote.cancelWatchAvailability(watchId).catch(() => {});
    };
  }, [videoRef]);

  if (state === 'unavailable') return null;

  const open = () => {
    const v = videoRef.current as WebKitVideo | null;
    if (!v) return;
    if (v.webkitShowPlaybackTargetPicker) v.webkitShowPlaybackTargetPicker();
    else v.remote?.prompt().catch(() => {}); // anulowanie wyboru urządzenia to nie błąd
  };

  return (
    <button className={`btn ghost sm cast-btn${state === 'connected' ? ' on' : ''}`} onClick={open} aria-label="Oglądaj na telewizorze">
      <Icon name="tv" size={18} />
      {state === 'connected' ? 'Na telewizorze' : state === 'connecting' ? 'Łączę…' : 'Na TV'}
    </button>
  );
}
