import type { Loan } from '../../hooks/useLoans';
import { LOAN_STATUS, LOAN_STATUS_CLASS } from '../../hooks/useLoans';

interface Props {
  loan: Loan;
  onClick?: () => void;
}

export function LoanCard({ loan, onClick }: Props) {
  const ltvPct      = loan.currentLtvBps / 100;
  const ltvClass    = ltvPct >= 80 ? 'danger' : ltvPct >= 70 ? 'warn' : 'safe';
  const ltvColor    = ltvPct >= 80 ? 'var(--red)' : ltvPct >= 70 ? 'var(--amber)' : 'var(--green-bright)';
  const daysLeft    = Math.max(0, Math.floor((loan.dueAt.getTime() - Date.now()) / 86_400_000));
  const isOverdue   = loan.dueAt < new Date() && loan.status === 1;

  return (
    <div className="loan-card card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="loan-card-header">
        <div className="loan-card-id">
          <span className="lc-label">Loan</span>
          <span className="lc-number">#{loan.loanId}</span>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {isOverdue && <span className="badge badge-red">OVERDUE</span>}
          <span className={`badge ${LOAN_STATUS_CLASS[loan.status]}`}>{LOAN_STATUS[loan.status]}</span>
        </div>
      </div>

      {/* LTV bar */}
      <div className="loan-card-ltv">
        <div className="loan-ltv-row">
          <span className="stat-label">Loan to Value</span>
          <span className="loan-ltv-pct" style={{ color: ltvColor }}>{ltvPct.toFixed(1)}%</span>
        </div>
        <div className="ltv-bar">
          <div className={`ltv-bar-fill ${ltvClass}`} style={{ width: `${Math.min(ltvPct, 100)}%` }} />
        </div>
      </div>

      {/* Stats row */}
      <div className="loan-card-stats">
        <div className="loan-card-stat">
          <span className="stat-label">Principal</span>
          <span className="loan-card-stat-val green">${loan.principal.toFixed(2)}</span>
        </div>
        <div className="loan-card-stat">
          <span className="stat-label">Total Owed</span>
          <span className="loan-card-stat-val">${loan.totalOwed.toFixed(2)}</span>
        </div>
        <div className="loan-card-stat">
          <span className="stat-label">Collateral</span>
          <span className="loan-card-stat-val">
            KES {loan.collateralKes.toLocaleString('en-KE', { maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="loan-card-footer">
        <span className="loan-card-token">oCR #{loan.tokenId}</span>
        <span className="loan-card-due" style={{ color: isOverdue ? 'var(--red)' : 'var(--text-muted)' }}>
          {isOverdue ? `Overdue` : `${daysLeft}d left`} · Due {loan.dueAt.toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}