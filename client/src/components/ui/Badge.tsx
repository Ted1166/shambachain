import type { ReactNode } from 'react';

type Color = 'green' | 'amber' | 'red' | 'muted' | 'blue';

interface Props {
  color?: Color;
  pulse?: boolean;
  children: ReactNode;
}

const COLOR_CLASS: Record<Color, string> = {
  green: 'badge-green',
  amber: 'badge-amber',
  red:   'badge-red',
  muted: 'badge-muted',
  blue:  'badge-blue',
};

export function Badge({ color = 'muted', pulse, children }: Props) {
  return (
    <span className={`badge ${COLOR_CLASS[color]}`}>
      {pulse && <span className="pulse-dot" />}
      {children}
    </span>
  );
}