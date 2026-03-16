// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {ReceiptFactory} from "../../src/RecipientFactory.sol";

contract ReceiptFactoryTest is Test {
    uint256 private _mintCount;

    ReceiptFactory public factory;

    bytes32 constant MINTER_ROLE  = keccak256("MINTER_ROLE");
    bytes32 constant GRADER_ROLE  = keccak256("GRADER_ROLE");

    address admin     = makeAddr("admin");
    address minter    = makeAddr("minter");
    address grader    = makeAddr("grader");
    address farmer    = makeAddr("farmer");
    address custodian = makeAddr("custodian");
    address stranger  = makeAddr("stranger");

    // CommodityReceipt field order (12 fields):
    // tokenId | commodityType | weightKg | grade | warehouseId | mpesaRef |
    // hcsSequenceNumber | depositTimestamp | expiryTimestamp | status | farmer | valuationKes

    function _defaultMint() internal returns (uint256 tokenId) {
        _mintCount++;
        vm.prank(minter);
        tokenId = factory.mintReceipt(
            custodian,
            farmer,
            "MAIZE",
            200,
            ReceiptFactory.Grade.A,
            "WH-NKR-001",
            string(abi.encodePacked("MPESA-", vm.toString(_mintCount))),
            1000 + _mintCount,
            7_111e18,
            "ipfs://QmTest1"
        );
    }

    function setUp() public {
        vm.startPrank(admin);
        factory = new ReceiptFactory(admin);
        factory.grantRole(MINTER_ROLE, minter);
        factory.grantRole(GRADER_ROLE, grader);
        factory.setCollateralVault(admin); // admin acts as vault for lock tests
        vm.stopPrank();
    }

    // ── Minting ───────────────────────────────────────────────────────────────

    function test_MintReceipt_SuccessByMinter() public {
        uint256 tokenId = _defaultMint();
        assertEq(factory.ownerOf(tokenId), custodian);
    }

    function test_MintReceipt_StorageCorrect() public {
        uint256 tokenId = _defaultMint();

        // (tokenId, commodityType, weightKg, grade, warehouseId, mpesaRef,
        //  hcsSequenceNumber, depositTimestamp, expiryTimestamp, status, farmer, valuationKes)
        (
            ,
            string memory commodity,
            uint256 weight,
            ReceiptFactory.Grade grade,
            ,
            ,
            ,
            ,
            ,
            ReceiptFactory.Status status,
            address _farmer,
            uint256 valuation
        ) = factory.receipts(tokenId);

        assertEq(commodity, "MAIZE");
        assertEq(weight, 200);
        assertEq(uint8(grade), uint8(ReceiptFactory.Grade.A));
        assertEq(valuation, 7_111e18);
        assertEq(uint8(status), uint8(ReceiptFactory.Status.Active));
        assertEq(_farmer, farmer);
    }

    function test_MintReceipt_RevertIfNotMinter() public {
        vm.prank(stranger);
        vm.expectRevert();
        factory.mintReceipt(
            custodian, farmer, "MAIZE", 200,
            ReceiptFactory.Grade.A, "WH-NKR-001",
            "QJK2HX9ABE", 1000 + _mintCount, 7_111e18, "ipfs://QmTest1"
        );
    }

    function test_MintReceipt_IncrementsTokenId() public {
        uint256 id1 = _defaultMint();
        uint256 id2 = _defaultMint();
        assertEq(id2, id1 + 1);
    }

    // ── Valuation Update ──────────────────────────────────────────────────────

    function test_UpdateValuation_ByGrader() public {
        uint256 tokenId = _defaultMint();
        vm.prank(minter);
        factory.updateValuation(tokenId, 8_500e18);

        (, , , , , , , , , , , uint256 valuation) = factory.receipts(tokenId);
        assertEq(valuation, 8_500e18);
    }

    function test_UpdateValuation_RevertIfNotGrader() public {
        uint256 tokenId = _defaultMint();
        vm.prank(stranger);
        vm.expectRevert();
        factory.updateValuation(tokenId, 8_500e18);
    }

    // ── Redemption ────────────────────────────────────────────────────────────

    function test_RedeemReceipt_BurnsByFarmer() public {
        uint256 tokenId = _defaultMint();
        vm.prank(custodian);
        factory.redeemReceipt(tokenId);
        vm.expectRevert();
        factory.ownerOf(tokenId);
    }

    function test_RedeemReceipt_RevertByStranger() public {
        uint256 tokenId = _defaultMint();
        vm.prank(stranger);
        vm.expectRevert();
        factory.redeemReceipt(tokenId);
    }

    function test_RedeemReceipt_RevertIfLocked() public {
        uint256 tokenId = _defaultMint();
        vm.prank(admin);
        factory.lockReceipt(tokenId);
        vm.prank(custodian);
        vm.expectRevert();
        factory.redeemReceipt(tokenId);
    }

    // ── Transfer Lock ─────────────────────────────────────────────────────────

    function test_Transfer_BlockedWhenLocked() public {
        uint256 tokenId = _defaultMint();
        vm.prank(admin);
        factory.lockReceipt(tokenId);
        vm.prank(custodian);
        vm.expectRevert();
        factory.transferFrom(custodian, stranger, tokenId);
    }

    function test_Transfer_AllowedWhenUnlocked() public {
        uint256 tokenId = _defaultMint();
        vm.prank(custodian);
        factory.transferFrom(custodian, stranger, tokenId);
        assertEq(factory.ownerOf(tokenId), stranger);
    }

    // ── URI ───────────────────────────────────────────────────────────────────

    function test_TokenURI_SetOnMint() public {
        uint256 tokenId = _defaultMint();
        assertEq(factory.tokenURI(tokenId), "ipfs://QmTest1");
    }

    // ── Fuzz ──────────────────────────────────────────────────────────────────

    function testFuzz_MintReceipt_AnyWeight(uint256 weight) public {
        weight = bound(weight, 1, 1_000_000);
        vm.prank(minter);
        uint256 tokenId = factory.mintReceipt(
            custodian, farmer, "MAIZE", weight,
            ReceiptFactory.Grade.B, "WH-ELD-003",
            "FUZZ123", 9999, weight * 35e18, "ipfs://QmFuzz"
        );
        (, , uint256 storedWeight, , , , , , , , ,) = factory.receipts(tokenId);
        assertEq(storedWeight, weight);
    }
}
