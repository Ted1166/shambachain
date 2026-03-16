import type { TxStatus } from '../../hooks/useVaultActions';
import '../../styles/tx-modal.css';

interface Props {
  status: TxStatus;
  txHash: string | null;
  error: string | null;
  title: string;
  steps: string[];
  onClose: () => void;
}

export function TxModal({ status, txHash, error, title, steps, onClose }: Props) {
  if (status === 'idle') return null;

  const stepIndex =
    status === 'approving'  ? 0 :
    status === 'confirming' ? 1 :
    steps.length - 1;

  return (
    <div className="modal-backdrop" onClick={status === 'success' || status === 'error' ? onClose : undefined}>
      <div className="modal tx-modal" onClick={e => e.stopPropagation()}>
        <div className="tx-modal-header">
          <h2 className="modal-title">{title}</h2>
        </div>

        <div className="tx-modal-body">
          {/* Steps */}
          <div className="tx-steps">
            {steps.map((step, i) => {
              const done    = status === 'success' || i < stepIndex;
              const active  = i === stepIndex && status !== 'success' && status !== 'error';
              const failed  = status === 'error' && i === stepIndex;
              return (
                <div key={step} className={`tx-step ${done ? 'done' : active ? 'active' : failed ? 'failed' : ''}`}>
                  <div className="tx-step-dot">
                    {done   ? '✓' :
                     failed ? '✕' :
                     active ? <span className="tx-spinner" /> : i + 1}
                  </div>
                  <span className="tx-step-label">{step}</span>
                </div>
              );
            })}
          </div>

          {/* Status message */}
          {status === 'approving' && (
            <p className="tx-status-msg">Waiting for wallet approval…</p>
          )}
          {status === 'confirming' && (
            <p className="tx-status-msg">Confirming on Hedera…</p>
          )}
          {status === 'success' && (
            <div className="tx-success">
              <div className="tx-success-icon">✓</div>
              <p className="tx-success-msg">Transaction confirmed!</p>
              {txHash && (
                <a
                  href={`https://hashscan.io/testnet/transaction/${txHash}`}
                  target="_blank" rel="noreferrer"
                  className="tx-hash-link"
                >
                  View on HashScan ↗
                </a>
              )}
              <button className="btn btn-primary" style={{marginTop:'var(--space-4)'}} onClick={onClose}>
                Done
              </button>
            </div>
          )}
          {status === 'error' && (
            <div className="tx-error">
              <div className="tx-error-icon">✕</div>
              <p className="tx-error-msg">{error ?? 'Transaction failed'}</p>
              <button className="btn btn-outline" style={{marginTop:'var(--space-4)'}} onClick={onClose}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}