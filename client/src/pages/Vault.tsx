import { useReceipts } from '../hooks/useReceipts';
import { useLoan, LOAN_STATUS, LOAN_STATUS_CLASS } from '../hooks/useLoans';
import '../styles/vault.css';
import { LoanCard } from '../components/cards/LoanCard';
import { LtvGauge } from '../components/charts/LtvGauge';
import { useVaultActions } from '../hooks/useVaultActions';
import { TxModal } from '../components/ui/TxModal';
import { RequireWallet } from '../components/ui/RequireWallet';

export function Vault() {
  const { lockAndBorrow, repayLoan, status, txHash, error, reset } = useVaultActions();
  const { receipts } = useReceipts();
  const { loan, loading } = useLoan(1); // loan #1 seeded

  const lockedReceipt = receipts.find(r => r.tokenId === loan?.tokenId);

  return (
    <RequireWallet message="Connect your wallet to lock collateral and borrow USDC-H.">
    <div className="vault-page animate-in">
      <div className="page-header">
        <h1 className="page-title">Collateral Vault</h1>
        <p className="page-subtitle">Lock oCR NFTs as collateral · Borrow USDC-H at up to 80% LTV</p>
      </div>

      <div className="vault-layout animate-in-2">
        {/* Left: Active loan */}
        <div className="vault-main">
          <div className="card">
            <div className="card-header-row">
              <h2 className="card-title">Active Loan</h2>
              {loan && <span className={`badge ${LOAN_STATUS_CLASS[loan.status]}`}>{LOAN_STATUS[loan.status]}</span>}
            </div>

            {loading ? (
              <div className="skeleton" style={{height: 200}} />
            ) : loan ? (
              <>
              <LoanCard loan={loan} />
              <div className="divider" />
              <div className="loan-detail-panel">
                {/* LTV gauge */}
                <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-4) 0' }}>
                  <LtvGauge ltvBps={loan.currentLtvBps} size={180} />
                </div>

                {/* Stats grid */}
                <div className="loan-stats-grid">
                  <LoanStat label="Principal"      value={`$${loan.principal.toFixed(2)}`}       unit="USDC-H" green />
                  <LoanStat label="Interest"       value={`$${loan.interestAccrued.toFixed(4)}`}  unit="USDC-H" />
                  <LoanStat label="Total Owed"     value={`$${loan.totalOwed.toFixed(2)}`}        unit="USDC-H" />
                  <LoanStat label="Collateral"     value={`KES ${loan.collateralKes.toLocaleString('en-KE',{maximumFractionDigits:0})}`} unit="" />
                  <LoanStat label="Opened"         value={loan.openedAt.toLocaleDateString()}    unit="" />
                  <LoanStat label="Due"            value={loan.dueAt.toLocaleDateString()}        unit="" />
                </div>

                {/* Collateral token */}
                {lockedReceipt && (
                  <div className="collateral-token">
                    <div className="collateral-token-header">
                      <span className="stat-label">Collateral Token</span>
                      <span className="badge badge-amber">Locked</span>
                    </div>
                    <div className="collateral-token-body">
                      <span className="collateral-id">oCR #{lockedReceipt.tokenId}</span>
                      <span className="collateral-details">
                        {lockedReceipt.weightKg}kg {lockedReceipt.commodityType} · {lockedReceipt.warehouseId}
                      </span>
                    </div>
                  </div>
                )}

                {/* Actions */}
                {loan.status === 1 && (
                  <div className="vault-actions">
                    <button className="btn btn-primary" onClick={() => loan && repayLoan(loan.loanId, loan.totalOwed)}>
                      Repay Loan
                    </button>

                    <a
                      href={`https://hashscan.io/testnet/contract/${loan.loanId}`}
                      target="_blank" rel="noreferrer"
                      className="btn btn-ghost"
                    >
                      HashScan ↗
                    </a>
                  </div>
                )}
              </div>
              </>
            ) : (
              <div className="empty-state">No active loans</div>
            )}
          </div>
        </div>

        {/* Right: Available receipts to lock */}
        <div className="vault-sidebar">
          <div className="card">
            <div className="card-header-row">
              <h2 className="card-title">Available to Lock</h2>
              <span className="badge badge-muted">
                {receipts.filter(r => r.status === 0).length} receipts
              </span>
            </div>
            <div className="available-list">
              {receipts.filter(r => r.status === 0).map(r => (
                <div key={r.tokenId} className="available-item">
                  <div className="available-item-left">
                    <span className="available-id">oCR #{r.tokenId}</span>
                    <span className="available-details">
                      {r.weightKg}kg {r.commodityType} · Grade {['A','B','C'][r.grade]}
                    </span>
                  </div>
                  <div className="available-item-right">
                    <span className="available-value">
                      KES {r.valuationKes.toLocaleString('en-KE', {maximumFractionDigits: 0})}
                    </span>
                    <button
                      className="btn btn-outline"
                      style={{fontSize:'0.65rem', padding:'4px 10px'}}
                      onClick={() => lockAndBorrow(r.tokenId)}
                    >
                      Lock →
                    </button>
                  </div>
                </div>
              ))}

              {receipts.filter(r => r.status === 0).length === 0 && (
                <div className="empty-state">No unlocked receipts available</div>
              )}
            </div>
          </div>

          {/* How it works */}
          <div className="card how-it-works">
            <h2 className="card-title" style={{marginBottom:'var(--space-4)'}}>How It Works</h2>
            {[
              ['01', 'Deposit grain at a registered warehouse and pay via MPESA'],
              ['02', 'Warehouse custodian mints an oCR NFT on Hedera EVM'],
              ['03', 'Lock your oCR as collateral in the vault'],
              ['04', 'Borrow up to 80% LTV in USDC-H, repay to unlock'],
            ].map(([n, t]) => (
              <div key={n} className="how-step">
                <span className="how-step-num">{n}</span>
                <span className="how-step-text">{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    <TxModal
      status={status}
      txHash={txHash}
      error={error}
      title="Vault Transaction"
      steps={['Approve NFT', 'Lock Collateral', 'Issue Loan']}
      onClose={reset}
    />
    </RequireWallet>
  );
}

function LoanStat({ label, value, unit, green }: {
  label: string; value: string; unit: string; green?: boolean;
}) {
  return (
    <div className="loan-stat">
      <span className="stat-label">{label}</span>
      <span className="loan-stat-value" style={{ color: green ? 'var(--green-bright)' : 'var(--text-primary)' }}>
        {value} <span style={{color:'var(--text-muted)', fontSize:'0.7rem'}}>{unit}</span>
      </span>
    </div>
  );
}