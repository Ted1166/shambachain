import { ethers } from 'ethers';

export const CONTRACTS = {
  receiptFactory:  '0x451f2f54A027F9Ec359f1411f341878d645dD337',
  collateralVault: '0x9648Abb0943C9409Ea2d501E1a9773aCbE836Bb1',
  forwardMarket:   '0xa1B21eedbB08cAC7F0F7AA29754bDBD794866139',
  riskMarket:      '0x9B05c7A71a02F39B18e979E4F84b784aFed3c284',
  riskOracle:      '0xf033A7Ff995a2A87C2ba4748bfF7626D6482Da64',
  supraPriceFeed:  '0xA4B1F9154E4fFd5e71392a240F5691f608314bEb',
  shambaToken:     '0x02A8AdD3ECAE73Adb908048E70A9fe18156B3785',
  usdcH:           '0x2d101fafb24c660bfef07fd3106caf1074c80bf7',
} as const;

export const HEDERA_TESTNET_RPC = 'https://testnet.hashio.io/api';
export const HEDERA_CHAIN_ID = 296;
export const MIRROR_NODE = 'https://testnet.mirrornode.hedera.com';
export const HCS_TOPIC_ID = '0.0.8157255';

export const RECEIPT_FACTORY_ABI = [
  'function mintReceipt(address custodian, address farmer, string commodityType, uint256 weightKg, uint8 grade, string warehouseId, string mpesaRef, uint256 hcsSequenceNumber, uint256 initialValuationKes, string metadataURI) returns (uint256)',
  'function getReceipt(uint256 tokenId) view returns (tuple(uint256 tokenId, address custodian, address farmer, string commodityType, uint256 weightKg, uint8 grade, string warehouseId, string mpesaRef, uint256 hcsSequenceNumber, uint256 valuationKes, uint256 issuedAt, uint256 expiryTimestamp, uint8 status, string metadataURI))',
  'function isActive(uint256 tokenId) view returns (bool)',
  'function getValuation(uint256 tokenId) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function approve(address to, uint256 tokenId)',
  'event ReceiptMinted(uint256 indexed tokenId, address indexed custodian, string commodityType, uint256 weightKg, uint8 grade, string warehouseId, string mpesaRef, uint256 hcsSequenceNumber, uint256 valuationKes)',
] as const;

export const COLLATERAL_VAULT_ABI = [
  'function lockCollateral(uint256 tokenId) returns (uint256 loanId)',
  'function issueLoan(uint256 loanId, uint256 ltvBps)',
  'function repayLoan(uint256 loanId)',
  'function liquidate(uint256 loanId)',
  'function getLoan(uint256 loanId) view returns (tuple(uint256 loanId, uint256 tokenId, address borrower, uint256 principal, uint256 interestAccrued, uint256 collateralKes, uint256 ltvBps, uint256 openedAt, uint256 dueAt, uint256 repaidAt, uint8 status))',
  'function getCurrentLtv(uint256 loanId) view returns (uint256)',
  'function getTotalOwed(uint256 loanId) view returns (uint256)',
  'function getMaxLoan(uint256 tokenId) view returns (uint256)',
  'function tokenToLoan(uint256 tokenId) view returns (uint256)',
  'function depositLiquidity(uint256 amount)',
  'event LoanIssued(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 ltvBps, uint256 dueAt)',
  'event CollateralLocked(uint256 indexed loanId, uint256 indexed tokenId, address indexed borrower, uint256 collateralKes)',
] as const;

export const SUPRA_PRICE_FEED_ABI = [
  'function getMaizePriceKes() view returns (uint256 price, uint256 timestamp)',
  'function isStale() view returns (bool)',
  'function setManualPrice(uint256 priceKes)',
] as const;

export const RISK_MARKET_ABI = [
  'function createMarket(uint256 tokenId, uint256 loanId, uint256 duration) returns (uint256)',
  'function takePosition(uint256 marketId, bool isYes, uint256 amount)',
  'function resolveMarket(uint256 marketId)',
  'function claimPayout(uint256 marketId, uint256 positionId)',
  'function getMarketInfo(uint256 marketId) view returns (tuple(uint256 marketId, uint256 tokenId, uint256 loanId, address creator, uint256 createdAt, uint256 deadline, uint8 status, uint8 outcome))',
  'function getMarketFinancials(uint256 marketId) view returns (tuple(uint256 yesPool, uint256 noPool, uint256 totalPool, uint256 resolvedAt, uint256 finalLtvBps, string resolutionNote, uint256 protocolFeeCollected))',
  'function tokenActiveMarket(uint256 tokenId) view returns (uint256)',
  'function getMarketOdds(uint256 marketId) view returns (uint256 yesPool, uint256 noPool, uint256 impliedYesProbBps)',
] as const;

export const FORWARD_MARKET_ABI = [
  'function placeBid(uint256 tokenId, uint256 offerUsdcH, uint256 settlementDate, string buyerRef) returns (uint256)',
  'function acceptBid(uint256 bidId)',
  'function settle(uint256 bidId)',
  'function cancelBid(uint256 bidId)',
  'function getBid(uint256 bidId) view returns (tuple(uint256 bidId, uint8 bidType, uint8 status, address buyer, string buyerRef, uint256 tokenId, string commodityType, uint256 minWeightKg, uint8 minGrade, uint256 offerUsdcH, uint256 upfrontUsdcH, uint256 escrowedUsdcH, uint256 placedAt, uint256 settlementDate, uint256 acceptedAt, uint256 settledAt, address farmer))',
] as const;

export const SHAMBA_TOKEN_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function qualifiesForDiscount(address account) view returns (bool)',
] as const;

export function getProvider() {
  return new ethers.JsonRpcProvider(HEDERA_TESTNET_RPC);
}

export function getSigner(privateKey?: string) {
  const provider = getProvider();
  if (privateKey) return new ethers.Wallet(privateKey, provider);
  // In browser with MetaMask / HashPack
  if (typeof window !== 'undefined' && (window as any).ethereum) {
    const web3Provider = new ethers.BrowserProvider((window as any).ethereum);
    return web3Provider.getSigner();
  }
  return null;
}

export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:3000';