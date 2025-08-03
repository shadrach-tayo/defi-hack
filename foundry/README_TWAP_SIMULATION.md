# TWAP Limit Order Swap Simulation

This script provides a comprehensive simulation environment for TWAP (Time-Weighted Average Price) limit order swaps on various blockchain networks including Ethereum mainnet, Arbitrum, Base, Optimism, and Polygon.

## Overview

The TWAP simulation script allows you to:

- Create TWAP orders with configurable time windows and fill intervals
- Simulate order execution across multiple time periods
- Monitor order status and execution conditions
- Execute fills when conditions are met
- Handle fees and native token unwrapping
- Test on multiple networks with real contract addresses

## Features

### 🕒 Time-Based Execution

- Configurable start and end times for order execution
- Enforced intervals between fills to prevent market impact
- Time window validation and monitoring

### 📊 Fill Management

- Maximum fill count tracking
- Partial fill support
- Remaining amount calculations
- Fill interval enforcement

### 💰 Fee Handling

- Configurable fee percentages
- Fee recipient management
- Native token unwrapping support

### 🌐 Multi-Network Support

- Ethereum Mainnet
- Arbitrum
- Base
- Optimism
- Polygon
- Local development networks

## Prerequisites

1. **Node.js and npm** - Latest LTS version
2. **Hardhat** - Development environment
3. **Environment Variables** - RPC URLs for target networks

### Environment Setup

Create a `.env` file in the `foundry` directory:

```bash
# Ethereum Mainnet
ETHEREUM_RPC_URL=https://eth-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Arbitrum
ARBITRUM_RPC_URL=https://arb-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Base
BASE_RPC_URL=https://mainnet.base.org

# Optimism
OPTIMISM_RPC_URL=https://mainnet.optimism.io

# Polygon
POLYGON_RPC_URL=https://polygon-rpc.com

# Private Key (for signing transactions)
PRIVATE_KEY=your_private_key_here
```

## Installation

1. Navigate to the foundry directory:

```bash
cd foundry
```

2. Install dependencies:

```bash
npm install
```

3. Compile contracts:

```bash
npm run compile
```

## Usage

### Basic Simulation

Run the simulation script:

```bash
npx hardhat run script/TwapSwap.ts --network <network_name>
```

Example for local network:

```bash
npx hardhat run script/TwapSwap.ts --network localhost
```

Example for Ethereum mainnet:

```bash
npx hardhat run script/TwapSwap.ts --network mainnet
```

### Configuration

The script includes a default TWAP order configuration that you can modify:

```typescript
const orderConfig: TWAPOrderConfig = {
  makerAsset: networkConfig.daiAddress, // Token being sold
  takerAsset: networkConfig.wethAddress, // Token being bought
  makingAmount: parseEther("1000"), // Amount to sell (1000 DAI)
  takingAmount: parseEther("1"), // Amount to buy (1 WETH)
  startTime: currentTime + 60, // Start in 1 minute
  endTime: currentTime + 3600, // End in 1 hour
  maxFills: 5, // Maximum number of fills
  interval: 600, // 10 minutes between fills
  fee: 1000, // 0.1% fee (1000 = 0.1%)
  feeRecipient: signer.address, // Fee recipient address
  unwrapWeth: false, // Whether to unwrap WETH
};
```

### Network Configuration

The script automatically detects the network and uses appropriate contract addresses:

| Network          | Chain ID | LOP Address                                | WETH Address                               |
| ---------------- | -------- | ------------------------------------------ | ------------------------------------------ |
| Ethereum Mainnet | 1        | 0x1111111254EEB25477B68fb85Ed929f73A960582 | 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2 |
| Arbitrum         | 42161    | 0x1111111254EEB25477B68fb85Ed929f73A960582 | 0x82aF49447D8a07e3bd95BD0d56f35241523fBab1 |
| Base             | 8453     | 0x1111111254EEB25477B68fb85Ed929f73A960582 | 0x4200000000000000000000000000000000000006 |
| Optimism         | 10       | 0x1111111254EEB25477B68fb85Ed929f73A960582 | 0x4200000000000000000000000000000000000006 |
| Polygon          | 137      | 0x1111111254EEB25477B68fb85Ed929f73A960582 | 0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270 |

## TWAP Order Lifecycle

### 1. Order Creation

- Define order parameters (assets, amounts, time windows)
- Create limit order with TWAP extension
- Setup execution window in TWAP contract
- Generate order hash and key

### 2. Execution Window

- Monitor time window constraints
- Check if order can be filled
- Track fill count and remaining fills
- Enforce intervals between fills

### 3. Order Filling

- Sign order with maker's private key
- Execute fill through Limit Order Protocol
- Record fill in TWAP contract
- Update order status

### 4. Completion

- Track total fills vs maximum fills
- Calculate remaining amounts
- Handle order expiration

