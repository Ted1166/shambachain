import { useState, useEffect } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { CONTRACTS, RECEIPT_FACTORY_ABI, getProvider } from '../config/contracts';

export interface Receipt {
  tokenId: number;
  custodian: string;
  farmer: string;
  commodityType: string;
  weightKg: number;
  grade: number;   // 0=A, 1=B, 2=C
  warehouseId: string;
  mpesaRef: string;
  valuationKes: number;
  issuedAt: Date;
  expiryTimestamp: Date;
  status: number;  // 0=Active, 1=LockedAsCollateral, 2=Redeemed, 3=Disputed
  metadataURI: string;
}

export const GRADE_LABEL = ['A', 'B', 'C'];
export const STATUS_LABEL = ['Active', 'Locked', 'Redeemed', 'Disputed'];
export const STATUS_CLASS = ['badge-green', 'badge-amber', 'badge-muted', 'badge-red'];

export function useReceipts(refreshMs = 60_000) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchTokenIds(): Promise<number[]> {
    try {
      const BACKEND = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';
      const res = await axios.get(`${BACKEND}/api/mirror/receipt-tokens`);
      return res.data?.tokenIds ?? [];
    } catch {
      return [1, 2, 3, 4, 5, 6]; // fallback
    }
  }

  async function fetchReceipts() {
    setLoading(true);
    try {
      const ids = await fetchTokenIds();
      const provider = getProvider();
      const factory = new ethers.Contract(CONTRACTS.receiptFactory, RECEIPT_FACTORY_ABI, provider);

      const results = await Promise.allSettled(ids.map(id => factory.getReceipt(id)));
      const parsed: Receipt[] = [];

      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          const d = r.value;
          parsed.push({
            tokenId:        ids[i],
            custodian:      d.custodian,
            farmer:         d.farmer,
            commodityType:  d.commodityType,
            weightKg:       Number(d.weightKg),
            grade:          Number(d.grade),
            warehouseId:    d.warehouseId,
            mpesaRef:       d.mpesaRef,
            valuationKes:   Number(d.valuationKes) / 1e18,
            issuedAt:       new Date(Number(d.issuedAt) * 1000),
            expiryTimestamp: new Date(Number(d.expiryTimestamp) * 1000),
            status:         Number(d.status),
            metadataURI:    d.metadataURI,
          });
        }
      });

      setReceipts(parsed);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchReceipts();
    const id = setInterval(fetchReceipts, refreshMs);
    return () => clearInterval(id);
  }, []);

  return { receipts, loading, refetch: fetchReceipts };
}