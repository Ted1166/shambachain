import { useEffect, useState } from 'react';
import { ethers } from 'ethers';
import { useWalletContext } from '../components/WalletContext';
import { useReceipts, STATUS_LABEL, STATUS_CLASS, GRADE_LABEL } from '../hooks/useReceipts';
import { useFaucet } from '../hooks/useFaucet';
import { RequireWallet } from '../components/ui/RequireWallet';
import { TxModal } from '../components/ui/TxModal';
import { CONTRACTS, getProvider } from '../config/contracts';
import '../styles/profile.css';
import '../styles/require-wallet.css';
import '../styles/tx-modal.css';

const SHAMBA_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function qualifiesForDiscount(address) view returns (bool)',
  'function agentEmissions(address) view returns (uint256)',
];

export function Profile() {
  return (
    <RequireWallet message="Connect your wallet to view your ShambaChain profile, receipts, and loan history.">
      <ProfileContent />
    </RequireWallet>
  );
}

function ProfileContent() {
  const { address, shortAddress, disconnect } = useWalletContext();
  const { receipts, loading: receiptsLoading } = useReceipts();
  const { claimFaucet, fetchBalance, balance: usdcBalance, loading: faucetLoading } = useFaucet();
  const [shambaBalance, setShambaBalance] = useState<number>(0);
  const [qualifies, setQualifies] = useState(false);
  const [agentEmissions, setAgentEmissions] = useState<number>(0);
  const [faucetStatus, setFaucetStatus] = useState<'idle'|'confirming'|'success'|'error'>('idle');
  const [faucetHash, setFaucetHash] = useState<string|null>(null);
  const [faucetError, setFaucetError] = useState<string|null>(null);

  // Filter receipts owned by this wallet
  // Show all receipts — ownerOf changes on transfer but custodian/farmer are immutable
  // TODO: filter by ownerOf in production via mirror node
  const myReceipts = receipts;

  useEffect(() => {
    if (!address) return;
    fetchBalance();

    const provider = getProvider();
    const shamba = new ethers.Contract(CONTRACTS.shambaToken, SHAMBA_ABI, provider);

    Promise.all([
      shamba.balanceOf(address),
      shamba.qualifiesForDiscount(address),
      shamba.agentEmissions(address),
    ]).then(([bal, disc, emissions]) => {
      setShambaBalance(Number(bal) / 1e18);
      setQualifies(disc as boolean);
      setAgentEmissions(Number(emissions) / 1e18);
    }).catch(() => {});
  }, [address]);

  async function handleFaucet() {
    setFaucetStatus('confirming');
    setFaucetError(null);
    try {
      const hash = await claimFaucet();
      setFaucetHash(hash);
      setFaucetStatus('success');
    } catch (e: any) {
      setFaucetError(e.message);
      setFaucetStatus('error');
    }
  }

  return (
    <div className="profile-page animate-in">
      <div className="page-header">
        <h1 className="page-title">My Profile</h1>
        <p className="page-subtitle">Wallet overview · Balances · Transaction history</p>
      </div>

      {/* Wallet card */}
      <div className="grid-2 animate-in-2">
        <div className="card profile-wallet-card">
          <div className="profile-avatar">
            {address?.slice(2, 4).toUpperCase()}
          </div>
          <div className="profile-wallet-info">
            <div className="profile-address-full">{address}</div>
            <div className="profile-address-short">{shortAddress}</div>
          </div>
          <div className="profile-wallet-actions">
            <a
              href={`https://hashscan.io/testnet/account/${address}`}
              target="_blank" rel="noreferrer"
              className="btn btn-outline"
            >
              HashScan ↗
            </a>
            <button className="btn btn-ghost" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        </div>

        {/* Balances */}
        <div className="card">
          <h2 className="card-title" style={{marginBottom:'var(--space-5)'}}>Token Balances</h2>
          <div className="balance-list">
            <BalanceRow
              icon="💵"
              label="USDC-H"
              value={usdcBalance !== null ? `$${usdcBalance.toFixed(2)}` : '...'}
              sub="Testnet stablecoin"
              action={
                <button
                  className="btn btn-outline"
                  style={{fontSize:'0.65rem', padding:'4px 10px'}}
                  onClick={handleFaucet}
                  disabled={faucetLoading}
                >
                  {faucetLoading ? 'Claiming...' : 'Faucet +100'}
                </button>
              }
            />
            <BalanceRow
              icon="🌾"
              label="SHAMBA"
              value={`${shambaBalance.toFixed(4)}`}
              sub={qualifies ? '✓ Fee discount active' : `Need 100 for discount`}
              green={qualifies}
            />
            <BalanceRow
              icon="📊"
              label="Agent Emissions"
              value={`${agentEmissions.toFixed(4)} SHAMBA`}
              sub="Earned as sentinel agent"
            />
          </div>
        </div>
      </div>

      {/* My Receipts */}
      <div className="card animate-in-3">
        <div className="card-header-row">
          <h2 className="card-title">My Commodity Receipts</h2>
          <span className="badge badge-muted">{myReceipts.length} oCRs</span>
        </div>

        {receiptsLoading ? (
          <div className="skeleton" style={{height: 100}} />
        ) : myReceipts.length === 0 ? (
          <div className="empty-state">
            No receipts found for this wallet.<br/>
            <span style={{fontSize:'0.7rem', color:'var(--text-muted)'}}>
              Receipts are minted when grain is deposited via MPESA.
            </span>
          </div>
        ) : (
          <div className="profile-receipts-list">
            {myReceipts.map(r => (
              <div key={r.tokenId} className="profile-receipt-row">
                <div className="pr-left">
                  <span className="pr-id">oCR #{r.tokenId}</span>
                  <span className="pr-detail">
                    {r.weightKg}kg {r.commodityType} · Grade {GRADE_LABEL[r.grade]} · {r.warehouseId}
                  </span>
                </div>
                <div className="pr-right">
                  <span className="pr-value">
                    KES {r.valuationKes.toLocaleString('en-KE', {maximumFractionDigits: 0})}
                  </span>
                  <span className={`badge ${STATUS_CLASS[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Network info */}
      <div className="card animate-in-4">
        <h2 className="card-title" style={{marginBottom:'var(--space-5)'}}>Network Info</h2>
        <div className="network-info-grid">
          <NetRow label="Network"    value="Hedera Testnet" />
          <NetRow label="Chain ID"   value="296" />
          <NetRow label="RPC"        value="testnet.hashio.io" />
          <NetRow label="Explorer"   value="hashscan.io/testnet" link="https://hashscan.io/testnet" />
          <NetRow label="HCS Topic"  value="0.0.8157255" link="https://hashscan.io/testnet/topic/0.0.8157255" />
          <NetRow label="Telegram"   value="@guarddog_agent_bot" link="https://t.me/guarddog_agent_bot" />
        </div>
      </div>

      {/* Faucet tx modal */}
      <TxModal
        status={faucetStatus as any}
        txHash={faucetHash}
        error={faucetError}
        title="Claim USDC-H Faucet"
        steps={['Mint 100 USDC-H to wallet']}
        onClose={() => { setFaucetStatus('idle'); fetchBalance(); }}
      />
    </div>
  );
}

function BalanceRow({ icon, label, value, sub, green, action }: {
  icon: string; label: string; value: string; sub: string; green?: boolean; action?: React.ReactNode;
}) {
  return (
    <div className="balance-row">
      <span className="balance-icon">{icon}</span>
      <div className="balance-body">
        <div className="balance-label">{label}</div>
        <div className="balance-sub">{sub}</div>
      </div>
      <div className="balance-right">
        <span className="balance-value" style={{color: green ? 'var(--green-bright)' : undefined}}>
          {value}
        </span>
        {action}
      </div>
    </div>
  );
}

function NetRow({ label, value, link }: { label: string; value: string; link?: string }) {
  return (
    <div className="net-row">
      <span className="net-label">{label}</span>
      {link
        ? <a href={link} target="_blank" rel="noreferrer" className="net-value link">{value} ↗</a>
        : <span className="net-value">{value}</span>
      }
    </div>
  );
}