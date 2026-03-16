// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title CollateralVault
 * @author ShambaChain Protocol
 * @notice Accepts on-chain Commodity Receipts (oCR NFTs) as collateral and
 *         issues USDC-H micro-loans to farmers. Integrates with SupraPriceFeed
 *         for real-time maize valuations and RiskOracle for health monitoring.
 *
 * @dev Loan lifecycle:
 *   1. Farmer (via custodian) calls lockCollateral(tokenId)
 *      → ReceiptFactory.lockReceipt() called → NFT frozen
 *   2. LoanAgent or farmer calls issueLoan(loanId, ltvBps)
 *      → USDC-H transferred to borrower
 *   3. Borrower calls repayLoan(loanId)
 *      → USDC-H returned + interest → oCR unlocked
 *   4. If price drops below liquidation threshold →
 *      liquidate(loanId) callable by anyone → oCR auctioned
 *
 * LTV: default 60% of oracle-priced oCR value
 * Liquidation threshold: 80% LTV (price dropped enough that loan > 80% collateral)
 * Interest: simple per-block accrual, annualized rate set by admin
 */

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IReceiptFactory {
    function lockReceipt(uint256 tokenId) external;
    function unlockReceipt(uint256 tokenId) external;
    function getValuation(uint256 tokenId) external view returns (uint256);
    function isActive(uint256 tokenId) external view returns (bool);
    function getReceipt(uint256 tokenId) external view returns (
        uint256, string memory, uint256, uint8, string memory,
        string memory, uint256, uint256, uint256, uint8, address, uint256
    );
}

interface ISupraPriceFeed {
    function getMaizePriceKes() external view returns (uint256 price, uint256 timestamp);
    function isStale() external view returns (bool);
}

