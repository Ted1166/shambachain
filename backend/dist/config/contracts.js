"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SHAMBA_TOKEN_ABI = exports.HEDGE_POSITION_ABI = exports.RISK_MARKET_ABI = exports.RISK_ORACLE_ABI = exports.SUPRA_PRICE_FEED_ABI = exports.COLLATERAL_VAULT_ABI = exports.RECEIPT_FACTORY_ABI = exports.signer = exports.provider = exports.CONTRACT_ADDRESSES = void 0;
exports.getReceiptFactory = getReceiptFactory;
exports.getCollateralVault = getCollateralVault;
exports.getRiskOracle = getRiskOracle;
exports.getSupraPriceFeed = getSupraPriceFeed;
exports.getRiskMarket = getRiskMarket;
exports.getHedgePosition = getHedgePosition;
exports.getShambaToken = getShambaToken;
const ethers_1 = require("ethers");
const hedera_1 = require("./hedera");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
exports.CONTRACT_ADDRESSES = {
    receiptFactory: process.env.RECEIPT_FACTORY_ADDRESS ?? "",
    collateralVault: process.env.COLLATERAL_VAULT_ADDRESS ?? "",
    forwardMarket: process.env.FORWARD_MARKET_ADDRESS ?? "",
    riskMarket: process.env.RISK_MARKET_ADDRESS ?? "",
    riskOracle: process.env.RISK_ORACLE_ADDRESS ?? "",
    hedgePosition: process.env.HEDGE_POSITION_ADDRESS ?? "",
    supraPriceFeed: process.env.SUPRA_PRICE_FEED_ADDRESS ?? "",
    shambaToken: process.env.SHAMBA_TOKEN_ADDRESS ?? "",
    usdcH: process.env.USDC_H_ADDRESS ?? "",
    treasury: process.env.TREASURY_ADDRESS ?? "",
};
exports.provider = new ethers_1.ethers.JsonRpcProvider(hedera_1.EVM_RPC_URL);
exports.signer = new ethers_1.ethers.Wallet(hedera_1.HEDERA_PRIVATE_KEY, exports.provider);
exports.RECEIPT_FACTORY_ABI = [
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
];
exports.COLLATERAL_VAULT_ABI = [
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
];
exports.SUPRA_PRICE_FEED_ABI = [
    "function getMaizePriceKes() view returns (uint256 price, uint256 timestamp)",
    "function isStale() view returns (bool)",
    "function setManualPrice(uint256 priceKes)",
    "function getOracleInfo() view returns (uint256 price, uint256 timestamp, uint256 ageSeconds, bool stale, bool inTestnetMode, uint256 updates, uint256 hcsSequence)",
];
exports.RISK_ORACLE_ABI = [
    "function triggerValuationUpdate(uint256[] tokenIds, bytes supraProof, uint256 hcsSequence)",
    "function setManualPrice(uint256 maizeKesPerKg)",
    "function isPriceStale() view returns (bool)",
    "function getLatestPrice() view returns (uint256 price, uint256 timestamp, bool stale)",
    "function latestMaizeKes() view returns (uint256)",
];
exports.RISK_MARKET_ABI = [
    "function createMarket(uint256 tokenId, uint256 loanId, uint256 duration) returns (uint256 marketId)",
    "function resolveMarket(uint256 marketId)",
    "function getMarket(uint256 marketId) view returns (tuple(uint256 marketId, uint256 tokenId, uint256 loanId, address creator, uint256 createdAt, uint256 deadline, uint8 status, uint8 outcome, uint256 yesPool, uint256 noPool, uint256 totalPool, uint256 resolvedAt, uint256 finalLtvBps, string resolutionNote, uint256 protocolFeeCollected))",
    "function tokenActiveMarket(uint256 tokenId) view returns (uint256 marketId)",
    "function getMarketOdds(uint256 marketId) view returns (uint256 yesPool, uint256 noPool, uint256 impliedYesProbBps)",
];
exports.HEDGE_POSITION_ABI = [
    "function buyHedge(uint256 ocrTokenId, uint256 weightKg, uint256 strikePriceKes, uint256 durationSecs) returns (uint256 hedgeId)",
    "function exerciseHedge(uint256 hedgeId)",
    "function expireHedge(uint256 hedgeId)",
    "function getHedge(uint256 hedgeId) view returns (tuple(uint256 hedgeId, uint256 ocrTokenId, address buyer, uint256 weightKg, uint256 strikePriceKes, uint256 purchasePriceKes, uint256 premiumUsdcH, uint256 maxPayoutUsdcH, uint256 purchasedAt, uint256 expiryDate, uint8 status, uint256 exercisedAt, uint256 payoutUsdcH, uint256 settlementPriceKes))",
    "function tokenActiveHedge(uint256 ocrTokenId) view returns (uint256 hedgeId)",
    "function estimatePayout(uint256 hedgeId) view returns (uint256 estimatedUsdcH, bool inTheMoney)",
];
exports.SHAMBA_TOKEN_ABI = [
    "function rewardPriceUpdate(address agent)",
    "function rewardLoanIssuance(address agent)",
    "function rewardRiskCheck(address agent)",
    "function rewardLiquidation(address agent)",
    "function balanceOf(address account) view returns (uint256)",
    "function qualifiesForDiscount(address account) view returns (bool)",
];
function getReceiptFactory(readonly = false) {
    return new ethers_1.ethers.Contract(exports.CONTRACT_ADDRESSES.receiptFactory, exports.RECEIPT_FACTORY_ABI, readonly ? exports.provider : exports.signer);
}
function getCollateralVault() {
    return new ethers_1.ethers.Contract(exports.CONTRACT_ADDRESSES.collateralVault, exports.COLLATERAL_VAULT_ABI, exports.signer);
}
function getRiskOracle() {
    return new ethers_1.ethers.Contract(exports.CONTRACT_ADDRESSES.riskOracle, exports.RISK_ORACLE_ABI, exports.signer);
}
function getSupraPriceFeed() {
    return new ethers_1.ethers.Contract(exports.CONTRACT_ADDRESSES.supraPriceFeed, exports.SUPRA_PRICE_FEED_ABI, exports.provider);
}
function getRiskMarket() {
    return new ethers_1.ethers.Contract(exports.CONTRACT_ADDRESSES.riskMarket, exports.RISK_MARKET_ABI, exports.signer);
}
function getHedgePosition() {
    return new ethers_1.ethers.Contract(exports.CONTRACT_ADDRESSES.hedgePosition, exports.HEDGE_POSITION_ABI, exports.signer);
}
function getShambaToken() {
    return new ethers_1.ethers.Contract(exports.CONTRACT_ADDRESSES.shambaToken, exports.SHAMBA_TOKEN_ABI, exports.signer);
}
//# sourceMappingURL=contracts.js.map