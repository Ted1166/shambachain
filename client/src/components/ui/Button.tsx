import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
type Size    = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  disabled,
  className = '',
  ...rest
}: Props) {
//   const sizeStyle: Record<Size, string> = {
//     sm: 'padding: 4px 10px; font-size: 0.65rem;',
//     md: '',
//     lg: 'padding: var(--space-4) var(--space-6); font-size: 0.8rem;',
//   };

  return (
    <button
      className={`btn btn-${variant} ${className}`}
      style={{ ...(size !== 'md' ? { padding: undefined } : {}) }}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 12, height: 12,
      border: '2px solid currentColor',
      borderTopColor: 'transparent',
      borderRadius: '50%',
      animation: 'spin 0.6s linear infinite',
    }} />
  );
}