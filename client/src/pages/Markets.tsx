import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { CONTRACTS, RISK_MARKET_ABI, FORWARD_MARKET_ABI, getProvider } from '../config/contracts';
import { RiskMarketCard, ForwardBidCard } from '../components/cards/MarketCard';
import { PoolDonut } from '../components/charts/PoolDonut';
import { useMarketActions } from '../hooks/useMarketActions';
import { TxModal } from '../components/ui/TxModal';
import '../styles/markets.css';

export function Markets() {
  const [tab, setTab] = useState<'forward' | 'risk'>('forward');
  const [riskMarket, setRiskMarket] = useState<any>(null);
  const [forwardBid, setForwardBid] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const { takePosition, status, txHash, error, reset } = useMarketActions();

  useEffect(() => {
    async function fetch() {
      setLoading(true);
      try {
        const provider = getProvider();
        const risk = new ethers.Contract(CONTRACTS.riskMarket, RISK_MARKET_ABI, provider);
        const fwd  = new ethers.Contract(CONTRACTS.forwardMarket, FORWARD_MARKET_ABI, provider);

        // Low-level calls — Hedera tuple decode workaround
        const riskIface = risk.interface;
        const fwdIface  = fwd.interface;

        const [rmRaw, rmFinRaw, fbRaw] = await Promise.all([
          provider.call({ to: CONTRACTS.riskMarket,    data: riskIface.encodeFunctionData('getMarketInfo', [1]) }),
          provider.call({ to: CONTRACTS.riskMarket,    data: riskIface.encodeFunctionData('getMarketFinancials', [1]) }),
          provider.call({ to: CONTRACTS.forwardMarket, data: fwdIface.encodeFunctionData('getBid', [1]) }),
        ]);

        const rm    = riskIface.decodeFunctionResult('getMarketInfo', rmRaw)[0];
        const rmFin = riskIface.decodeFunctionResult('getMarketFinancials', rmFinRaw)[0];
        const fb    = fwdIface.decodeFunctionResult('getBid', fbRaw)[0];

        // getMarketOdds reverts when pools are empty — default to 50/50
        let yesProbPct = 50;
        try {
          const oddsRaw = await provider.call({ to: CONTRACTS.riskMarket, data: riskIface.encodeFunctionData('getMarketOdds', [1]) });
          const odds = riskIface.decodeFunctionResult('getMarketOdds', oddsRaw);
          yesProbPct = Number(odds.impliedYesProbBps) / 100;
        } catch { /* empty pools — use 50/50 default */ }

        setRiskMarket({
          marketId:   Number(rm.marketId),
          tokenId:    Number(rm.tokenId),
          loanId:     Number(rm.loanId),
          deadline:   new Date(Number(rm.deadline) * 1000),
          status:     Number(rm.status),
          yesPool:    Number(rmFin.yesPool) / 1e6,
          noPool:     Number(rmFin.noPool) / 1e6,
          totalPool:  Number(rmFin.totalPool) / 1e6,
          yesProbPct,
        });

        setForwardBid({
          bidId:          Number(fb.bidId),
          buyer:          fb.buyer,
          tokenId:        Number(fb.tokenId),
          commodityType:  fb.commodityType,
          offerUsdcH:     Number(fb.offerUsdcH) / 1e6,
          settlementDate: new Date(Number(fb.settlementDate) * 1000),
          buyerRef:       fb.buyerRef,
          status:         Number(fb.status),
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetch();
  }, []);

  // const RISK_STATUS  = ['Open', 'Resolved', 'Cancelled', 'Expired'];
  // const FORWARD_STATUS = ['Open', 'Accepted', 'Settled', 'Cancelled'];

  return (
    <div className="markets-page animate-in">
      <div className="page-header">
        <h1 className="page-title">Markets</h1>
        <p className="page-subtitle">Forward contracts + on-chain risk prediction pools</p>
      </div>

      <div className="market-tabs animate-in-2">
        <button className={`filter-tab ${tab==='forward'?'active':''}`} onClick={()=>setTab('forward')}>
          Forward Market
        </button>
        <button className={`filter-tab ${tab==='risk'?'active':''}`} onClick={()=>setTab('risk')}>
          Risk Market
        </button>
      </div>

      {loading ? (
        <div className="skeleton" style={{height: 300, borderRadius: 12}} />
      ) : tab === 'forward' ? (
        <ForwardSection bid={forwardBid} />
      ) : (
        <RiskSection
         market={riskMarket}
         onTakePosition={(isYes) => takePosition(riskMarket.marketId, isYes, 1)} 
         />
      )}

      <TxModal
        status={status}
        txHash={txHash}
        error={error}
        title="Market Transaction"
        steps={['Approve USDC-H', 'Confirm Position']}
        onClose={reset}
      />
    </div>
  );
}

function ForwardSection({ bid }: { bid: any}) {
  if (!bid) return <div className="empty-state">No forward bids</div>;
  // const daysLeft = Math.max(0, Math.floor((bid.settlementDate - Date.now()) / 86_400_000));

  return (
    <div className="animate-in-3">
      <div className="markets-grid">
        <ForwardBidCard bid={bid} />
      </div>
    </div>
    
  );
}

function RiskSection({ market, onTakePosition}: { 
  market: any;
  onTakePosition: (isYes: boolean) => void;
}) {
  if (!market) return <div className="empty-state">No risk markets</div>;
  // const yesPct = market.yesProbPct || 0;
  // const noPct  = 100 - yesPct;
  // const daysLeft = Math.max(0, Math.floor((market.deadline - Date.now()) / 86_400_000));

  return (
    <div className="animate-in-3">
      <div className="markets-grid">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          <RiskMarketCard market={market} />
          <div className="card" style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-8)' }}>
            <PoolDonut yesPool={market.yesPool} noPool={market.noPool} size={160} />
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button className="btn btn-danger"  onClick={() => onTakePosition(true)}>Take YES</button>
              <button className="btn btn-primary" onClick={() => onTakePosition(false)}>Take NO</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
