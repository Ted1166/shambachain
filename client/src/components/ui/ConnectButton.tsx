import { useWalletContext } from '../WalletContext';
import '../../styles/connect.css';

export function ConnectButton() {
  const { address, shortAddress, isConnected, isCorrectNetwork,
          isConnecting, error, connect, disconnect, switchNetwork } = useWalletContext();

  if (isConnecting) {
    return (
      <button className="connect-btn connecting" disabled>
        <span className="connect-spinner" />
        Connecting…
      </button>
    );
  }

  if (isConnected && !isCorrectNetwork) {
    return (
      <button className="connect-btn wrong-network" onClick={switchNetwork}>
        ⚠ Switch to Hedera
      </button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="wallet-connected">
        <div className="wallet-address-pill" onClick={disconnect} title="Click to disconnect">
          <span className="wallet-dot" />
          <span className="wallet-addr">{shortAddress}</span>
          <span className="wallet-chain">Hedera Testnet</span>
        </div>
      </div>
    );
  }

  return (
    <div className="connect-wrapper">
      <button className="connect-btn" onClick={connect}>
        <span className="connect-icon">⬡</span>
        Connect Wallet
      </button>
      {error && <div className="connect-error">{error}</div>}
    </div>
  );
}