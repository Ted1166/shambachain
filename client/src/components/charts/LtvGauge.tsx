interface Props {
  ltvBps: number;        // e.g. 5500 = 55%
  size?: number;
  showLabel?: boolean;
}

export function LtvGauge({ ltvBps, size = 120, showLabel = true }: Props) {
  const pct     = Math.min(ltvBps / 100, 100);
  const color   = pct >= 80 ? 'var(--red)' : pct >= 70 ? 'var(--amber)' : 'var(--green-bright)';
  const label   = pct >= 80 ? 'DANGER' : pct >= 70 ? 'WARNING' : 'HEALTHY';

  // SVG arc math
  const r       = 40;
  const cx      = 60;
  const cy      = 60;
  const startAngle = -210;
  const sweepAngle = 240;
  const arcAngle   = (pct / 100) * sweepAngle + startAngle;

  function polarToXY(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  const start  = polarToXY(startAngle, r);
  const end    = polarToXY(startAngle + sweepAngle, r);
  const fill   = polarToXY(arcAngle, r);
  const large  = sweepAngle > 180 ? 1 : 0;
  const fillLg = (pct / 100) * sweepAngle > 180 ? 1 : 0;

  const trackPath = `M ${start.x} ${start.y} A ${r} ${r} 0 ${large} 1 ${end.x} ${end.y}`;
  const fillPath  = pct > 0
    ? `M ${start.x} ${start.y} A ${r} ${r} 0 ${fillLg} 1 ${fill.x} ${fill.y}`
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
      <svg width={size} height={size * 0.8} viewBox="0 0 120 96">
        {/* Track */}
        <path d={trackPath} fill="none" stroke="var(--bg-elevated)" strokeWidth="8" strokeLinecap="round" />
        {/* Fill */}
        {fillPath && (
          <path d={fillPath} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 4px ${color})`, transition: 'all 0.6s cubic-bezier(0.16,1,0.3,1)' }}
          />
        )}
        {/* Center text */}
        <text x="60" y="58" textAnchor="middle" fill={color}
          style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 18 }}>
          {pct.toFixed(1)}%
        </text>
        <text x="60" y="74" textAnchor="middle" fill="var(--text-muted)"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
          LTV
        </text>
        {/* Threshold ticks */}
        {[70, 80].map(thresh => {
          const tickAngle = ((thresh / 100) * sweepAngle) + startAngle;
          const inner = polarToXY(tickAngle, r - 6);
          const outer = polarToXY(tickAngle, r + 6);
          return (
            <line key={thresh}
              x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
              stroke={thresh === 80 ? 'var(--red)' : 'var(--amber)'}
              strokeWidth="2" opacity="0.6"
            />
          );
        })}
      </svg>
      {showLabel && (
        <span style={{ fontSize: '0.6rem', fontWeight: 700, color, letterSpacing: '0.1em' }}>
          {label}
        </span>
      )}
    </div>
  );
}