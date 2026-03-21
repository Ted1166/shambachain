import { useState } from 'react';
import { useWalletContext } from '../WalletContext';
import { useMarketActions } from '../../hooks/useMarketActions';
import { TxModal } from './TxModal';
import '../../styles/market-forms.css';

interface CreateRiskMarketProps {
  onClose: () => void;
  onCreated: (marketId: bigint) => void;
}

export function CreateRiskMarketModal({ onClose, onCreated }: CreateRiskMarketProps) {
  const { isConnected } = useWalletContext();
  const { createRiskMarket, status, txHash, error, reset } = useMarketActions();
  const [tokenId, setTokenId]   = useState('4');
  const [loanId, setLoanId]     = useState('1');
  const [duration, setDuration] = useState('7');

  async function handleSubmit() {
    if (!isConnected) return;
    const tid = parseInt(tokenId) || 0;
    const lid = parseInt(loanId) || 0;
    const dur = parseInt(duration) || 10;
    if (tid === 0 || lid === 0 || dur === 0) {
        alert('Please fill in all fields');
        return;
    }
    const marketId = await createRiskMarket(tid, lid, dur);
    if (marketId !== null) onCreated(marketId);
    }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title-row">
              <span className="modal-icon">◎</span>
              <div>
                <h2 className="modal-title">Create Risk Market</h2>
                <p className="modal-sub">Prediction pool on loan liquidation</p>
              </div>
            </div>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>

          <div className="modal-body">
            <div className="form-field">
              <label className="form-label">oCR Token ID</label>
              <input
                className="input"
                type="number"
                value={tokenId}
                onChange={e => setTokenId(e.target.value)}
                placeholder="e.g. 4"
                min="1"
              />
              <span className="form-hint">The oCR NFT backing the loan</span>
            </div>

            <div className="form-field">
              <label className="form-label">Loan ID</label>
              <input
                className="input"
                type="number"
                value={loanId}
                onChange={e => setLoanId(e.target.value)}
                placeholder="e.g. 1"
                min="1"
              />
              <span className="form-hint">The active loan ID to monitor</span>
            </div>

            <div className="form-field">
              <label className="form-label">Duration (days)</label>
              <div className="duration-options">
                {[3, 7, 14, 30].map(d => (
                  <button
                    key={d}
                    className={`duration-btn ${duration === String(d) ? 'active' : ''}`}
                    onClick={() => setDuration(String(d))}
                  >
                    {d}d
                  </button>
                ))}
              </div>
              <span className="form-hint">Market resolves automatically after this period</span>
            </div>

            <div className="info-box">
              <div className="info-box-title">How it works</div>
              <div className="info-box-text">
                YES = loan will be liquidated before deadline<br />
                NO = loan will be repaid safely<br />
                Winners share the losing pool proportionally
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!isConnected || status !== 'idle'}
              >
                Create Market →
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <TxModal
        status={status}
        txHash={txHash}
        error={error}
        title="Creating Risk Market"
        steps={['Confirm transaction']}
        onClose={() => { reset(); if (status === 'success') onClose(); }}
      />
    </>
  );
}

// ── Place Forward Bid Modal ────────────────────────────────────────────────────
interface PlaceForwardBidProps {
  onClose: () => void;
  onPlaced: (bidId: bigint) => void;
}

