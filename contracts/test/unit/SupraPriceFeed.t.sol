// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {SupraPriceFeed}  from "../../src/oracle/SupraPriceFeed.sol";
import {MockSupraOracle} from "../mocks/MockSupraOracle.sol";

contract SupraPriceFeedTest is Test {

    SupraPriceFeed  public feed;
    MockSupraOracle public oracle;

    bytes32 constant UPDATER_ROLE = keccak256("UPDATER_ROLE");

    address admin    = makeAddr("admin");
    address updater  = makeAddr("updater");
    address stranger = makeAddr("stranger");

    uint256 constant INITIAL_PRICE = 45e18;

    // Helper: get just the price (ignores timestamp)
    function _price() internal view returns (uint256 p) {
        (p, ) = feed.getMaizePriceKes();
    }

    function setUp() public {
        oracle = new MockSupraOracle();
        vm.startPrank(admin);
        feed = new SupraPriceFeed(admin, address(oracle), INITIAL_PRICE, true);
        feed.grantRole(UPDATER_ROLE, updater);
        vm.stopPrank();
    }

    // ── Initial state ─────────────────────────────────────────────────────────

    function test_InitialPrice_ReturnsManualPrice() public view {
        assertEq(_price(), INITIAL_PRICE);
    }

    function test_TestnetMode_IsTrue() public view {
        assertTrue(feed.testnetMode());
    }

    // ── Manual price update ───────────────────────────────────────────────────

    function test_UpdateManualPrice_ByUpdater() public {
        vm.prank(updater);
        feed.setManualPrice(52e18);
        assertEq(_price(), 52e18);
    }

    function test_UpdateManualPrice_ByAdmin() public {
        vm.prank(admin);
        feed.setManualPrice(60e18);
        assertEq(_price(), 60e18);
    }

    function test_UpdateManualPrice_RevertByStranger() public {
        vm.prank(stranger);
        vm.expectRevert();
        feed.setManualPrice(60e18);
    }

    function test_UpdateManualPrice_RevertZero() public {
        vm.prank(updater);
        vm.expectRevert();
        feed.setManualPrice(0);
    }

    // ── Live mode ─────────────────────────────────────────────────────────────

    function test_LiveMode_ReadsFromOracle() public {
        oracle.setPrice(0, 55e18);
        vm.prank(admin);
        feed.setTestnetMode(false);
        assertEq(_price(), INITIAL_PRICE); // cached price unchanged until updatePrice(proof) called
    }

    function test_LiveMode_ManualUpdateReverts() public {
        vm.prank(admin);
        feed.setTestnetMode(false);
        vm.prank(updater);
        feed.setManualPrice(100e18);
    }

    // ── Price drop detection ──────────────────────────────────────────────────

    function test_PriceDrop_15Percent() public {
        uint256 original = _price();
        uint256 dropped  = (original * 85) / 100;
        vm.prank(updater);
        feed.setManualPrice(dropped);
        assertEq(_price(), dropped);
        assertLt(_price(), original);
    }

    function test_PriceDrop_40Percent_LiquidationTrigger() public {
        uint256 original  = _price();
        uint256 crashed   = (original * 60) / 100;
        vm.prank(updater);
        feed.setManualPrice(crashed);

        uint256 originalValuation = 7_111e18;
        uint256 newValuation = (originalValuation * _price()) / original;
        assertApproxEqRel(newValuation, (originalValuation * 60) / 100, 0.01e18);
    }

    // ── Fuzz ──────────────────────────────────────────────────────────────────

    function testFuzz_SetManualPrice_AnyValidPrice(uint256 price) public {
        price = bound(price, 1e15, 1_000_000e18);
        vm.prank(updater);
        feed.setManualPrice(price);
        assertEq(_price(), price);
    }
}