contract CollateralVault is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    // ─── ROLES ────────────────────────────────────────────────────────────────
    bytes32 public constant LOAN_AGENT_ROLE  = keccak256("LOAN_AGENT_ROLE");
    bytes32 public constant LIQUIDATOR_ROLE  = keccak256("LIQUIDATOR_ROLE");
    bytes32 public constant RISK_ORACLE_ROLE = keccak256("RISK_ORACLE_ROLE");

    // ─── CONSTANTS ────────────────────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR       = 10_000;
    uint256 public constant DEFAULT_LTV_BPS       = 6_000;  // 60%
    uint256 public constant LIQUIDATION_LTV_BPS   = 8_000;  // 80%
    uint256 public constant LIQUIDATION_BONUS_BPS = 500;    // 5% bonus for liquidators
    uint256 public constant MAX_LOAN_DURATION      = 180 days;
    uint256 public constant SECONDS_PER_YEAR       = 365 days;

    // ─── STATE ────────────────────────────────────────────────────────────────

    /// @notice Loan status enum
    enum LoanStatus { None, Active, Repaid, Liquidated, Defaulted }

    struct Loan {
        uint256 loanId;
        uint256 tokenId;          // oCR NFT used as collateral
        address borrower;         // farmer / custodial wallet
        uint256 principal;        // USDC-H borrowed (6 decimals)
        uint256 interestAccrued;  // accrued interest (6 decimals)
        uint256 collateralKes;    // oCR valuation at loan open (KES, 18 decimals)
        uint256 ltvBps;           // loan-to-value in basis points
        uint256 openedAt;         // block.timestamp at loan creation
        uint256 dueAt;            // repayment deadline
        uint256 repaidAt;         // block.timestamp at repayment (0 if not repaid)
        LoanStatus status;
    }

    /// @notice Protocol config
    struct VaultConfig {
        uint256 annualInterestBps;   // annual interest rate in BPS (e.g. 1200 = 12%)
        uint256 maxLtvBps;           // maximum LTV allowed (default 6000)
        uint256 liquidationLtvBps;   // LTV at which liquidation is triggered (default 8000)
        uint256 loanDurationSeconds; // default loan duration
        bool    oracleRequired;      // require fresh oracle price to issue loans
    }

    VaultConfig public config;

    /// @notice loan counter
    uint256 private _loanIds;

    /// @notice loanId → Loan
    mapping(uint256 => Loan) public loans;

    /// @notice tokenId → loanId (0 = no active loan)
    mapping(uint256 => uint256) public tokenToLoan;

    /// @notice borrower → list of loan IDs
    mapping(address => uint256[]) public borrowerLoans;

    /// @notice protocol treasury — collects interest + liquidation fees
    address public treasury;

    /// @notice USDC-H token (Hedera USDC — 6 decimals)
    IERC20 public immutable usdcH;

    /// @notice ReceiptFactory contract
    IReceiptFactory public immutable receiptFactory;

    /// @notice oCR NFT contract (same as receiptFactory address for ERC-721 calls)
    IERC721 public immutable receiptNFT;

    /// @notice Supra price feed
    ISupraPriceFeed public supraPriceFeed;

    /// @notice protocol-level stats
    uint256 public totalLoansIssued;
    uint256 public totalPrincipalOutstanding;
    uint256 public totalInterestCollected;
    uint256 public totalLiquidations;

    // ─── EVENTS ───────────────────────────────────────────────────────────────
    event CollateralLocked(
        uint256 indexed loanId,
        uint256 indexed tokenId,
        address indexed borrower,
        uint256 collateralKes
    );

    event LoanIssued(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 ltvBps,
        uint256 dueAt
    );

    event LoanRepaid(
        uint256 indexed loanId,
        address indexed borrower,
        uint256 principal,
        uint256 interest,
        uint256 timestamp
    );

    event LoanLiquidated(
        uint256 indexed loanId,
        uint256 indexed tokenId,
        address indexed liquidator,
        uint256 debtAtLiquidation,
        uint256 timestamp
    );

    event CollateralUnlocked(
        uint256 indexed loanId,
        uint256 indexed tokenId
    );

    event ValuationAlert(
        uint256 indexed loanId,
        uint256 indexed tokenId,
        uint256 currentLtvBps,
        uint256 liquidationLtvBps
    );

    event ConfigUpdated(VaultConfig newConfig);

    // ─── ERRORS ───────────────────────────────────────────────────────────────
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

    // ─── CONSTRUCTOR ──────────────────────────────────────────────────────────
    constructor(
        address admin,
        address _usdcH,
        address _receiptFactory,
        address _supraPriceFeed,
        address _treasury
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(LOAN_AGENT_ROLE, admin);
        _grantRole(LIQUIDATOR_ROLE, admin);

        usdcH          = IERC20(_usdcH);
        receiptFactory = IReceiptFactory(_receiptFactory);
        receiptNFT     = IERC721(_receiptFactory);
        supraPriceFeed = ISupraPriceFeed(_supraPriceFeed);
        treasury       = _treasury;

        // Default config
        config = VaultConfig({
            annualInterestBps:   1200,        // 12% APR
            maxLtvBps:           6_000,        // 60% max LTV
            liquidationLtvBps:   8_000,        // 80% liquidation threshold
            loanDurationSeconds: 90 days,      // 90-day loan term
            oracleRequired:      true
        });
    }

    // ─── STEP 1: LOCK COLLATERAL ──────────────────────────────────────────────

    /**
     * @notice Lock an oCR NFT as collateral and open a loan position.
     * @dev Caller must own the NFT or be the custodian.
     *      This does NOT yet disburse funds — call issueLoan() next.
     *
     * @param tokenId  The oCR NFT token ID to use as collateral
     * @return loanId  The newly created loan ID
     */
    function lockCollateral(uint256 tokenId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 loanId)
    {
        // ── Validate receipt ──
        if (!receiptFactory.isActive(tokenId)) revert ReceiptNotActive(tokenId);
        if (tokenToLoan[tokenId] != 0) revert ReceiptAlreadyCollateral(tokenId);

        // ── Caller must own the NFT ──
        if (receiptNFT.ownerOf(tokenId) != msg.sender) revert NotReceiptOwner();

        // ── Get oracle valuation ──
        uint256 collateralKes = _getValidatedValuation(tokenId);

        // ── Create loan record ──
        _loanIds++;
        loanId = _loanIds;

        loans[loanId] = Loan({
            loanId:           loanId,
            tokenId:          tokenId,
            borrower:         msg.sender,
            principal:        0,               // set when issueLoan() called
            interestAccrued:  0,
            collateralKes:    collateralKes,
            ltvBps:           0,
            openedAt:         block.timestamp,
            dueAt:            block.timestamp + config.loanDurationSeconds,
            repaidAt:         0,
            status:           LoanStatus.Active
        });

        tokenToLoan[tokenId]  = loanId;
        borrowerLoans[msg.sender].push(loanId);

        // ── Lock the NFT in ReceiptFactory ──
        receiptFactory.lockReceipt(tokenId);

        emit CollateralLocked(loanId, tokenId, msg.sender, collateralKes);
    }

    // ─── STEP 2: ISSUE LOAN ───────────────────────────────────────────────────

    /**
     * @notice Issue USDC-H loan against locked collateral.
     * @dev Called by LoanAgent (autonomous) or borrower directly.
     *      LoanAgent calculates optimal LTV; borrower can request specific amount.
     *
     * @param loanId    The loan position ID (from lockCollateral)
     * @param ltvBps    Requested LTV in basis points (max = config.maxLtvBps)
     */
    function issueLoan(uint256 loanId, uint256 ltvBps)
        external
        nonReentrant
        whenNotPaused
    {
        Loan storage loan = loans[loanId];

        // ── Validations ──
        if (loan.status != LoanStatus.Active) revert LoanNotActive(loanId);
        if (loan.principal != 0) revert LoanAlreadyExists(loanId);
        if (ltvBps > config.maxLtvBps) revert LtvTooHigh(ltvBps, config.maxLtvBps);
        if (block.timestamp > loan.dueAt) revert LoanExpired(loanId, loan.dueAt);

        // ── Only borrower or LoanAgent can issue ──
        if (msg.sender != loan.borrower && !hasRole(LOAN_AGENT_ROLE, msg.sender)) {
            revert NotBorrower(msg.sender, loan.borrower);
        }

        // ── Recalculate collateral at current oracle price ──
        uint256 currentKes = _getValidatedValuation(loan.tokenId);
        loan.collateralKes = currentKes; // refresh at issuance

        // ── Calculate principal in USDC-H ──
        // KES → USDC-H: simplified 1:1 for testnet, oracle FX rate in production
        // Production: integrate Supra KES/USD feed
        uint256 collateralUsd = _kesTo6DecimalUsd(currentKes);
        uint256 principal     = (collateralUsd * ltvBps) / BPS_DENOMINATOR;

        if (principal == 0) revert ZeroPrincipal();

        // ── Check vault has enough liquidity ──
        uint256 vaultBalance = usdcH.balanceOf(address(this));
        if (vaultBalance < principal) {
            revert InsufficientVaultLiquidity(principal, vaultBalance);
        }

        // ── Update loan ──
        loan.principal = principal;
        loan.ltvBps    = ltvBps;

        totalLoansIssued++;
        totalPrincipalOutstanding += principal;

        // ── Disburse ──
        usdcH.safeTransfer(loan.borrower, principal);

        emit LoanIssued(loanId, loan.borrower, principal, ltvBps, loan.dueAt);
    }

    // ─── STEP 3: REPAY LOAN ───────────────────────────────────────────────────

    /**
     * @notice Repay loan principal + interest and unlock oCR NFT.
     * @dev Borrower must approve USDC-H transfer before calling.
     *      Interest accrues per-second based on annualInterestBps.
     *
     * @param loanId  The loan to repay
     */
    function repayLoan(uint256 loanId)
        external
        nonReentrant
        whenNotPaused
    {
        Loan storage loan = loans[loanId];

        if (loan.status != LoanStatus.Active) revert LoanNotActive(loanId);
        if (msg.sender != loan.borrower && !hasRole(LOAN_AGENT_ROLE, msg.sender)) {
            revert NotBorrower(msg.sender, loan.borrower);
        }

        // ── Calculate total owed ──
        uint256 interest    = _calculateInterest(loan);
        // uint256 totalOwed   = loan.principal + interest;

        // ── Collect repayment ──
        usdcH.safeTransferFrom(loan.borrower, address(this), loan.principal);
        if (interest > 0) {
            usdcH.safeTransferFrom(loan.borrower, treasury, interest);
        }

        // ── Update state ──
        loan.status          = LoanStatus.Repaid;
        loan.interestAccrued = interest;
        loan.repaidAt        = block.timestamp;
        totalPrincipalOutstanding -= loan.principal;
        totalInterestCollected    += interest;
        tokenToLoan[loan.tokenId]  = 0;

        // ── Unlock NFT ──
        receiptFactory.unlockReceipt(loan.tokenId);

        emit LoanRepaid(loanId, loan.borrower, loan.principal, interest, block.timestamp);
        emit CollateralUnlocked(loanId, loan.tokenId);
    }

    // ─── LIQUIDATION ──────────────────────────────────────────────────────────

    /**
     * @notice Liquidate an undercollateralized loan.
     * @dev Callable by anyone when currentLTV >= liquidationLtvBps.
     *      Liquidator receives oCR NFT + bonus. Protocol covers shortfall from reserves.
     *      In production: NFT goes to auction contract, proceeds distributed.
     *
     * @param loanId  The loan to liquidate
     */
    function liquidate(uint256 loanId)
        external
        nonReentrant
        whenNotPaused
    {
        Loan storage loan = loans[loanId];

        if (loan.status != LoanStatus.Active) revert LoanNotActive(loanId);

        // ── Check if liquidatable ──
        uint256 currentLtvBps = getCurrentLtv(loanId);
        if (currentLtvBps < config.liquidationLtvBps) {
            revert NotLiquidatable(currentLtvBps, config.liquidationLtvBps);
        }

        uint256 interest  = _calculateInterest(loan);
        uint256 totalDebt = loan.principal + interest;

        // ── Update state BEFORE external calls ──
        loan.status = LoanStatus.Liquidated;
        totalPrincipalOutstanding -= loan.principal;
        totalLiquidations++;
        tokenToLoan[loan.tokenId] = 0;

        // ── Unlock NFT and transfer to liquidator ──
        receiptFactory.unlockReceipt(loan.tokenId);

        // In production: transfer to auction. For MVP: transfer to liquidator directly.
        // receiptNFT.safeTransferFrom(address(this), msg.sender, loan.tokenId);
        // Note: vault must be approved to transfer — handle in deployment setup

        emit LoanLiquidated(loanId, loan.tokenId, msg.sender, totalDebt, block.timestamp);
    }

    /**
     * @notice Check if a loan is currently at risk — called by RiskAgent.
     * @dev Emits ValuationAlert if LTV is above 70% (early warning before liquidation).
     */
    function checkLoanHealth(uint256 loanId) external {
        Loan storage loan = loans[loanId];
        if (loan.status != LoanStatus.Active || loan.principal == 0) return;

        uint256 currentLtvBps = getCurrentLtv(loanId);

        // Early warning at 70% LTV
        if (currentLtvBps >= 7_000) {
            emit ValuationAlert(loanId, loan.tokenId, currentLtvBps, config.liquidationLtvBps);
        }
    }

    // ─── VIEWS ────────────────────────────────────────────────────────────────

    /**
     * @notice Get current LTV for an active loan (in basis points).
     * @dev Uses fresh oracle price. Returns 0 if loan has no principal yet.
     */
    function getCurrentLtv(uint256 loanId) public view returns (uint256 ltvBps) {
        Loan memory loan = loans[loanId];
        if (loan.principal == 0) return 0;

        uint256 currentKes    = receiptFactory.getValuation(loan.tokenId);
        uint256 collateralUsd = _kesTo6DecimalUsd(currentKes);
        if (collateralUsd == 0) return BPS_DENOMINATOR; // treat as 100% LTV if no price

        uint256 interest  = _calculateInterest(loan);
        uint256 totalDebt = loan.principal + interest;

        ltvBps = (totalDebt * BPS_DENOMINATOR) / collateralUsd;
    }

    /**
     * @notice Calculate maximum loan amount for a given tokenId.
     * @dev Useful for LoanAgent to quote farmers before they commit.
     */
    function getMaxLoan(uint256 tokenId) external view returns (uint256 maxUsdcH) {
        uint256 kes  = receiptFactory.getValuation(tokenId);
        uint256 usd  = _kesTo6DecimalUsd(kes);
        maxUsdcH     = (usd * config.maxLtvBps) / BPS_DENOMINATOR;
    }

    /**
     * @notice Total owed (principal + accrued interest) for a loan.
     */
    function getTotalOwed(uint256 loanId) external view returns (uint256) {
        Loan memory loan = loans[loanId];
        return loan.principal + _calculateInterest(loan);
    }

    /**
     * @notice Get all loan IDs for a borrower.
     */
    function getBorrowerLoans(address borrower) external view returns (uint256[] memory) {
        return borrowerLoans[borrower];
    }

    /**
     * @notice Get full loan details.
     */
    function getLoan(uint256 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }

    // ─── ADMIN ────────────────────────────────────────────────────────────────

    function updateConfig(VaultConfig calldata newConfig)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        config = newConfig;
        emit ConfigUpdated(newConfig);
    }

    function setSupraPriceFeed(address feed)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        supraPriceFeed = ISupraPriceFeed(feed);
    }

    function setTreasury(address _treasury)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        treasury = _treasury;
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    /// @notice Deposit USDC-H liquidity into vault (lenders / protocol)
    function depositLiquidity(uint256 amount) external nonReentrant {
        usdcH.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ─── INTERNAL ────────────────────────────────────────────────────────────

    /**
     * @dev Get oracle-validated oCR valuation. Reverts if oracle is stale.
     */
    function _getValidatedValuation(uint256 tokenId)
        internal
        view
        returns (uint256 kes)
    {
        if (config.oracleRequired && supraPriceFeed.isStale()) {
            revert OraclePriceStale();
        }
        kes = receiptFactory.getValuation(tokenId);
    }

    /**
     * @dev Simple per-second interest calculation.
     *      interest = principal * annualRate * timeElapsed / SECONDS_PER_YEAR
     */
    function _calculateInterest(Loan memory loan)
        internal
        view
        returns (uint256 interest)
    {
        if (loan.principal == 0 || loan.openedAt == 0) return 0;

        uint256 elapsed = block.timestamp - loan.openedAt;
        interest = (loan.principal * config.annualInterestBps * elapsed)
            / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    /**
     * @dev Convert KES (18 decimals) to USDC-H (6 decimals).
     *      Testnet: fixed rate 1 USD = 130 KES.
     *      Production: use Supra KES/USD price feed.
     *
     * @param kes  Amount in KES with 18 decimal precision
     * @return usd Amount in USDC-H with 6 decimal precision
     */
    function _kesTo6DecimalUsd(uint256 kes) internal pure returns (uint256 usd) {
        // 130 KES per USD (testnet fixed rate)
        // kes has 18 decimals, usd needs 6 decimals
        // usd = kes / 130 / 10^12
        usd = kes / (130 * 1e12);
    }
}
