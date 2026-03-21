import { ethers } from "ethers";
import { EVM_RPC_URL, HEDERA_PRIVATE_KEY } from "./hedera";
import * as dotenv from "dotenv";
dotenv.config();

export const CONTRACT_ADDRESSES = {
  receiptFactory:  process.env.RECEIPT_FACTORY_ADDRESS  ?? "",
  collateralVault: process.env.COLLATERAL_VAULT_ADDRESS ?? "",
  forwardMarket:   process.env.FORWARD_MARKET_ADDRESS   ?? "",
  riskMarket:      process.env.RISK_MARKET_ADDRESS      ?? "",
  riskOracle:      process.env.RISK_ORACLE_ADDRESS      ?? "",
  hedgePosition:   process.env.HEDGE_POSITION_ADDRESS   ?? "",
  supraPriceFeed:  process.env.SUPRA_PRICE_FEED_ADDRESS ?? "",
  shambaToken:     process.env.SHAMBA_TOKEN_ADDRESS     ?? "",
  usdcH:           process.env.USDC_H_ADDRESS           ?? "",
  treasury:        process.env.TREASURY_ADDRESS         ?? "",
} as const;

export const provider = new ethers.JsonRpcProvider(EVM_RPC_URL);
export const signer   = new ethers.Wallet(HEDERA_PRIVATE_KEY, provider);


export const RECEIPT_FACTORY_ABI = [
  // mintReceipt(custodian, farmer, commodityType, weightKg, grade, warehouseId, mpesaRef, hcsSequenceNumber, initialValuationKes, metadataURI)
  "function mintReceipt(address custodian, address farmer, string commodityType, uint256 weightKg, uint8 grade, string warehouseId, string mpesaRef, uint256 hcsSequenceNumber, uint256 initialValuationKes, string metadataURI) returns (uint256 tokenId)",
  "function getReceipt(uint256 tokenId) view returns (tuple(uint256 tokenId, address custodian, address farmer, string commodityType, uint256 weightKg, uint8 grade, string warehouseId, string mpesaRef, uint256 hcsSequenceNumber, uint256 valuationKes, uint256 issuedAt, uint256 expiryTimestamp, uint8 status, string metadataURI))",
  "function isActive(uint256 tokenId) view returns (bool)",
  "function getValuation(uint256 tokenId) view returns (uint256)",
  "function updateValuation(uint256 tokenId, uint256 newValuationKes)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function approve(address to, uint256 tokenId)",
  "function grantRole(bytes32 role, address account)",
  "function MINTER_ROLE() view returns (bytes32)",
  "event ReceiptMinted(uint256 indexed tokenId, address indexed custodian, string commodityType, uint256 weightKg, uint8 grade, string warehouseId, string mpesaRef, uint256 hcsSequenceNumber, uint256 valuationKes)",
] as const;

export const COLLATERAL_VAULT_ABI = [
  "function lockCollateral(uint256 tokenId) returns (uint256 loanId)",
  "function issueLoan(uint256 loanId, uint256 ltvBps)",
  "function repayLoan(uint256 loanId)",
  "function liquidate(uint256 loanId)",
  "function getLoan(uint256 loanId) view returns (tuple(uint256 loanId, uint256 tokenId, address borrower, uint256 principal, uint256 interestAccrued, uint256 collateralKes, uint256 ltvBps, uint256 openedAt, uint256 dueAt, uint256 repaidAt, uint8 status))",
  "function getCurrentLtv(uint256 loanId) view returns (uint256 ltvBps)",
  "function getTotalOwed(uint256 loanId) view returns (uint256)",
  "function getMaxLoan(uint256 tokenId) view returns (uint256 maxUsdcH)",
  "function getBorrowerLoans(address borrower) view returns (uint256[])",
  "function tokenToLoan(uint256 tokenId) view returns (uint256 loanId)",
  "function depositLiquidity(uint256 amount)",
  "event LoanIssued(uint256 indexed loanId, address indexed borrower, uint256 principal, uint256 ltvBps, uint256 dueAt)",
  "event LoanLiquidated(uint256 indexed loanId, uint256 indexed tokenId, address indexed liquidator, uint256 debtAtLiquidation, uint256 timestamp)",
  "event CollateralLocked(uint256 indexed loanId, uint256 indexed tokenId, address indexed borrower, uint256 collateralKes)",
] as const;