## Key Components

### TWAPSwapSimulator Class

The main class that handles all TWAP operations:

```typescript
class TWAPSwapSimulator {
  // Create a new TWAP order
  async createTWAPOrder(config: TWAPOrderConfig, makerAddress: string);

  // Execute a single fill
  async executeTWAPFill(
    order: any,
    extension: Extension,
    takerAddress: string,
    fillAmount: bigint,
    chainId: number
  );

  // Get current order status
  async getTWAPOrderStatus(orderHash: string): Promise<TWAPSimulationResult>;

  // Simulate complete execution
  async simulateTWAPExecution(
    orderConfig: TWAPOrderConfig,
    makerAddress: string,
    takerAddress: string,
    chainId: number
  );

  // Monitor and execute fills
  async monitorAndExecuteTWAP(
    orderHash: string,
    order: any,
    extension: Extension,
    takerAddress: string,
    chainId: number,
    maxFills: number
  );
}
```

### Order Configuration

```typescript
interface TWAPOrderConfig {
  makerAsset: string; // Address of token being sold
  takerAsset: string; // Address of token being bought
  makingAmount: bigint; // Amount to sell
  takingAmount: bigint; // Amount to buy
  startTime: number; // Unix timestamp for start
  endTime: number; // Unix timestamp for end
  maxFills: number; // Maximum number of fills
  interval: number; // Seconds between fills
  fee?: number; // Fee in basis points
  feeRecipient?: string; // Fee recipient address
  unwrapWeth?: boolean; // Whether to unwrap WETH
}
```

## Example Output

```
🚀 Starting TWAP Swap Simulation...
🌐 Network: Ethereum Mainnet (Chain ID: 1)
👤 Signer: 0x1234...5678

📦 Setting up contracts...
✅ Using existing contracts on Ethereum Mainnet
TWAP Address: 0x...
LOP Address: 0x1111111254EEB25477B68fb85Ed929f73A960582

📋 Order Configuration:
- Maker Asset: 0x6B175474E89094C44Da98b954EedeAC495271d0F
- Taker Asset: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
- Making Amount: 1000.0 DAI
- Taking Amount: 1.0 WETH
- Max Fills: 5
- Interval: 600s

🔧 Creating TWAP order on Ethereum Mainnet...
Maker: 0x1234...5678
Maker Asset: 0x6B175474E89094C44Da98b954EedeAC495271d0F
Taker Asset: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
Making Amount: 1000.0
Taking Amount: 1.0
Time Window: 2024-01-15T10:00:00.000Z - 2024-01-15T11:00:00.000Z
Max Fills: 5, Interval: 600s
✅ TWAP order created successfully!
Order Hash: 0x...
Order Key: 0x...

📊 Starting TWAP simulation...
🚀 Executing TWAP fill...
Taker: 0x1234...5678
Fill Amount: 0.2
✅ TWAP fill executed successfully!
Transaction Hash: 0x...
Gas Used: 150000
✅ Fill 1/5 completed
⏰ Waiting 600 seconds for next fill...

📊 Simulation Results:
Order Hash: 0x...
Order Key: 0x...
Final Fill Count: 5
Time Remaining: 0s
Can Fill Now: false

✅ TWAP simulation completed successfully!
```

## Safety Considerations

### Production Usage

⚠️ **Important**: The script includes monitoring and execution functionality that is commented out by default for safety. Before enabling automatic execution:

1. **Test thoroughly** on testnets first
2. **Verify all addresses** and configurations
3. **Use small amounts** for initial testing
4. **Monitor gas prices** and network conditions
5. **Have emergency stop** procedures in place

### Security Best Practices

1. **Private Key Management**: Never hardcode private keys
2. **Environment Variables**: Use `.env` files for sensitive data
3. **Network Validation**: Always verify network configuration
4. **Amount Limits**: Set reasonable limits for order amounts
5. **Error Handling**: Implement proper error handling and recovery

## Troubleshooting

### Common Issues

1. **Network Connection**: Ensure RPC URLs are correct and accessible
2. **Gas Fees**: Check if you have sufficient ETH for gas
3. **Token Approvals**: Ensure tokens are approved for the LOP contract
4. **Time Windows**: Verify start/end times are in the future
5. **Contract Addresses**: Confirm contract addresses are correct for the network

### Debug Mode

Enable verbose logging by modifying the script:

```typescript
// Add debug logging
console.log("Debug: Order details:", order);
console.log("Debug: Extension:", extension);
console.log("Debug: Network config:", networkConfig);
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For questions or issues:

1. Check the troubleshooting section
2. Review the test files for examples
3. Open an issue on GitHub
4. Join the community discussions

---

**Note**: This script is for educational and testing purposes. Always test thoroughly before using with real funds on mainnet.
