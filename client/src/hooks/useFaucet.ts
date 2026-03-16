import { useState } from 'react';
import { ethers } from 'ethers';
import { CONTRACTS, getProvider } from '../config/contracts';
import { useWalletContext } from '../components/WalletContext';

const USDC_FAUCET_ABI = [
  'function mint(address to, uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

export function useFaucet() {
  const { signer, address } = useWalletContext();
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  async function fetchBalance() {
    if (!address) return;
    try {
      const provider = getProvider();
      const usdc = new ethers.Contract(CONTRACTS.usdcH, USDC_FAUCET_ABI, provider);
      const bal = await usdc.balanceOf(address);
      setBalance(Number(bal) / 1e6);
    } catch { /* ignore */ }
  }

  async function claimFaucet(): Promise<string | null> {
    if (!signer || !address) return null;
    setLoading(true);
    try {
      const usdc = new ethers.Contract(CONTRACTS.usdcH, USDC_FAUCET_ABI, signer);
      // Mint 100 USDC-H (100 * 1e6)
      const tx = await usdc.mint(address, 100_000_000n, { gasLimit: 200_000 });
      await tx.wait();
      await fetchBalance();
      return tx.hash;
    } catch (e: any) {
      throw new Error(e?.shortMessage ?? e?.message ?? 'Faucet failed');
    } finally {
      setLoading(false);
    }
  }

  return { claimFaucet, fetchBalance, balance, loading };
}