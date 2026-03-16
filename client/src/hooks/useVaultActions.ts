import { useState } from 'react';
import { ethers } from 'ethers';
import {
  CONTRACTS,
  RECEIPT_FACTORY_ABI,
  COLLATERAL_VAULT_ABI,
} from '../config/contracts';
import { useWalletContext } from '../components/WalletContext';

const USDC_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
];

export type TxStatus = 'idle' | 'approving' | 'confirming' | 'success' | 'error';

export function useVaultActions() {
  const { signer, address } = useWalletContext();
  const [status, setStatus] = useState<TxStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStatus('idle');
    setTxHash(null);
    setError(null);
  }

  // ── Lock collateral + issue loan ───────────────────────────────────────
  async function lockAndBorrow(tokenId: number, ltvBps = 6000): Promise<bigint | null> {
    if (!signer || !address) return null;
    setStatus('approving');
    setError(null);
    try {
      const factory = new ethers.Contract(CONTRACTS.receiptFactory, RECEIPT_FACTORY_ABI, signer);
      const vault   = new ethers.Contract(CONTRACTS.collateralVault, COLLATERAL_VAULT_ABI, signer);

      // Step 1 — approve vault to transfer NFT
      const approveTx = await factory.approve(CONTRACTS.collateralVault, tokenId, { gasLimit: 200_000 });
      await approveTx.wait();

      setStatus('confirming');

      // Step 2 — lock collateral (returns loanId via event)
      const lockTx = await vault.lockCollateral(tokenId, { gasLimit: 300_000 });
      const lockReceipt = await lockTx.wait();
      setTxHash(lockTx.hash);

      // Parse loanId from CollateralLocked event
      let loanId = 0n;
      for (const log of lockReceipt?.logs ?? []) {
        try {
          const parsed = vault.interface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === 'CollateralLocked') {
            loanId = parsed.args.loanId as bigint;
            break;
          }
        } catch { /* not our event */ }
      }

      // Step 3 — issue loan
      const issueTx = await vault.issueLoan(loanId, ltvBps, { gasLimit: 300_000 });
      await issueTx.wait();

      setStatus('success');
      return loanId;
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Transaction failed');
      setStatus('error');
      return null;
    }
  }

  // ── Repay loan ─────────────────────────────────────────────────────────
  async function repayLoan(loanId: number, totalOwed: number): Promise<boolean> {
    if (!signer || !address) return false;
    setStatus('approving');
    setError(null);
    try {
      const usdc  = new ethers.Contract(CONTRACTS.usdcH, USDC_ABI, signer);
      const vault = new ethers.Contract(CONTRACTS.collateralVault, COLLATERAL_VAULT_ABI, signer);

      // Step 1 — check balance
      const balance = await usdc.balanceOf(address);
      const needed  = BigInt(Math.ceil(totalOwed * 1e6));
      if (balance < needed) {
        throw new Error(`Insufficient USDC-H. Need $${totalOwed.toFixed(2)}, have $${(Number(balance)/1e6).toFixed(2)}`);
      }

      // Step 2 — approve vault to pull USDC-H
      const allowance = await usdc.allowance(address, CONTRACTS.collateralVault);
      if (allowance < needed) {
        const approveTx = await usdc.approve(CONTRACTS.collateralVault, needed, { gasLimit: 200_000 });
        await approveTx.wait();
      }

      setStatus('confirming');

      // Step 3 — repay
      const repayTx = await vault.repayLoan(loanId, { gasLimit: 300_000 });
      await repayTx.wait();
      setTxHash(repayTx.hash);

      setStatus('success');
      return true;
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Repay failed');
      setStatus('error');
      return false;
    }
  }

  return { lockAndBorrow, repayLoan, reset, status, txHash, error };
}