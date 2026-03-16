import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { CONTRACTS, COLLATERAL_VAULT_ABI, getProvider } from '../config/contracts';

export interface Loan {
  loanId: number;
  tokenId: number;
  borrower: string;
  principal: number;
  interestAccrued: number;
  collateralKes: number;
  ltvBps: number;
  currentLtvBps: number;
  openedAt: Date;
  dueAt: Date;
  repaidAt: Date | null;
  status: number; // 0=None, 1=Active, 2=Repaid, 3=Liquidated, 4=Defaulted
  totalOwed: number;
}

export const LOAN_STATUS = ['None', 'Active', 'Repaid', 'Liquidated', 'Defaulted'];
export const LOAN_STATUS_CLASS = ['badge-muted', 'badge-green', 'badge-muted', 'badge-red', 'badge-amber'];

export function useLoan(loanId: number | null, refreshMs = 30_000) {
  const [loan, setLoan] = useState<Loan | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!loanId) return;

    async function fetch() {
      setLoading(true);
      try {
        const provider = getProvider();
        const vault = new ethers.Contract(CONTRACTS.collateralVault, COLLATERAL_VAULT_ABI, provider);
        const [d, ltvBps, totalOwed] = await Promise.all([
          vault.getLoan(loanId),
          vault.getCurrentLtv(loanId),
          vault.getTotalOwed(loanId),
        ]);
        setLoan({
          loanId:         Number(d.loanId),
          tokenId:        Number(d.tokenId),
          borrower:       d.borrower,
          principal:      Number(d.principal) / 1e6,
          interestAccrued: Number(d.interestAccrued) / 1e6,
          collateralKes:  Number(d.collateralKes) / 1e18,
          ltvBps:         Number(d.ltvBps),
          currentLtvBps:  Number(ltvBps),
          openedAt:       new Date(Number(d.openedAt) * 1000),
          dueAt:          new Date(Number(d.dueAt) * 1000),
          repaidAt:       Number(d.repaidAt) > 0 ? new Date(Number(d.repaidAt) * 1000) : null,
          status:         Number(d.status),
          totalOwed:      Number(totalOwed) / 1e6,
        });
      } finally {
        setLoading(false);
      }
    }

    fetch();
    const id = setInterval(fetch, refreshMs);
    return () => clearInterval(id);
  }, [loanId]);

  return { loan, loading };
}

export function useTokenLoan(tokenId: number | null) {
  const [loanId, setLoanId] = useState<number | null>(null);

  useEffect(() => {
    if (!tokenId) return;
    const provider = getProvider();
    const vault = new ethers.Contract(CONTRACTS.collateralVault, COLLATERAL_VAULT_ABI, provider);
    vault.tokenToLoan(tokenId).then((id: bigint) => {
      setLoanId(Number(id) > 0 ? Number(id) : null);
    }).catch(() => {});
  }, [tokenId]);

  return loanId;
}