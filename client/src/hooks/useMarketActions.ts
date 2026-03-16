import { useState } from 'react';
import { ethers } from 'ethers';
import { CONTRACTS, RISK_MARKET_ABI, FORWARD_MARKET_ABI } from '../config/contracts';
import { useWalletContext } from '../components/WalletContext';

const USDC_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
];

export type TxStatus = 'idle' | 'approving' | 'confirming' | 'success' | 'error';

export function useMarketActions() {
  const { signer } = useWalletContext();
  const [status, setStatus]   = useState<TxStatus>('idle');
  const [txHash, setTxHash]   = useState<string | null>(null);
  const [error, setError]     = useState<string | null>(null);

  function reset() { setStatus('idle'); setTxHash(null); setError(null); }

  // ── Create risk market ─────────────────────────────────────────────────
  async function createRiskMarket(tokenId: number, loanId: number, durationDays: number): Promise<bigint | null> {
    if (!signer) return null;
    setStatus('confirming'); setError(null);
    try {
      const market = new ethers.Contract(CONTRACTS.riskMarket, RISK_MARKET_ABI, signer);
      const durationSecs = BigInt(durationDays * 86_400);
      const tx = await market.createMarket(tokenId, loanId, durationSecs, { gasLimit: 300_000 });
      const receipt = await tx.wait();
      setTxHash(tx.hash);

      // Parse marketId from event
      let marketId = 0n;
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = market.interface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === 'MarketCreated') { marketId = parsed.args.marketId; break; }
        } catch { /* skip */ }
      }
      setStatus('success');
      return marketId;
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Failed to create market');
      setStatus('error');
      return null;
    }
  }

  // ── Take YES/NO position ───────────────────────────────────────────────
  async function takePosition(marketId: number, isYes: boolean, amountUsdc: number): Promise<boolean> {
    if (!signer) return false;
    setStatus('approving'); setError(null);
    try {
      const usdc   = new ethers.Contract(CONTRACTS.usdcH, USDC_ABI, signer);
      const market = new ethers.Contract(CONTRACTS.riskMarket, RISK_MARKET_ABI, signer);
      const amount = BigInt(Math.ceil(amountUsdc * 1e6));

      // Approve
      const approveTx = await usdc.approve(CONTRACTS.riskMarket, amount, { gasLimit: 200_000 });
      await approveTx.wait();

      setStatus('confirming');
      const tx = await market.takePosition(marketId, isYes, amount, { gasLimit: 300_000 });
      await tx.wait();
      setTxHash(tx.hash);
      setStatus('success');
      return true;
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Position failed');
      setStatus('error');
      return false;
    }
  }

  // ── Place forward bid ──────────────────────────────────────────────────
  async function placeForwardBid(
    tokenId: number,
    offerUsdc: number,
    settlementDate: Date,
    buyerRef: string
  ): Promise<bigint | null> {
    if (!signer) return null;
    setStatus('approving'); setError(null);
    try {
      const usdc   = new ethers.Contract(CONTRACTS.usdcH, USDC_ABI, signer);
      const fwd    = new ethers.Contract(CONTRACTS.forwardMarket, FORWARD_MARKET_ABI, signer);
      const amount = BigInt(Math.ceil(offerUsdc * 1e6));

      const approveTx = await usdc.approve(CONTRACTS.forwardMarket, amount, { gasLimit: 200_000 });
      await approveTx.wait();

      setStatus('confirming');
      const settlementTs = BigInt(Math.floor(settlementDate.getTime() / 1000));
      const tx = await fwd.placeBid(tokenId, amount, settlementTs, buyerRef, { gasLimit: 300_000 });
      await tx.wait();
      setTxHash(tx.hash);
      setStatus('success');

      // Parse bidId
      let bidId = 0n;
      const receipt = await tx.wait();
      for (const log of receipt?.logs ?? []) {
        try {
          const parsed = fwd.interface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === 'BidPlaced') { bidId = parsed.args.bidId; break; }
        } catch { /* skip */ }
      }
      return bidId;
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Bid failed');
      setStatus('error');
      return null;
    }
  }

  return { createRiskMarket, takePosition, placeForwardBid, reset, status, txHash, error };
}