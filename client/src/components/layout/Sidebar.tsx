import { NavLink } from 'react-router-dom';
import { usePrice } from '../../hooks/usePrice';
import { useWalletContext } from '../WalletContext';
import '../../styles/sidebar.css';
import { ConnectButton } from '../ui/ConnectButton';

const NAV_ITEMS = [
  { to: '/',         icon: '◈', label: 'Dashboard' },
  { to: '/receipts', icon: '◉', label: 'Receipts'  },
  { to: '/vault',    icon: '⬡', label: 'Vault'     },
  { to: '/markets',  icon: '◎', label: 'Markets'   },
  { to: '/explorer', icon: '≡', label: 'Explorer'  },
];

export function Sidebar() {
  const { priceKes, isStale } = usePrice();
  const { isConnected, shortAddress } = useWalletContext();

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="logo-icon">🌾</div>
        <div className="logo-text">
          <span className="logo-name">Shamba</span>
          <span className="logo-sub">Chain</span>
        </div>
      </div>

      {/* Live price ticker */}
      <div className="sidebar-ticker">
        <div className="ticker-label">MAIZE / KES</div>
        <div className="ticker-value">
          {priceKes > 0 ? priceKes.toFixed(2) : '—'}
        </div>
        <div className={`ticker-status ${isStale ? 'stale' : 'live'}`}>
          <span className={isStale ? '' : 'pulse-dot'} />
          {isStale ? 'STALE' : 'LIVE'}
        </div>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            <span className="nav-arrow">›</span>
          </NavLink>
        ))}
        {/* Profile - only when connected */}
        {isConnected && (
          <NavLink
            to="/profile"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="nav-icon">◐</span>
            <span className="nav-label">{shortAddress ?? 'Profile'}</span>
            <span className="nav-arrow">›</span>
          </NavLink>
        )}
      </nav>

      {/* Network badge */}
      <ConnectButton/>
      <div className="sidebar-footer">
        <div className="network-badge">
          <span className="pulse-dot" />
          <span>Hedera Testnet</span>
        </div>
        <div className="footer-links">
          <a href="https://hashscan.io/testnet" target="_blank" rel="noreferrer">HashScan ↗</a>
          <a href="https://t.me/guarddog_agent_bot" target="_blank" rel="noreferrer">Bot ↗</a>
        </div>
      </div>
    </aside>
  );
}