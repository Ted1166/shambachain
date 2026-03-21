import { useState } from 'react';
// import { ethers } from 'ethers';
// import { CONTRACTS, FORWARD_MARKET_ABI } from '../config/contracts';
// import { useWalletContext } from '../components/WalletContext';

// const USDC_ABI = [
//   'function approve(address spender, uint256 amount) returns (bool)',
//   'function allowance(address owner, address spender) view returns (uint256)',
// ];

// const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
// const BACKEND = () => (import.meta as any).env?.VITE_BACKEND_URL ?? 'http://localhost:3000';

export type TxStatus = 'idle' | 'approving' | 'confirming' | 'success' | 'error';

export function useMarketActions() {
  // const { signer } = useWalletContext();
  const [status, setStatus]   = useState<TxStatus>('idle');
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  function reset() { setStatus('idle'); setTxHash(null); setError(null); }

  // ── Create risk market (backend — no user confirmation) ──────────────────
  async function createRiskMarket(_tokenId: number, _loanId: number, _durationDays: number): Promise<bigint | null> {
    setStatus('confirming'); setError(null);
    try {
      await new Promise(r => setTimeout(r, 2000));
      setTxHash('0x' + Array.from({length:64},()=>Math.floor(Math.random()*16).toString(16)).join(''));
      setStatus('success');
      return 3n;
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
      setStatus('error');
      return null;
    }
  }

  // ── Take YES/NO position (backend — no user confirmation) ────────────────
  async function takePosition(_marketId: number, _isYes: boolean, _amountUsdc: number) {
    setStatus('confirming'); setError(null);
    try {
      // Simulate tx delay for realism
      await new Promise(r => setTimeout(r, 2000));
      setTxHash('0x' + Math.random().toString(16).slice(2).padEnd(64, '0'));
      setStatus('success');
      return true;
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
      setStatus('error');
      return false;
    }
  }

  // ── Place forward bid (user approves, backend places bid) ────────────────
  async function placeForwardBid(_tokenId: number, _offerUsdc: number, _settlementDate: Date, _buyerRef: string): Promise<bigint | null> {
    setStatus('approving'); setError(null);
    try {
      await new Promise(r => setTimeout(r, 1500));
      setStatus('confirming');
      await new Promise(r => setTimeout(r, 2000));
      setTxHash('0x' + Array.from({length:64},()=>Math.floor(Math.random()*16).toString(16)).join(''));
      setStatus('success');
      return 2n;
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
      setStatus('error');
      return null;
    }
  }

  return { createRiskMarket, takePosition, placeForwardBid, reset, status, txHash, error };
}
