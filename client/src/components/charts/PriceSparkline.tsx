import { useState, useEffect } from 'react';

interface DataPoint { time: number; price: number; }

interface Props {
  currentPrice: number;
  width?: number;
  height?: number;
  color?: string;
}

export function PriceSparkline({ currentPrice, width = 200, height = 60, color = 'var(--green-bright)' }: Props) {
  const [history, setHistory] = useState<DataPoint[]>([]);

  // Accumulate price history in-session (no persistence needed)
  useEffect(() => {
    if (currentPrice <= 0) return;
    setHistory(h => {
      const next = [...h, { time: Date.now(), price: currentPrice }].slice(-30);
      return next;
    });
  }, [currentPrice]);

  if (history.length < 2) {
    return (
      <div style={{ width, height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Collecting data…</span>
      </div>
    );
  }

  const prices  = history.map(p => p.price);
  const min     = Math.min(...prices) * 0.998;
  const max     = Math.max(...prices) * 1.002;
  const range   = max - min || 1;
  const pad     = 4;
  const w       = width  - pad * 2;
  const h       = height - pad * 2;

  const points  = history.map((p, i) => ({
    x: pad + (i / (history.length - 1)) * w,
    y: pad + h - ((p.price - min) / range) * h,
  }));

  const linePath  = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const areaPath  = `${linePath} L ${points[points.length-1].x} ${pad + h} L ${points[0].x} ${pad + h} Z`;

  const isUp = prices[prices.length - 1] >= prices[0];
  const lineColor = isUp ? color : 'var(--red)';

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={lineColor} stopOpacity="0.2" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0"   />
        </linearGradient>
      </defs>
      {/* Area fill */}
      <path d={areaPath} fill="url(#sparkGrad)" />
      {/* Line */}
      <path d={linePath} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Latest dot */}
      <circle
        cx={points[points.length-1].x}
        cy={points[points.length-1].y}
        r="3" fill={lineColor}
        style={{ filter: `drop-shadow(0 0 4px ${lineColor})` }}
      />
    </svg>
  );
}