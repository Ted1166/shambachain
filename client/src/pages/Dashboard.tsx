import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { usePrice } from '../hooks/usePrice';
import { useReceipts } from '../hooks/useReceipts';
import { CONTRACTS, COLLATERAL_VAULT_ABI, SHAMBA_TOKEN_ABI, getProvider } from '../config/contracts';
import '../styles/dashboard.css';
import { LtvGauge } from '../components/charts/LtvGauge';
import { PriceSparkline } from '../components/charts/PriceSparkline';

interface ProtocolStats {
  totalReceipts: number;
  activeLoans: number;
  totalValueKes: number;
  totalBorrowed: number;
  shambaSupply: number;
  loading: boolean;
}

export function Dashboard() {
  const { priceKes, timestamp, isStale, loading: priceLoading } = usePrice();
  const { receipts, loading: receiptsLoading } = useReceipts();
  const [stats, setStats] = useState<ProtocolStats>({
    totalReceipts: 0, activeLoans: 0, totalValueKes: 0,
    totalBorrowed: 0, shambaSupply: 0, loading: true,
  });
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useEffect(() => {
    async function fetchStats() {
      try {
        const provider = getProvider();
        const vault = new ethers.Contract(CONTRACTS.collateralVault, COLLATERAL_VAULT_ABI, provider);
        const shamba = new ethers.Contract(CONTRACTS.shambaToken, SHAMBA_TOKEN_ABI, provider);

        // Get loan #1 as sample
        const loan1 = await vault.getLoan(1).catch(() => null);
        const activeLoans = loan1 && Number(loan1.status) === 1 ? 1 : 0;
        const totalBorrowed = loan1 ? Number(loan1.principal) / 1e6 : 0;

        const shambaBalance = await shamba.balanceOf(CONTRACTS.shambaToken).catch(() => 0n);

        setStats({
          totalReceipts: receipts.length,
          activeLoans,
          totalValueKes: receipts.reduce((s, r) => s + r.valuationKes, 0),
          totalBorrowed,
          shambaSupply:  Number(shambaBalance) / 1e18,
          loading: false,
        });
      } catch {
        setStats(s => ({ ...s, loading: false }));
      }
    }

    if (!receiptsLoading) fetchStats();
  }, [receipts, receiptsLoading]);

  // Recent receipts as activity feed
  useEffect(() => {
    setRecentActivity(
      receipts.slice(-5).reverse().map(r => ({
        type: 'MINT',
        label: `oCR #${r.tokenId} minted`,
        sub: `${r.weightKg}kg ${r.commodityType} · ${r.warehouseId}`,
        value: `KES ${r.valuationKes.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`,
        time: r.issuedAt,
        status: 'green',
      }))
    );
  }, [receipts]);

  const ltvPct = 55; // live loan LTV

  return (
    <div className="dashboard animate-in">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Protocol Overview</h1>
        <p className="page-subtitle">
          Real-time ShambaChain metrics · Hedera Testnet · HCS Topic {' '}
          <a href="https://hashscan.io/testnet/topic/0.0.8157255" target="_blank" rel="noreferrer">
            0.0.8157255 ↗
          </a>
        </p>
      </div>

      {/* Stat grid */}
      <div className="grid-4 animate-in-2">
        <StatCard
          label="Maize Price"
          value={priceLoading ? '...' : `KES ${priceKes.toFixed(2)}`}
          sub={isStale ? '⚠ stale' : `↑ Updated ${timestamp.toLocaleTimeString()}`}
          accent="green"
          live={!isStale}
          chart={<PriceSparkline currentPrice={priceKes} width={180} height={50} />}
        />
        <StatCard
          label="oCR NFTs Minted"
          value={receiptsLoading ? '...' : String(receipts.length)}
          sub="Commodity receipts on-chain"
          accent="white"
        />
        <StatCard
          label="Total Collateral"
          value={stats.loading ? '...' : `KES ${(stats.totalValueKes / 1000).toFixed(1)}K`}
          sub="Grain stored across warehouses"
          accent="white"
        />
        <StatCard
          label="USDC-H Borrowed"
          value={stats.loading ? '...' : `$${stats.totalBorrowed.toFixed(2)}`}
          sub={`${stats.activeLoans} active loan${stats.activeLoans !== 1 ? 's' : ''}`}
          accent="amber"
        />
      </div>

      {/* Main grid */}
      <div className="dashboard-main animate-in-3">
        {/* Price chart placeholder + LTV */}
        <div className="card dashboard-health">
          <div className="card-header-row">
            <h2 className="card-title">Active Loan Health</h2>
            <span className="badge badge-green">Loan #1</span>
          </div>
          <div className="loan-health-body">
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <LtvGauge ltvBps={ltvPct * 100} size={160} />
            </div>
            <div className="loan-detail-row">
              <div className="loan-detail">
                <span className="stat-label">Principal</span>
                <span className="stat-value white" style={{fontSize:'1rem'}}>$30.09 USDC-H</span>
              </div>
              <div className="loan-detail">
                <span className="stat-label">Collateral</span>
                <span className="stat-value white" style={{fontSize:'1rem'}}>KES 7,111</span>
              </div>
              <div className="loan-detail">
                <span className="stat-label">oCR Token</span>
                <span className="stat-value white" style={{fontSize:'1rem'}}>#4</span>
              </div>
            </div>
          </div>
        </div>

        {/* Activity feed */}
        <div className="card dashboard-activity">
          <div className="card-header-row">
            <h2 className="card-title">Recent Activity</h2>
            <span className="badge badge-muted">{recentActivity.length} events</span>
          </div>
          <div className="activity-feed">
            {recentActivity.length === 0 ? (
              <div className="empty-state">No recent activity</div>
            ) : (
              recentActivity.map((a, i) => (
                <div key={i} className="activity-item">
                  <div className={`activity-dot ${a.status}`} />
                  <div className="activity-body">
                    <div className="activity-label">{a.label}</div>
                    <div className="activity-sub">{a.sub}</div>
                  </div>
                  <div className="activity-right">
                    <div className="activity-value">{a.value}</div>
                    <div className="activity-time">{a.time.toLocaleDateString()}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Contract addresses */}
      <div className="card animate-in-4">
        <div className="card-header-row">
          <h2 className="card-title">Deployed Contracts</h2>
          <span className="badge badge-green">
            <span className="pulse-dot" /> Live
          </span>
        </div>
        <div className="contracts-grid">
          {[
            ['ReceiptFactory', CONTRACTS.receiptFactory],
            ['CollateralVault', CONTRACTS.collateralVault],
            ['ForwardMarket', CONTRACTS.forwardMarket],
            ['RiskMarket', CONTRACTS.riskMarket],
            ['SupraPriceFeed', CONTRACTS.supraPriceFeed],
            ['ShambaToken', CONTRACTS.shambaToken],
          ].map(([name, addr]) => (
            <div key={name} className="contract-row">
              <span className="contract-name">{name}</span>
              <a
                href={`https://hashscan.io/testnet/contract/${addr}`}
                target="_blank"
                rel="noreferrer"
                className="contract-addr"
              >
                {addr.slice(0, 8)}…{addr.slice(-6)} ↗
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent, live, chart }: {
  label: string; value: string; sub: string; accent: string; live?: boolean; chart?: React.ReactNode;
}) {
  return (
    <div className={`card stat-card ${live ? 'card-glow' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${accent}`}>{value}</div>
      <div className="stat-sub">{sub}</div>
      {live && <div className="live-indicator"><span className="pulse-dot" /> Live</div>}
      {chart}   {/* ← add this */}
    </div>
  );
}

// function LtvBar({ ltvPct }: { ltvPct: number }) {
//   const cls = ltvPct >= 80 ? 'danger' : ltvPct >= 70 ? 'warn' : 'safe';
//   return (
//     <div className="ltv-bar" style={{height:'12px', marginBottom:'var(--space-2)'}}>
//       <div className={`ltv-bar-fill ${cls}`} style={{width:`${Math.min(ltvPct,100)}%`}} />
//       {/* Threshold markers */}
//       <div className="ltv-marker" style={{left:'70%'}} />
//       <div className="ltv-marker danger" style={{left:'80%'}} />
//     </div>
//   );
// }