// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {TWAP} from "../src/Twap.sol";
import {WrappedTokenMock} from "../contracts/mocks/WrappedTokenMock.sol";
import {LimitOrderProtocol} from "@lop/LimitOrderProtocol.sol";
import {IWETH} from "@1inch/solidity-utils/contracts/interfaces/IWETH.sol";
import {TokenMock} from "../contracts/mocks/TokenMock.sol";

/// @title TWAP Deployment Script
/// @notice Configurable deployment script for TWAP contract across multiple EVM chains
contract DeployTwap is Script {
    // Network-specific LOP addresses
    mapping(uint256 => address) private _lopAddresses;

    // Network-specific WETH addresses (for reference)
    mapping(uint256 => address) private _wethAddresses;

    constructor() {
        // Initialize LOP addresses for different networks
        _lopAddresses[1] = 0x1111111254EEB25477B68fb85Ed929f73A960582; // mainnet
        _lopAddresses[42161] = 0x1111111254EEB25477B68fb85Ed929f73A960582; // arbitrum
        _lopAddresses[8453] = 0x1111111254EEB25477B68fb85Ed929f73A960582; // base
        _lopAddresses[10] = 0x1111111254EEB25477B68fb85Ed929f73A960582; // optimism
        _lopAddresses[137] = 0x1111111254EEB25477B68fb85Ed929f73A960582; // polygon
        _lopAddresses[56] = 0x1111111254EEB25477B68fb85Ed929f73A960582; // bsc

        // Initialize WETH addresses for reference
        _wethAddresses[1] = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // mainnet
        _wethAddresses[42161] = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1; // arbitrum
        _wethAddresses[8453] = 0x4200000000000000000000000000000000000006; // base
        _wethAddresses[10] = 0x4200000000000000000000000000000000000006; // optimism
        _wethAddresses[137] = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270; // polygon
        _wethAddresses[56] = 0x2170Ed0880ac9A755fd29B2688956BD959F933F8;
    }

    /// @notice Deploy TWAP contract with network-specific configuration
    function deploy() public returns (TWAP) {
        if (block.chainid == 31337 || block.chainid == 1337) {
            vm.startBroadcast();
            TokenMock dai = new TokenMock("DAI", "DAI");
            // _daiAddresses[block.chainid] = address(dai);
            vm.stopBroadcast();

            console.log("DAI address:", address(dai));

            vm.startBroadcast();
            TokenMock usdc = new TokenMock("USDC", "USDC");
            // _usdcAddresses[block.chainid] = address(usdc);
            vm.stopBroadcast();

            console.log("USDC address:", address(usdc));

            vm.startBroadcast();
            WrappedTokenMock weth = new WrappedTokenMock("WETH", "WETH");
            _wethAddresses[block.chainid] = address(weth);
            vm.stopBroadcast();

            vm.startBroadcast();
            LimitOrderProtocol lop = new LimitOrderProtocol(IWETH(address(weth)));
            _lopAddresses[block.chainid] = address(lop);
            vm.stopBroadcast();
        }

        vm.startBroadcast();

        TWAP twap = new TWAP(_lopAddresses[block.chainid], _wethAddresses[block.chainid]);

        vm.stopBroadcast();

        console.log("TWAP deployed to:", address(twap));
        console.log("Network:", block.chainid);
        console.log("LOP address:", _lopAddresses[block.chainid]);
        console.log("WETH address:", _wethAddresses[block.chainid]);

        return twap;
    }

    /// @notice Run deployment based on current network
    function run() public {
        deploy();
    }
}
