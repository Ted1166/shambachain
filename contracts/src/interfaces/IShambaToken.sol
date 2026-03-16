// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IShambaToken
 * @notice Interface for the SHAMBA ERC-20 utility token.
 * @dev Consumed by: RiskMarket (fee rebate check), HedgePosition (discount),
 *      CollateralVault (future staking), backend agent reward hooks.
 */
interface IShambaToken {

    // ─── EVENTS ───────────────────────────────────────────────────────────

    event AgentRewarded(
        address indexed agent,
        string          actionType,
        uint256         amount,
        uint256         totalEmitted
    );

    event RewardRatesUpdated(
        uint256 priceUpdate,
        uint256 loanIssuance,
        uint256 riskCheck,
        uint256 liquidation
    );

    // ─── ERRORS ───────────────────────────────────────────────────────────

    error ExceedsMaxSupply(uint256 requested, uint256 available);

    // ─── ERC-20 STANDARD ──────────────────────────────────────────────────

    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function transfer(address to, uint256 amount) external returns (bool);

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);

    // ─── ERC-20 PERMIT ────────────────────────────────────────────────────

    function permit(
        address   owner,
        address   spender,
        uint256   value,
        uint256   deadline,
        uint8     v,
        bytes32   r,
        bytes32   s
    ) external;

    function nonces(address owner) external view returns (uint256);

    function DOMAIN_SEPARATOR() external view returns (bytes32);

    // ─── MINT / BURN ──────────────────────────────────────────────────────

    function mint(address to, uint256 amount) external;

    function burn(uint256 amount) external;

    function burnFrom(address account, uint256 amount) external;

    // ─── AGENT REWARDS ────────────────────────────────────────────────────

    function rewardPriceUpdate(address agent) external;

    function rewardLoanIssuance(address agent) external;

    function rewardRiskCheck(address agent) external;

    function rewardLiquidation(address agent) external;

    // ─── ADMIN ────────────────────────────────────────────────────────────

    function setRewardRates(
        uint256 priceUpdate,
        uint256 loanIssuance,
        uint256 riskCheck,
        uint256 liquidation
    ) external;

    // ─── READ ─────────────────────────────────────────────────────────────

    function remainingSupply() external view returns (uint256);

    function qualifiesForDiscount(address account) external view returns (bool);

    function getAgentStats(address agent)
        external
        view
        returns (
            uint256 balance,
            uint256 totalEmitted,
            uint256 priceUpdates,
            uint256 loansIssued,
            uint256 riskChecks,
            uint256 liquidations
        );

    function MAX_SUPPLY() external view returns (uint256);

    function totalAgentEmissions() external view returns (uint256);

    function agentEmissions(address agent) external view returns (uint256);
}
