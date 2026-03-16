// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ICollateralVault
 * @notice Interface for the ShambaChain CollateralVault — USDC-H micro-lending
 *         against oCR NFT collateral.
 * @dev Consumed by: RiskOracle, RiskMarket, ShambaToken (reward hooks).
 */
interface ICollateralVault {

    // ─── ENUMS ───────────────────────────────────────────────────────────

    enum LoanStatus { None, Active, Repaid, Liquidated, Defaulted }

    // ─── STRUCTS ──────────────────────────────────────────────────────────

    struct Loan {
        uint256     loanId;
        uint256     tokenId;
        address     borrower;
        uint256     principal;
        uint256     interestAccrued;
        uint256     collateralKes;
        uint256     ltvBps;
        uint256     openedAt;
        uint256     dueAt;
        uint256     repaidAt;
        LoanStatus  status;
    }

    struct VaultConfig {
        uint256 annualInterestBps;
        uint256 maxLtvBps;
        uint256 liquidationLtvBps;
        uint256 loanDurationSeconds;
        bool    oracleRequired;
    }

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event CollateralLocked(
        uint256 indexed loanId,
        uint256 indexed tokenId,
        address indexed borrower,
        uint256         collateralKes
    );

    event LoanIssued(
        uint256 indexed loanId,
        address indexed borrower,
        uint256         principal,
        uint256         ltvBps,
        uint256         dueAt
    );

    event LoanRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        uint256         principal,
        uint256         interest,
        uint256         timestamp
    );

    event LoanLiquidated(
        uint256 indexed loanId,
        uint256 indexed tokenId,
        address indexed liquidator,
        uint256         debtAtLiquidation,
        uint256         timestamp
    );

    event CollateralUnlocked(uint256 indexed loanId, uint256 indexed tokenId);

    event ValuationAlert(
        uint256 indexed loanId,
        uint256 indexed tokenId,
        uint256         currentLtvBps,
        uint256         liquidationLtvBps
    );

    event ConfigUpdated(VaultConfig newConfig);

    // ─── ERRORS ───────────────────────────────────────────────────────────

    error ReceiptNotActive(uint256 tokenId);
    error ReceiptAlreadyCollateral(uint256 tokenId);
    error LoanAlreadyExists(uint256 loanId);
    error LoanNotActive(uint256 loanId);
    error LtvTooHigh(uint256 requestedBps, uint256 maxBps);
    error InsufficientVaultLiquidity(uint256 requested, uint256 available);
    error NotLiquidatable(uint256 currentLtvBps, uint256 thresholdBps);
    error NotBorrower(address caller, address borrower);
    error OraclePriceStale();
    error LoanExpired(uint256 loanId, uint256 dueAt);
    error ZeroPrincipal();
    error NotReceiptOwner();

    // ─── WRITE ────────────────────────────────────────────────────────────

    function lockCollateral(uint256 tokenId) external returns (uint256 loanId);

    function issueLoan(uint256 loanId, uint256 ltvBps) external;

    function repayLoan(uint256 loanId) external;

    function liquidate(uint256 loanId) external;

    function checkLoanHealth(uint256 loanId) external;

    function depositLiquidity(uint256 amount) external;

    function updateConfig(VaultConfig calldata newConfig) external;

    // ─── READ ─────────────────────────────────────────────────────────────

    function getLoan(uint256 loanId) external view returns (Loan memory);

    function getCurrentLtv(uint256 loanId) external view returns (uint256 ltvBps);

    function getMaxLoan(uint256 tokenId) external view returns (uint256 maxUsdcH);

    function getTotalOwed(uint256 loanId) external view returns (uint256);

    function getBorrowerLoans(address borrower) external view returns (uint256[] memory);

    function tokenToLoan(uint256 tokenId) external view returns (uint256);

    function config() external view returns (VaultConfig memory);
}
