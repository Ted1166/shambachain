interface RiskMarketData {
  marketId: number;
  tokenId: number;
  loanId: number;
  deadline: Date;
  status: number;
  yesPool: number;
  noPool: number;
  totalPool: number;
  yesProbPct: number;
}

interface ForwardBidData {
  bidId: number;
  tokenId: number;
  commodityType: string;
  offerUsdcH: number;
  settlementDate: Date;
  buyerRef: string;
  status: number;
}

const RISK_STATUS   = ['Open', 'Resolved', 'Cancelled', 'Expired'];
const FORWARD_STATUS = ['Open', 'Accepted', 'Settled', 'Cancelled'];

export function RiskMarketCard({ market, onClick }: { market: RiskMarketData; onClick?: () => void }) {
  const yesPct   = market.yesProbPct || 0;
  const noPct    = 100 - yesPct;
  const daysLeft = Math.max(0, Math.floor((market.deadline.getTime() - Date.now()) / 86_400_000));

  return (
    <div className="market-card card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="market-card-header">
        <div>
          <span className="stat-label">Risk Market #{market.marketId}</span>
          <div className="market-question">
            Will Loan #{market.loanId} be liquidated?
          </div>
        </div>
        <span className={`badge ${market.status === 0 ? 'badge-green' : 'badge-muted'}`}>
          {RISK_STATUS[market.status]}
        </span>
      </div>

      {/* Odds bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--green-bright)' }}>YES {yesPct.toFixed(0)}%</span>
          <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--red)' }}>NO {noPct.toFixed(0)}%</span>
        </div>
        <div className="odds-bar">
          <div className="odds-bar-yes" style={{ width: `${yesPct}%` }} />
          <div className="odds-bar-no"  style={{ width: `${noPct}%` }} />
        </div>
      </div>

      <div className="market-card-stats">
        <div className="market-card-stat">
          <span className="stat-label">Total Pool</span>
          <span className="market-stat-val">${market.totalPool.toFixed(2)}</span>
        </div>
        <div className="market-card-stat">
          <span className="stat-label">Deadline</span>
          <span className="market-stat-val">{daysLeft}d left</span>
        </div>
        <div className="market-card-stat">
          <span className="stat-label">oCR Token</span>
          <span className="market-stat-val">#{market.tokenId}</span>
        </div>
      </div>
    </div>
  );
}

export function ForwardBidCard({ bid, onClick }: { bid: ForwardBidData; onClick?: () => void }) {
    if (!bid) return null;
    const daysLeft = Math.max(0, Math.floor((bid.settlementDate.getTime() - Date.now()) / 86_400_000));

  return (
    <div className="market-card card" onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className="market-card-header">
        <div>
          <span className="stat-label">Forward Bid #{bid.bidId}</span>
          <div className="market-question">{bid.commodityType} · oCR #{bid.tokenId}</div>
        </div>
        <span className={`badge ${bid.status === 0 ? 'badge-green' : bid.status === 1 ? 'badge-amber' : 'badge-muted'}`}>
          {FORWARD_STATUS[bid.status]}
        </span>
      </div>

      <div className="forward-offer-row">
        <span className="forward-offer-price">${bid.offerUsdcH.toFixed(2)}</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>USDC-H</span>
      </div>

      <div className="market-card-stats">
        <div className="market-card-stat">
          <span className="stat-label">Settlement</span>
          <span className="market-stat-val">{bid.settlementDate.toLocaleDateString()}</span>
        </div>
        <div className="market-card-stat">
          <span className="stat-label">Days Left</span>
          <span className="market-stat-val">{daysLeft}d</span>
        </div>
        <div className="market-card-stat">
          <span className="stat-label">Buyer Ref</span>
          <span className="market-stat-val">{bid.buyerRef}</span>
        </div>
      </div>
    </div>
  );
}