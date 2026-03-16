// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title MockReceiptFactory
 * @notice Minimal ERC-721 that mimics ReceiptFactory for unit-testing
 *         CollateralVault and ForwardMarket in isolation (no Supra, no roles).
 *
 * Usage:
 *   MockReceiptFactory mock = new MockReceiptFactory();
 *   uint256 id = mock.mint(farmer);   // mint a bare oCR to farmer
 *   mock.setValuation(id, 7_111e18); // KES 7,111
 */
contract MockReceiptFactory is ERC721 {

    struct Receipt {
        uint256 valuationKes;
        bool    locked;
        address farmer;
    }

    mapping(uint256 => Receipt) public receipts;
    uint256 private _nextId = 1;

    constructor() ERC721("Mock oCR", "moCR") {}

    // ── Mint helpers ──────────────────────────────────────────────────────────

    function mint(address to) external returns (uint256 tokenId) {
        tokenId = _nextId++;
        _mint(to, tokenId);
        receipts[tokenId] = Receipt({
            valuationKes: 7_111e18,  // default KES 7,111
            locked:       false,
            farmer:       to
        });
    }

    function mintWithValuation(address to, uint256 valuationKes)
        external
        returns (uint256 tokenId)
    {
        tokenId = _nextId++;
        _mint(to, tokenId);
        receipts[tokenId] = Receipt({
            valuationKes: valuationKes,
            locked:       false,
            farmer:       to
        });
    }

    // ── State helpers called by vault/market tests ────────────────────────────

    function setValuation(uint256 tokenId, uint256 valuationKes) external {
        receipts[tokenId].valuationKes = valuationKes;
    }

    function setLocked(uint256 tokenId, bool locked) external {
        receipts[tokenId].locked = locked;
    }

    // ── Interface shims (CollateralVault reads these) ─────────────────────────

    function getValuation(uint256 tokenId) external view returns (uint256) {
        return receipts[tokenId].valuationKes;
    }

    function isLocked(uint256 tokenId) external view returns (bool) {
        return receipts[tokenId].locked;
    }

    function farmerOf(uint256 tokenId) external view returns (address) {
        return receipts[tokenId].farmer;
    }
}
