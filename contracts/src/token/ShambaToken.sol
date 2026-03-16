// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ShambaToken
 * @author ShambaChain Protocol
 * @notice SHAMBA — the protocol utility token powering the ShambaChain
 *         agent economy on Hedera.
 *
 * @dev Standard ERC-20 with AccessControl mint/burn and a
 *      HCS-compatible emission schedule for agent rewards.
 *
 * Token Utility:
 *   1. Agent Economy (OpenClaw)
 *      - PriceAgent, LoanAgent, RiskAgent earn SHAMBA per successful action
 *      - Holding SHAMBA qualifies for fee rebates across the protocol
 *
 *   2. Protocol Governance (future)
 *      - SHAMBA holders vote on protocol parameters
 *
 *   3. Fee Discounts
 *      - >= 100 SHAMBA: 10% discount on HedgePosition premiums
 *      - >= 100 SHAMBA: 0.5% fee rebate on RiskMarket winnings
 *      - >= 1,000 SHAMBA: reduced ForwardMarket platform fee (future)
 *
 *   4. Staking (future)
 *      - Stake SHAMBA to earn share of vault interest income
 *
 * Supply:
 *   - Total cap:         100,000,000 SHAMBA (100M)
 *   - Initial mint:       10,000,000 SHAMBA (10M) -> team/protocol treasury
 *   - Agent emissions:    40,000,000 SHAMBA (40M) -> earned over 4 years
 *   - Community pool:     30,000,000 SHAMBA (30M) -> governance/grants
 *   - Liquidity reserve:  20,000,000 SHAMBA (20M) -> DEX liquidity
 *
 * Agent Emission Rates (SHAMBA per action, 18 decimals):
 *   - PriceAgent:  0.1 SHAMBA per verified price update
 *   - LoanAgent:   1   SHAMBA per loan successfully issued
 *   - RiskAgent:   5   SHAMBA per risk check that prevented liquidation
 *   - RiskAgent:  10   SHAMBA per liquidation triggered
 */

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

contract ShambaToken is ERC20, ERC20Burnable, ERC20Permit, AccessControl, Pausable {

    // --- ROLES --------------------------------------------------------------
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant AGENT_ROLE  = keccak256("AGENT_ROLE");

    // --- TOKENOMICS ---------------------------------------------------------
    uint256 public constant MAX_SUPPLY = 100_000_000e18; // 100M SHAMBA

    // Agent emission rates (18 decimals)
    uint256 public priceUpdateReward  = 0.1e18;
    uint256 public loanIssuanceReward = 1e18;
    uint256 public riskCheckReward    = 5e18;
    uint256 public liquidationReward  = 10e18;

    // --- EMISSION TRACKING --------------------------------------------------

    uint256 public totalAgentEmissions;

    mapping(address => uint256) public agentEmissions;
    mapping(address => uint256) public agentPriceUpdates;
    mapping(address => uint256) public agentLoansIssued;
    mapping(address => uint256) public agentRiskChecks;
    mapping(address => uint256) public agentLiquidations;

    // --- EVENTS -------------------------------------------------------------

    event AgentRewarded(
        address indexed agent,
        string  actionType,
        uint256 amount,
        uint256 totalEmitted
    );

    event RewardRatesUpdated(
        uint256 priceUpdate,
        uint256 loanIssuance,
        uint256 riskCheck,
        uint256 liquidation
    );

    // --- ERRORS -------------------------------------------------------------

    error ExceedsMaxSupply(uint256 requested, uint256 available);

    // --- CONSTRUCTOR --------------------------------------------------------

    constructor(
        address admin,
        address treasury,
        uint256 initialSupply
    )
        ERC20("ShambaChain", "SHAMBA")
        ERC20Permit("ShambaChain")
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
        _grantRole(AGENT_ROLE, admin);

        require(initialSupply <= MAX_SUPPLY, "ShambaToken: exceeds cap");
        if (initialSupply > 0) {
            _mint(treasury, initialSupply);
        }
    }

    // --- MINTING ------------------------------------------------------------

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        if (totalSupply() + amount > MAX_SUPPLY) {
            revert ExceedsMaxSupply(amount, MAX_SUPPLY - totalSupply());
        }
        _mint(to, amount);
    }

    // --- AGENT REWARDS ------------------------------------------------------

    /// @notice Reward PriceAgent for a successful price update
    function rewardPriceUpdate(address agent) external onlyRole(AGENT_ROLE) {
        _emitToAgent(agent, priceUpdateReward, "PRICE_UPDATE");
        agentPriceUpdates[agent]++;
    }

    /// @notice Reward LoanAgent for a successfully issued loan
    function rewardLoanIssuance(address agent) external onlyRole(AGENT_ROLE) {
        _emitToAgent(agent, loanIssuanceReward, "LOAN_ISSUANCE");
        agentLoansIssued[agent]++;
    }

    /// @notice Reward RiskAgent for a risk check that detected early warning
    function rewardRiskCheck(address agent) external onlyRole(AGENT_ROLE) {
        _emitToAgent(agent, riskCheckReward, "RISK_CHECK");
        agentRiskChecks[agent]++;
    }

    /// @notice Reward RiskAgent for triggering a liquidation
    function rewardLiquidation(address agent) external onlyRole(AGENT_ROLE) {
        _emitToAgent(agent, liquidationReward, "LIQUIDATION");
        agentLiquidations[agent]++;
    }

    // --- ADMIN --------------------------------------------------------------

    function setRewardRates(
        uint256 _priceUpdate,
        uint256 _loanIssuance,
        uint256 _riskCheck,
        uint256 _liquidation
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        priceUpdateReward  = _priceUpdate;
        loanIssuanceReward = _loanIssuance;
        riskCheckReward    = _riskCheck;
        liquidationReward  = _liquidation;
        emit RewardRatesUpdated(_priceUpdate, _loanIssuance, _riskCheck, _liquidation);
    }

    function pause()   external onlyRole(DEFAULT_ADMIN_ROLE) { _pause(); }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) { _unpause(); }

    // --- VIEWS --------------------------------------------------------------

    function remainingSupply() external view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }

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
        )
    {
        balance      = balanceOf(agent);
        totalEmitted = agentEmissions[agent];
        priceUpdates = agentPriceUpdates[agent];
        loansIssued  = agentLoansIssued[agent];
        riskChecks   = agentRiskChecks[agent];
        liquidations = agentLiquidations[agent];
    }

    /// @notice Does this address qualify for protocol fee discounts? (>= 100 SHAMBA)
    function qualifiesForDiscount(address account) external view returns (bool) {
        return balanceOf(account) >= 100e18;
    }

    // --- INTERNAL -----------------------------------------------------------

    function _emitToAgent(address agent, uint256 amount, string memory actionType) internal {
        uint256 available = MAX_SUPPLY - totalSupply();
        if (amount > available) amount = available;
        if (amount == 0) return;

        _mint(agent, amount);
        agentEmissions[agent] += amount;
        totalAgentEmissions   += amount;

        emit AgentRewarded(agent, actionType, amount, totalAgentEmissions);
    }

    function _update(address from, address to, uint256 value)
        internal
        override(ERC20)
    {
        require(!paused(), "ShambaToken: token transfer while paused");
        super._update(from, to, value);
    }
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
