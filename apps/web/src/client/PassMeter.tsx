export type Meter = { value: string; unit: string; until: string };

/** Stan karnetu: nazwa, duża cyfra pozostałych wejść i data. Bez liczby (zawieszony, kilka pul) – zdanie z API. */
export function PassMeter({ name, summary, meter }: { name?: string; summary: string; meter?: Meter | null }) {
  if (!meter) return <div className="card-title">{summary}</div>;
  return (
    <div className="pass-meter">
      {name && <div className="pass-meter-name">{name}</div>}
      <div className="pass-meter-row">
        <span className="pass-meter-value">{meter.value}</span>
        <span className="pass-meter-unit">{meter.unit}</span>
        <span className="pass-meter-until">{meter.until}</span>
      </div>
    </div>
  );
}