export const SUPRA_PRICE_FEED_ABI = [
  "function getMaizePriceKes() view returns (uint256 price, uint256 timestamp)",
  "function isStale() view returns (bool)",
  "function setManualPrice(uint256 priceKes)",
  "function getOracleInfo() view returns (uint256 price, uint256 timestamp, uint256 ageSeconds, bool stale, bool inTestnetMode, uint256 updates, uint256 hcsSequence)",
] as const;

export const RISK_ORACLE_ABI = [
  "function triggerValuationUpdate(uint256[] tokenIds, bytes supraProof, uint256 hcsSequence)",
  "function setManualPrice(uint256 maizeKesPerKg)",
  "function isPriceStale() view returns (bool)",
  "function getLatestPrice() view returns (uint256 price, uint256 timestamp, bool stale)",
  "function latestMaizeKes() view returns (uint256)",
] as const;

export const RISK_MARKET_ABI = [
  "function createMarket(uint256 tokenId, uint256 loanId, uint256 duration) returns (uint256 marketId)",
  "function resolveMarket(uint256 marketId)",
  "function takePosition(uint256 marketId, bool isYes, uint256 amount)",
  "function claimPayout(uint256 marketId, uint256 positionId)",
  "function getMarket(uint256 marketId) view returns (tuple(uint256 marketId, uint256 tokenId, uint256 loanId, address creator, uint256 createdAt, uint256 deadline, uint8 status, uint8 outcome, uint256 yesPool, uint256 noPool, uint256 totalPool, uint256 resolvedAt, uint256 finalLtvBps, string resolutionNote, uint256 protocolFeeCollected))",
  "function tokenActiveMarket(uint256 tokenId) view returns (uint256 marketId)",
  "function getMarketOdds(uint256 marketId) view returns (uint256 yesPool, uint256 noPool, uint256 impliedYesProbBps)",
] as const;

export const HEDGE_POSITION_ABI = [
  "function buyHedge(uint256 ocrTokenId, uint256 weightKg, uint256 strikePriceKes, uint256 durationSecs) returns (uint256 hedgeId)",
  "function exerciseHedge(uint256 hedgeId)",
  "function expireHedge(uint256 hedgeId)",
  "function getHedge(uint256 hedgeId) view returns (tuple(uint256 hedgeId, uint256 ocrTokenId, address buyer, uint256 weightKg, uint256 strikePriceKes, uint256 purchasePriceKes, uint256 premiumUsdcH, uint256 maxPayoutUsdcH, uint256 purchasedAt, uint256 expiryDate, uint8 status, uint256 exercisedAt, uint256 payoutUsdcH, uint256 settlementPriceKes))",
  "function tokenActiveHedge(uint256 ocrTokenId) view returns (uint256 hedgeId)",
  "function estimatePayout(uint256 hedgeId) view returns (uint256 estimatedUsdcH, bool inTheMoney)",
] as const;

export const SHAMBA_TOKEN_ABI = [
  "function rewardPriceUpdate(address agent)",
  "function rewardLoanIssuance(address agent)",
  "function rewardRiskCheck(address agent)",
  "function rewardLiquidation(address agent)",
  "function balanceOf(address account) view returns (uint256)",
  "function qualifiesForDiscount(address account) view returns (bool)",
] as const;

export function getReceiptFactory(readonly = false) {
  return new ethers.Contract(CONTRACT_ADDRESSES.receiptFactory, RECEIPT_FACTORY_ABI, readonly ? provider : signer);
}
export function getCollateralVault() {
  return new ethers.Contract(CONTRACT_ADDRESSES.collateralVault, COLLATERAL_VAULT_ABI, signer);
}
export function getRiskOracle() {
  return new ethers.Contract(CONTRACT_ADDRESSES.riskOracle, RISK_ORACLE_ABI, signer);
}
export function getSupraPriceFeed() {
  return new ethers.Contract(CONTRACT_ADDRESSES.supraPriceFeed, SUPRA_PRICE_FEED_ABI, provider);
}
export function getRiskMarket() {
  return new ethers.Contract(CONTRACT_ADDRESSES.riskMarket, RISK_MARKET_ABI, signer);
}
export function getHedgePosition() {
  return new ethers.Contract(CONTRACT_ADDRESSES.hedgePosition, HEDGE_POSITION_ABI, signer);
}
export function getShambaToken() {
  return new ethers.Contract(CONTRACT_ADDRESSES.shambaToken, SHAMBA_TOKEN_ABI, signer);
}
