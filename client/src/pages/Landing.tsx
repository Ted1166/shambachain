import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrice } from '../hooks/usePrice';
import '../styles/landing.css';

const STATS = [
  { label: 'Contracts Deployed', value: '9',        suffix: '' },
  { label: 'oCR NFTs Minted',    value: '6',        suffix: '' },
  { label: 'Grain on Chain',     value: '850',      suffix: 'kg' },
  { label: 'USDC-H Borrowed',    value: '$30',      suffix: '' },
];

const HOW_IT_WORKS = [
  {
    step: '01',
    icon: '🌽',
    title: 'Deposit Grain',
    desc: 'Farmer deposits physical grain at a registered warehouse and pays the storage fee via MPESA. The payment triggers the minting flow.',
  },
  {
    step: '02',
    icon: '📋',
    title: 'HCS Audit Trail',
    desc: 'Every deposit event is written to a Hedera Consensus Service topic — creating a tamper-proof, timestamped audit trail before any token is minted.',
  },
  {
    step: '03',
    icon: '🔗',
    title: 'Mint oCR NFT',
    desc: 'The warehouse custodian mints an on-chain Commodity Receipt (oCR) ERC-721 NFT on Hedera EVM, encoding weight, grade, warehouse ID and MPESA reference.',
  },
  {
    step: '04',
    icon: '🏦',
    title: 'Borrow Against It',
    desc: 'Lock the oCR as collateral in the vault and borrow up to 80% LTV in USDC-H. Sentinel agents monitor LTV in real time and alert via Telegram.',
  },
];

const FEATURES = [
  { icon: '⬡',  title: 'Hedera EVM',       desc: 'All contracts live on Hedera testnet — fast finality, low fees, EVM-compatible.' },
  { icon: '≡',  title: 'HCS Audit Trail',  desc: 'Every deposit, mint and risk event is written to a Hedera Consensus topic.' },
  { icon: '🤖', title: 'Sentinel Agents',  desc: 'PriceAgent, RiskAgent and LoanAgent run autonomously, earning SHAMBA rewards.' },
  { icon: '📱', title: 'MPESA Native',      desc: 'Farmers trigger the full mint pipeline directly from their mobile phones.' },
  { icon: '◎',  title: 'Risk Markets',     desc: 'Prediction pools let anyone take a position on whether a loan gets liquidated.' },
  { icon: '🌾', title: 'SHAMBA Token',     desc: 'ERC-20 reward token for agents — discount on protocol fees at 100+ SHAMBA.' },
];

