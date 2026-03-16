// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockERC20} from "../test/mocks/MockERC20.sol";

contract DeployMockUSDC is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin       = vm.envAddress("ADMIN_ADDRESS");

        vm.startBroadcast(deployerKey);
        MockERC20 usdc = new MockERC20("USD Coin Hedera", "USDC-H", 6);
        // Mint 1M USDC-H to admin for testing
        usdc.mint(admin, 1_000_000e6);
        vm.stopBroadcast();

        console.log("MockUSDC-H deployed:", address(usdc));
        console.log("Add to .env: USDC_H_ADDRESS=%s", address(usdc));
    }
}
