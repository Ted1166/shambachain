import { createContext, useContext, type ReactNode } from 'react';
import { useWallet, type WalletState } from '../hooks/useWallet';

interface WalletCtx extends WalletState {
  connect: () => Promise<void>;
  disconnect: () => void;
  switchNetwork: () => Promise<void>;
}

const WalletContext = createContext<WalletCtx>({} as WalletCtx);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wallet = useWallet();
  return (
    <WalletContext.Provider value={wallet}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWalletContext() {
  return useContext(WalletContext);
}