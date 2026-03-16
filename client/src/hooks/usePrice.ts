import { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { CONTRACTS, SUPRA_PRICE_FEED_ABI, getProvider } from '../config/contracts';

export interface PriceData {
  priceKes: number;
  timestamp: Date;
  isStale: boolean;
  loading: boolean;
}

export function usePrice(refreshMs = 30_000): PriceData {
  const [data, setData] = useState<PriceData>({
    priceKes: 0,
    timestamp: new Date(),
    isStale: true,
    loading: true,
  });

  async function fetch() {
    try {
      const provider = getProvider();
      const feed = new ethers.Contract(CONTRACTS.supraPriceFeed, SUPRA_PRICE_FEED_ABI, provider);
      const [price, ts] = await feed.getMaizePriceKes();
      const isStale = await feed.isStale();
      setData({
        priceKes:  Number(price) / 1e18,
        timestamp: new Date(Number(ts) * 1000),
        isStale,
        loading:   false,
      });
    } catch {
      setData(d => ({ ...d, loading: false }));
    }
  }

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);

  return data;
}