export function Landing() {
  const navigate = useNavigate();
  const { priceKes, isStale } = usePrice();
  // const [tick, setTick] = useState(0);

  // // Animate numbers counting up
  // useEffect(() => {
  //   const id = setInterval(() => setTick(t => t + 1), 50);
  //   setTimeout(() => clearInterval(id), 2000);
  //   return () => clearInterval(id);
  // }, []);

  return (
    <div className="landing">

      {/* ── Hero ── */}
      <section className="hero">
        {/* Background grid */}
        <div className="hero-grid" aria-hidden />

        {/* Floating price pill */}
        <div className="hero-price-pill">
          <span className={isStale ? '' : 'pulse-dot'} />
          <span>MAIZE</span>
          <span className="hero-price-value">
            KES {priceKes > 0 ? priceKes.toFixed(2) : '—'}
          </span>
          <span className="hero-price-unit">/kg</span>
        </div>

        <div className="hero-content">
          <div className="hero-eyebrow animate-in">
            <span className="badge badge-green">🏆 Hello Future Apex Hackathon 2026</span>
          </div>

          <h1 className="hero-title animate-in-2">
            Grain in the Ground.<br />
            <span className="hero-title-accent">Capital on the Chain.</span>
          </h1>

          <p className="hero-desc animate-in-3">
            ShambaChain turns physical grain deposits into on-chain commodity receipts (oCR NFTs)
            on Hedera — giving East African smallholder farmers access to DeFi collateral,
            forward markets, and institutional liquidity for the first time.
          </p>

          <div className="hero-actions animate-in-4">
            <button className="btn btn-primary btn-lg" onClick={() => navigate('/receipts')}>
              View Receipts →
            </button>
            <button className="btn btn-outline btn-lg" onClick={() => navigate('/')}>
              Open Dashboard
            </button>
            <a
              href="https://t.me/guarddog_agent_bot"
              target="_blank" rel="noreferrer"
              className="btn btn-ghost btn-lg"
            >
              📱 Try Bot
            </a>
          </div>
        </div>

        {/* Live terminal widget */}
        <div className="hero-terminal animate-in-3">
          <div className="terminal-bar">
            <span className="terminal-dot red" />
            <span className="terminal-dot amber" />
            <span className="terminal-dot green" />
            <span className="terminal-title">shambachain-agent</span>
          </div>
          <div className="terminal-body">
            <TerminalLine delay={0}   prefix="info"  text='ShambaChain Backend starting...' />
            <TerminalLine delay={300} prefix="info"  text='Telegram bot started (polling mode)' />
            <TerminalLine delay={600} prefix="info"  text='PriceAgent started' />
            <TerminalLine delay={900} prefix="info"  text='RiskAgent: discovered tokens {"count":6}' />
            <TerminalLine delay={1200} prefix="info" text={`PriceAgent: price fetched {"priceKes":"${priceKes.toFixed(2)}"}`} />
            <TerminalLine delay={1500} prefix="info" text='RiskAgent: LTV check {"tokenId":4,"ltvBps":5500}' />
            <TerminalLine delay={1800} prefix="info" text='PriceAgent: SHAMBA reward claimed ✓' />
            <TerminalLine delay={2100} prefix="info" text='RiskAgent: scan complete {"checked":1}' blink />
          </div>
        </div>
      </section>

      {/* ── Stats bar ── */}
      <section className="stats-bar animate-in">
        {STATS.map(s => (
          <div key={s.label} className="stats-bar-item">
            <div className="stats-bar-value">{s.value}{s.suffix}</div>
            <div className="stats-bar-label">{s.label}</div>
          </div>
        ))}
        <div className="stats-bar-item">
          <div className="stats-bar-value" style={{color:'var(--green-bright)'}}>
            KES {priceKes > 0 ? priceKes.toFixed(2) : '—'}
          </div>
          <div className="stats-bar-label">Live Maize Price</div>
        </div>
        <div className="stats-bar-item">
          <div className="stats-bar-value" style={{color:'var(--amber)'}}>9</div>
          <div className="stats-bar-label">Hedera Contracts</div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="section">
        <div className="section-header">
          <div className="section-eyebrow">THE FLOW</div>
          <h2 className="section-title">From Warehouse to Wallet</h2>
          <p className="section-sub">
            A complete pipeline from physical grain deposit to on-chain DeFi collateral —
            all triggered by an MPESA payment from a feature phone.
          </p>
        </div>

        <div className="flow-steps">
          {HOW_IT_WORKS.map((step, i) => (
            <div key={step.step} className="flow-step">
              <div className="flow-step-number">{step.step}</div>
              <div className="flow-step-icon">{step.icon}</div>
              <h3 className="flow-step-title">{step.title}</h3>
              <p className="flow-step-desc">{step.desc}</p>
              {i < HOW_IT_WORKS.length - 1 && (
                <div className="flow-arrow">→</div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="section">
        <div className="section-header">
          <div className="section-eyebrow">INFRASTRUCTURE</div>
          <h2 className="section-title">Built on Hedera</h2>
        </div>

        <div className="features-grid">
          {FEATURES.map(f => (
            <div key={f.title} className="feature-card card">
              <div className="feature-icon">{f.icon}</div>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Architecture diagram ── */}
      <section className="section">
        <div className="section-header">
          <div className="section-eyebrow">ARCHITECTURE</div>
          <h2 className="section-title">How the Stack Fits Together</h2>
        </div>

        <div className="arch-diagram card">
          <div className="arch-row">
            <ArchBox label="Farmer" icon="👨‍🌾" color="green" />
            <ArchArrow label="MPESA STK Push" />
            <ArchBox label="Backend + MPESA Webhook" icon="⚙️" color="amber" />
            <ArchArrow label="HCS write" />
            <ArchBox label="Hedera HCS Topic" icon="≡" color="green" sub="0.0.8157255" />
          </div>
          <div className="arch-down-arrow">↓ mint</div>
          <div className="arch-row">
            <ArchBox label="ReceiptFactory" icon="📋" color="green" sub="ERC-721" />
            <ArchArrow label="lock collateral" />
            <ArchBox label="CollateralVault" icon="🏦" color="green" sub="ERC-20 loans" />
            <ArchArrow label="price feed" />
            <ArchBox label="SupraPriceFeed" icon="📡" color="amber" sub="KES oracle" />
          </div>
          <div className="arch-down-arrow">↓ monitor</div>
          <div className="arch-row">
            <ArchBox label="PriceAgent" icon="💹" color="green" sub="5 min cron" />
            <ArchBox label="RiskAgent"  icon="⚠️"  color="amber" sub="10 min cron" />
            <ArchBox label="LoanAgent"  icon="💰" color="green" sub="on-demand" />
            <ArchArrow label="notify" />
            <ArchBox label="Telegram Bot" icon="📱" color="green" sub="@guarddog_agent_bot" />
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="cta-section">
        <div className="cta-glow" aria-hidden />
        <h2 className="cta-title">Ready to tokenize your grain?</h2>
        <p className="cta-sub">
          6 oCRs live on Hedera testnet · Sentinel agents running 24/7 · Telegram bot active
        </p>
        <div className="cta-actions">
          <button className="btn btn-primary btn-lg" onClick={() => navigate('/receipts')}>
            Explore oCR NFTs →
          </button>
          <button className="btn btn-outline btn-lg" onClick={() => navigate('/vault')}>
            Open Vault
          </button>
        </div>
        <div className="cta-links">
          <a href="https://hashscan.io/testnet/contract/0x451f2f54A027F9Ec359f1411f341878d645dD337" target="_blank" rel="noreferrer">ReceiptFactory ↗</a>
          <a href="https://hashscan.io/testnet/topic/0.0.8157255" target="_blank" rel="noreferrer">HCS Topic ↗</a>
          <a href="https://t.me/guarddog_agent_bot" target="_blank" rel="noreferrer">Telegram Bot ↗</a>
        </div>
      </section>

    </div>
  );
}

function TerminalLine({ prefix, text, delay, blink }: {
  prefix: string; text: string; delay: number; blink?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(id);
  }, [delay]);

  if (!visible) return null;
  return (
    <div className="terminal-line">
      <span className="terminal-prefix">{prefix}</span>
      <span className="terminal-text">{text}{blink && <span className="terminal-cursor">█</span>}</span>
    </div>
  );
}

function ArchBox({ label, icon, color, sub }: { label: string; icon: string; color: string; sub?: string }) {
  return (
    <div className={`arch-box arch-box-${color}`}>
      <span className="arch-box-icon">{icon}</span>
      <span className="arch-box-label">{label}</span>
      {sub && <span className="arch-box-sub">{sub}</span>}
    </div>
  );
}

function ArchArrow({ label }: { label: string }) {
  return (
    <div className="arch-arrow-col">
      <span className="arch-arrow-label">{label}</span>
      <span className="arch-arrow-line">──────→</span>
    </div>
  );
}