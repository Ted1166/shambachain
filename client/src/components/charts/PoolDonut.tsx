interface Props {
  yesPool: number;
  noPool: number;
  size?: number;
}

export function PoolDonut({ yesPool, noPool, size = 100 }: Props) {
  const total  = yesPool + noPool;
  const yesPct = total > 0 ? (yesPool / total) * 100 : 50;
  const noPct  = 100 - yesPct;

  // SVG donut math
  const cx = size / 2, cy = size / 2;
  const r  = size * 0.35;
  const stroke = size * 0.12;

  function describeArc(startPct: number, endPct: number): string {
    const toRad  = (p: number) => ((p / 100) * 360 - 90) * (Math.PI / 180);
    const x1 = cx + r * Math.cos(toRad(startPct));
    const y1 = cy + r * Math.sin(toRad(startPct));
    const x2 = cx + r * Math.cos(toRad(endPct));
    const y2 = cy + r * Math.sin(toRad(endPct));
    const lg = endPct - startPct > 50 ? 1 : 0;
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${lg} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Track */}
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--bg-elevated)" strokeWidth={stroke} />
        {/* NO arc (red) — full circle base */}
        {noPct > 0 && (
          <path d={describeArc(0, Math.min(noPct, 99.9))}
            fill="none" stroke="var(--red)" strokeWidth={stroke} strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 3px var(--red))' }}
          />
        )}
        {/* YES arc (green) */}
        {yesPct > 0 && (
          <path d={describeArc(noPct, Math.min(noPct + yesPct, 99.9))}
            fill="none" stroke="var(--green-bright)" strokeWidth={stroke} strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 3px var(--green-bright))' }}
          />
        )}
        {/* Center label */}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="var(--green-bright)"
          style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: size * 0.14 }}>
          {yesPct.toFixed(0)}%
        </text>
        <text x={cx} y={cy + size * 0.11} textAnchor="middle" fill="var(--text-muted)"
          style={{ fontFamily: 'var(--font-mono)', fontSize: size * 0.08 }}>
          YES
        </text>
      </svg>
      <div style={{ display: 'flex', gap: 'var(--space-4)', fontSize: '0.65rem' }}>
        <span style={{ color: 'var(--green-bright)' }}>● YES ${yesPool.toFixed(2)}</span>
        <span style={{ color: 'var(--red)' }}>● NO ${noPool.toFixed(2)}</span>
      </div>
    </div>
  );
}