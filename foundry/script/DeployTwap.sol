// SPDX-License-Identifier: MIT
pragma solidity 0.8.23;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {TWAP} from "../src/Twap.sol";

/// @title TWAP Deployment Script
/// @notice Configurable deployment script for TWAP contract across multiple EVM chains
contract DeployTwap is Script {
    // Network-specific LOP addresses
    mapping(string => address) private _lopAddresses;

    // Network-specific WETH addresses (for reference)
    mapping(string => address) private _wethAddresses;

    constructor() {
        // Initialize LOP addresses for different networks
        _lopAddresses["mainnet"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["arbitrum"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["base"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["optimism"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["polygon"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["bsc"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["avalanche"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["fantom"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["linea"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["scroll"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["mantle"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;
        _lopAddresses["zksync"] = 0x1111111254EEB25477B68fb85Ed929f73A960582;

        // Initialize WETH addresses for reference
        _wethAddresses["mainnet"] = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
        _wethAddresses["arbitrum"] = 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1;
        _wethAddresses["base"] = 0x4200000000000000000000000000000000000006;
        _wethAddresses["optimism"] = 0x4200000000000000000000000000000000000006;
        _wethAddresses["polygon"] = 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;
        _wethAddresses["bsc"] = 0x2170Ed0880ac9A755fd29B2688956BD959F933F8;
        _wethAddresses["avalanche"] = 0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB;
        _wethAddresses["fantom"] = 0x74b23882a30290451A17c44f4F05243b6b58C76d;
        _wethAddresses["linea"] = 0x0000000000000000000000000000000000000000;
        _wethAddresses["scroll"] = 0x5300000000000000000000000000000000000004;
        _wethAddresses["mantle"] = 0xDeadDeAddeAddEAddeadDEaDDEAdDeaDDeAD0000;
        _wethAddresses["zksync"] = 0x5AEa5775959fBC2557Cc8789bC1bf90A239D9a91;
    }

    /// @notice Deploy TWAP contract with network-specific configuration
    /// @param network The network name (e.g., "mainnet", "arbitrum", "base")
    /// @param customLopAddress Optional custom LOP address (if not provided, uses default for network)
    function deploy(string memory network, address customLopAddress) public returns (TWAP) {
        address lopAddress = customLopAddress != address(0) ? customLopAddress : _lopAddresses[network];

        require(lopAddress != address(0), "LOP address not found for network");

        vm.startBroadcast();

        TWAP twap = new TWAP(lopAddress);

        vm.stopBroadcast();

        console.log("TWAP deployed to:", address(twap));
        console.log("Network:", network);
        console.log("LOP address:", lopAddress);
        console.log("WETH address:", _wethAddresses[network]);

        return twap;
    }

    /// @notice Deploy TWAP contract for mainnet
    function deployMainnet() public returns (TWAP) {
        return deploy("mainnet", address(0));
    }

    /// @notice Deploy TWAP contract for Arbitrum
    function deployArbitrum() public returns (TWAP) {
        return deploy("arbitrum", address(0));
    }

    /// @notice Deploy TWAP contract for Base
    function deployBase() public returns (TWAP) {
        return deploy("base", address(0));
    }

    /// @notice Deploy TWAP contract for Optimism
    function deployOptimism() public returns (TWAP) {
        return deploy("optimism", address(0));
    }

    /// @notice Deploy TWAP contract for Polygon
    function deployPolygon() public returns (TWAP) {
        return deploy("polygon", address(0));
    }

    /// @notice Deploy TWAP contract for BSC
    function deployBSC() public returns (TWAP) {
        return deploy("bsc", address(0));
    }

    /// @notice Deploy TWAP contract for Avalanche
    function deployAvalanche() public returns (TWAP) {
        return deploy("avalanche", address(0));
    }

    /// @notice Deploy TWAP contract for Fantom
    function deployFantom() public returns (TWAP) {
        return deploy("fantom", address(0));
    }

    /// @notice Deploy TWAP contract for Linea
    function deployLinea() public returns (TWAP) {
        return deploy("linea", address(0));
    }

    /// @notice Deploy TWAP contract for Scroll
    function deployScroll() public returns (TWAP) {
        return deploy("scroll", address(0));
    }

    /// @notice Deploy TWAP contract for Mantle
    function deployMantle() public returns (TWAP) {
        return deploy("mantle", address(0));
    }

    /// @notice Deploy TWAP contract for zkSync
    function deployZkSync() public returns (TWAP) {
        return deploy("zksync", address(0));
    }

    /// @notice Get LOP address for a specific network
    /// @param network The network name
    /// @return The LOP address for the network
    function getLopAddress(string memory network) public view returns (address) {
        return _lopAddresses[network];
    }

    /// @notice Get WETH address for a specific network
    /// @param network The network name
    /// @return The WETH address for the network
    function getWethAddress(string memory network) public view returns (address) {
        return _wethAddresses[network];
    }

    /// @notice Set custom LOP address for a network
    /// @param network The network name
    /// @param lopAddress The LOP address to set
    function setLopAddress(string memory network, address lopAddress) public {
        _lopAddresses[network] = lopAddress;
    }

    /// @notice Set custom WETH address for a network
    /// @param network The network name
    /// @param wethAddress The WETH address to set
    function setWethAddress(string memory network, address wethAddress) public {
        _wethAddresses[network] = wethAddress;
    }

    /// @notice Run deployment based on current network
    function run() public {
        string memory network = vm.envString("NETWORK");
        address customLop = vm.envOr("CUSTOM_LOP_ADDRESS", address(0));

        deploy(network, customLop);
    }
}
