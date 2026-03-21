import { useState } from 'react';
import { useWalletContext } from '../components/WalletContext';

export type TxStatus = 'idle' | 'approving' | 'confirming' | 'success' | 'error';

const mockHash = () => '0x' + Array.from({length: 64}, () => Math.floor(Math.random()*16).toString(16)).join('');

export function useVaultActions() {
  const { signer, address } = useWalletContext();
  const [status, setStatus] = useState<TxStatus>('idle');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() { setStatus('idle'); setTxHash(null); setError(null); }

  async function lockAndBorrow(_tokenId: number, _ltvBps = 6000): Promise<bigint | null> {
    if (!signer || !address) return null;
    setStatus('approving'); setError(null);
    try {
      await new Promise(r => setTimeout(r, 1500));
      setStatus('confirming');
      await new Promise(r => setTimeout(r, 2000));
      setTxHash(mockHash());
      setStatus('success');
      return 2n;
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
      setStatus('error');
      return null;
    }
  }

  async function repayLoan(_loanId: number, _totalOwed: number): Promise<boolean> {
    if (!signer || !address) return false;
    setStatus('approving'); setError(null);
    try {
      await new Promise(r => setTimeout(r, 1500));
      setStatus('confirming');
      await new Promise(r => setTimeout(r, 2000));
      setTxHash(mockHash());
      setStatus('success');
      return true;
    } catch (e: any) {
      setError(e?.message ?? 'Failed');
      setStatus('error');
      return false;
    }
  }

  return { lockAndBorrow, repayLoan, reset, status, txHash, error };
}
