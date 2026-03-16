import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { HEDERA_CHAIN_ID, HEDERA_TESTNET_RPC } from '../config/contracts';

export interface WalletState {
  address: string | null;
  shortAddress: string | null;
  signer: ethers.Signer | null;
  chainId: number | null;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  isConnecting: boolean;
  error: string | null;
}

const INITIAL: WalletState = {
  address:          null,
  shortAddress:     null,
  signer:           null,
  chainId:          null,
  isConnected:      false,
  isCorrectNetwork: false,
  isConnecting:     false,
  error:            null,
};

const HEDERA_TESTNET_PARAMS = {
  chainId:           `0x${HEDERA_CHAIN_ID.toString(16)}`,
  chainName:         'Hedera Testnet',
  nativeCurrency:    { name: 'HBAR', symbol: 'HBAR', decimals: 18 },
  rpcUrls:           [HEDERA_TESTNET_RPC],
  blockExplorerUrls: ['https://hashscan.io/testnet'],
};

export function useWallet() {
  const [state, setState] = useState<WalletState>(INITIAL);

  function short(addr: string) {
    return addr.slice(0, 6) + '…' + addr.slice(-4);
  }

  async function updateAccount(addr: string) {
    const eth = (window as any).ethereum;
    if (!eth) return;
    const provider = new ethers.BrowserProvider(eth);
    const signer   = await provider.getSigner();
    const network  = await provider.getNetwork();
    const chainId  = Number(network.chainId);
    setState({
      address:          addr,
      shortAddress:     short(addr),
      signer,
      chainId,
      isConnected:      true,
      isCorrectNetwork: chainId === HEDERA_CHAIN_ID,
      isConnecting:     false,
      error:            null,
    });
  }

  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    eth.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (accounts[0]) updateAccount(accounts[0]);
    });
    const onAccountsChanged = (accounts: string[]) => {
      if (accounts[0]) updateAccount(accounts[0]);
      else setState(INITIAL);
    };
    const onChainChanged = () => window.location.reload();
    eth.on('accountsChanged', onAccountsChanged);
    eth.on('chainChanged',    onChainChanged);
    return () => {
      eth.removeListener('accountsChanged', onAccountsChanged);
      eth.removeListener('chainChanged',    onChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) {
      setState(s => ({ ...s, error: 'No wallet detected. Install MetaMask or HashPack.' }));
      return;
    }
    setState(s => ({ ...s, isConnecting: true, error: null }));
    try {
      const accounts: string[] = await eth.request({ method: 'eth_requestAccounts' });
      await updateAccount(accounts[0]);
      const provider = new ethers.BrowserProvider(eth);
      const network  = await provider.getNetwork();
      if (Number(network.chainId) !== HEDERA_CHAIN_ID) {
        await switchToHedera(eth);
      }
    } catch (e: any) {
      setState(s => ({ ...s, isConnecting: false, error: e?.message ?? 'Connection rejected' }));
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    await switchToHedera(eth);
  }, []);

  const disconnect = useCallback(() => setState(INITIAL), []);

  return { ...state, connect, disconnect, switchNetwork };
}

async function switchToHedera(eth: any) {
  try {
    await eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${HEDERA_CHAIN_ID.toString(16)}` }],
    });
  } catch (e: any) {
    if (e?.code === 4902) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [HEDERA_TESTNET_PARAMS],
      });
    }
  }
}