import { useWalletContext } from '../WalletContext';
import { ConnectButton } from './ConnectButton';
import type { ReactNode } from 'react';
import '../../styles/require-wallet.css';

interface Props {
  children: ReactNode;
  message?: string;
}

export function RequireWallet({ children, message }: Props) {
  const { isConnected, isCorrectNetwork } = useWalletContext();

  if (!isConnected) {
    return (
      <div className="require-wallet-screen">
        <div className="require-wallet-card">
          <div className="rw-icon">⬡</div>
          <h2 className="rw-title">Connect Your Wallet</h2>
          <p className="rw-message">
            {message ?? 'Connect your wallet to access this page and interact with ShambaChain on Hedera.'}
          </p>
          <ConnectButton />
          <div className="rw-supported">
            <span>Supports</span>
            <span className="rw-wallet-tag">MetaMask</span>
            <span className="rw-wallet-tag">HashPack</span>
            <span className="rw-wallet-tag">Blade</span>
          </div>
        </div>
      </div>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="require-wallet-screen">
        <div className="require-wallet-card">
          <div className="rw-icon" style={{ color: 'var(--amber)' }}>⚠</div>
          <h2 className="rw-title">Wrong Network</h2>
          <p className="rw-message">
            ShambaChain runs on <strong>Hedera Testnet</strong> (Chain ID 296).<br />
            Please switch your wallet to continue.
          </p>
          <ConnectButton />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}