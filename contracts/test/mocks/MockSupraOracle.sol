// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockSupraOracle
 * @notice Lightweight stand-in for the Supra pull-oracle contract.
 *         Stores a price per pair index; SupraPriceFeed.sol reads pair 0 (MAIZE/KES).
 *
 * Usage in tests:
 *   MockSupraOracle oracle = new MockSupraOracle();
 *   oracle.setPrice(0, 45e18);           // KES 45 per kg, 18-decimal
 *   SupraPriceFeed feed = new SupraPriceFeed(admin, address(oracle), 45e18, false);
 */
contract MockSupraOracle {
    // pair index → (price, decimals, timestamp)
    struct PriceData {
        uint256 price;
        uint256 decimals;
        uint256 timestamp;
        uint256 round;
    }

    mapping(uint256 => PriceData) private _prices;

    constructor() {
        // Default: MAIZE/KES = KES 45 per kg (pair index 0)
        _prices[0] = PriceData({
            price:     45e18,
            decimals:  18,
            timestamp: block.timestamp,
            round:     1
        });
    }

    /// @notice Set a price for a pair index.
    function setPrice(uint256 pairIndex, uint256 price) external {
        _prices[pairIndex] = PriceData({
            price:     price,
            decimals:  18,
            timestamp: block.timestamp,
            round:     _prices[pairIndex].round + 1
        });
    }

    /// @notice Called by SupraPriceFeed (matches ISupraOraclePull interface).
    function getSvalue(uint256 pairIndex)
        external
        view
        returns (bytes32 val, bool flag)
    {
        PriceData memory d = _prices[pairIndex];
        // Pack price into bytes32 the same way real Supra does
        val = bytes32(d.price);
        flag = true;
    }

    /// @notice Alternative interface used by some Supra integrations
    function getPrice(uint256 pairIndex)
        external
        view
        returns (uint256 price, uint256 timestamp)
    {
        PriceData memory d = _prices[pairIndex];
        return (d.price, d.timestamp);
    }
}
