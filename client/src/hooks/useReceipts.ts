import { useState, useEffect } from 'react';
import axios from 'axios';
import { ethers } from 'ethers';
import { CONTRACTS, RECEIPT_FACTORY_ABI, MIRROR_NODE, getProvider } from '../config/contracts';

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
      const addr = CONTRACTS.receiptFactory.toLowerCase();
      const topic0 = '0x90e6f23b6f72b87ceea2b71263a788fdd9a39a2f51983274ae78d6ac65f3794c';
      const res = await axios.get(`${MIRROR_NODE}/api/v1/contracts/${addr}/results/logs?limit=100&order=asc`);
      const logs: any[] = res.data?.logs ?? [];
      const ids = new Set<number>();
      for (const log of logs) {
        if (log.topics?.[0] === topic0 && log.topics?.[1]) {
          const id = parseInt(log.topics[1], 16);
          if (id > 0 && id <= 10_000) ids.add(id);
        }
      }
      return Array.from(ids);
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