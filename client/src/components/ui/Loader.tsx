interface SkeletonProps {
  height?: number | string;
  width?: number | string;
  rounded?: boolean;
}

export function Skeleton({ height = 48, width = '100%', rounded = false }: SkeletonProps) {
  return (
    <div
      className="skeleton"
      style={{
        height,
        width,
        borderRadius: rounded ? '50%' : undefined,
      }}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <Skeleton height={16} width="40%" />
      <Skeleton height={32} width="60%" />
      <Skeleton height={12} width="80%" />
      <Skeleton height={12} width="55%" />
    </div>
  );
}

export function Loader({ size = 24, label }: { size?: number; label?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
      <svg
        width={size} height={size}
        viewBox="0 0 24 24"
        style={{ animation: 'spin 0.8s linear infinite' }}
      >
        <circle cx="12" cy="12" r="10" fill="none" stroke="var(--green-mute)" strokeWidth="2" />
        <path
          d="M12 2 A10 10 0 0 1 22 12"
          fill="none"
          stroke="var(--green-bright)"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
      {label && <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{label}</span>}
    </div>
  );
}