export function PlaceForwardBidModal({ onClose, onPlaced }: PlaceForwardBidProps) {
  const { isConnected } = useWalletContext();
  const { placeForwardBid, status, txHash, error, reset } = useMarketActions();
  const [tokenId, setTokenId]     = useState('');
  const [offerUsdc, setOfferUsdc] = useState('');
  const [buyerRef, setBuyerRef]   = useState('');
  const [days, setDays]           = useState('30');

  const settlementDate = new Date(Date.now() + parseInt(days || '30') * 86_400_000);

  async function handleSubmit() {
    if (!isConnected || !tokenId || !offerUsdc || !buyerRef) return;
    const bidId = await placeForwardBid(
      parseInt(tokenId),
      parseFloat(offerUsdc),
      settlementDate,
      buyerRef
    );
    if (bidId !== null) onPlaced(bidId);
  }

  return (
    <>
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
          <div className="modal-header">
            <div className="modal-title-row">
              <span className="modal-icon">🏷</span>
              <div>
                <h2 className="modal-title">Place Forward Bid</h2>
                <p className="modal-sub">Bid to purchase a commodity receipt</p>
              </div>
            </div>
            <button className="modal-close" onClick={onClose}>✕</button>
          </div>

          <div className="modal-body">
            <div className="form-field">
              <label className="form-label">oCR Token ID</label>
              <input
                className="input"
                type="number"
                value={tokenId}
                onChange={e => setTokenId(e.target.value)}
                placeholder="e.g. 5"
                min="1"
              />
              <span className="form-hint">Leave 0 for any matching commodity</span>
            </div>

            <div className="form-field">
              <label className="form-label">Offer Amount (USDC-H)</label>
              <div style={{ position: 'relative' }}>
                <span className="input-prefix">$</span>
                <input
                  className="input"
                  type="number"
                  value={offerUsdc}
                  onChange={e => setOfferUsdc(e.target.value)}
                  placeholder="e.g. 150.00"
                  min="0"
                  step="0.01"
                  style={{ paddingLeft: 'var(--space-8)' }}
                />
              </div>
              <span className="form-hint">Total offer in USDC-H (6 decimals)</span>
            </div>

            <div className="form-field">
              <label className="form-label">Buyer Reference</label>
              <input
                className="input"
                type="text"
                value={buyerRef}
                onChange={e => setBuyerRef(e.target.value)}
                placeholder="e.g. UNGA-MILLS-002"
              />
              <span className="form-hint">Your company or purchase reference ID</span>
            </div>

            <div className="form-field">
              <label className="form-label">Settlement in (days)</label>
              <div className="duration-options">
                {[7, 14, 30, 60, 90].map(d => (
                  <button
                    key={d}
                    className={`duration-btn ${days === String(d) ? 'active' : ''}`}
                    onClick={() => setDays(String(d))}
                  >
                    {d}d
                  </button>
                ))}
              </div>
              <span className="form-hint">
                Settlement: {settlementDate.toLocaleDateString()}
              </span>
            </div>

            <div className="info-box">
              <div className="info-box-title">How it works</div>
              <div className="info-box-text">
                USDC-H is approved and escrowed when bid is accepted.<br />
                On settlement date, oCR transfers to you and USDC-H releases to the farmer.<br />
                All enforced on-chain — no counterparty risk.
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={!isConnected || !tokenId || !offerUsdc || !buyerRef || status !== 'idle'}
              >
                Place Bid →
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </div>
        </div>
      </div>

      <TxModal
        status={status}
        txHash={txHash}
        error={error}
        title="Placing Forward Bid"
        steps={['Approve USDC-H', 'Submit bid']}
        onClose={() => { reset(); if (status === 'success') onClose(); }}
      />
    </>
  );
}

// ── Claim Payout Modal ─────────────────────────────────────────────────────────
interface ClaimPayoutProps {
  marketId: number;
  positionId: number;
  onClose: () => void;
}

export function ClaimPayoutModal({ marketId, positionId, onClose }: ClaimPayoutProps) {
  const { signer } = useWalletContext();
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  async function handleClaim() {
    if (!signer) return;
    setLoading(true);
    try {
      const { ethers } = await import('ethers');
      const { CONTRACTS, RISK_MARKET_ABI } = await import('../../config/contracts');
      const market = new ethers.Contract(CONTRACTS.riskMarket, RISK_MARKET_ABI, signer);
      const tx = await market.claimPayout(marketId, positionId, { gasLimit: 300_000 });
      await tx.wait();
      setTxHash(tx.hash);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Claim failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-row">
            <span className="modal-icon">💰</span>
            <div>
              <h2 className="modal-title">Claim Payout</h2>
              <p className="modal-sub">Market #{marketId} · Position #{positionId}</p>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {txHash ? (
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <div style={{ fontSize: '2rem' }}>✓</div>
              <p style={{ color: 'var(--green-bright)', fontWeight: 700 }}>Payout claimed!</p>
              <a href={`https://hashscan.io/testnet/transaction/${txHash}`}
                target="_blank" rel="noreferrer" className="tx-hash-link">
                View on HashScan ↗
              </a>
              <button className="btn btn-primary" onClick={onClose}>Done</button>
            </div>
          ) : (
            <>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                The market has resolved. Your winning position is ready to claim. USDC-H will be transferred to your wallet.
              </p>
              {error && <p style={{ color: 'var(--red)', fontSize: '0.75rem' }}>{error}</p>}
              <div className="modal-actions">
                <button className="btn btn-primary" onClick={handleClaim} disabled={loading}>
                  {loading ? 'Claiming...' : 'Claim USDC-H →'}
                </button>
                <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}