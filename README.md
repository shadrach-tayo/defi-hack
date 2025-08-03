# TWAP Protocol

A decentralized Time-Weighted Average Price (TWAP) trading protocol built on Ethereum that enables scheduled order execution with configurable time windows and fill limits.

## Overview

The TWAP Protocol is a sophisticated DeFi trading solution that implements Time-Weighted Average Price execution strategies. It allows traders to execute large orders over time to minimize market impact and achieve better average prices.

## Key Features

### 🕒 Time-Based Execution Windows

- **Configurable Start/End Times**: Set specific time windows for order execution
- **Flexible Intervals**: Define time intervals between fills (e.g., every 5 minutes)
- **Time Validation**: Orders can only be executed within their designated time windows

### 📊 Fill Management

- **Maximum Fill Limits**: Set the maximum number of fills per order
- **Fill Tracking**: Automatic tracking of completed fills
- **Interval Enforcement**: Ensures minimum time between fills for TWAP execution

### 🔒 Security & Control

- **Permissionless Execution**: Anyone can fill orders within the specified constraints
- **Order Validation**: Comprehensive checks for time windows, fill limits, and intervals
- **Fee Support**: Configurable fee collection from taker assets
- **ETH/WETH Support**: Native support for both wrapped and unwrapped ETH

### 🏗️ Architecture

- **Smart Contract Integration**: Built on top of the 1inch Limit Order Protocol
- **Extensible Design**: Modular architecture supporting various trading strategies
- **Gas Efficient**: Optimized for cost-effective execution

## Project Structure

```
defi-hack/
├── foundry/                    # Smart contract development
│   ├── contracts/
│   │   ├── Twap.sol           # Main TWAP contract
│   │   └── LimitOrderProtocol.sol
│   ├── test/
│   │   └── Twap.ts            # Comprehensive test suite
│   └── script/
│       └── DeployTwap.sol     # Deployment scripts
└── web/                       # Frontend application
    ├── app/                   # Next.js application
    └── components/            # React components
```

## Smart Contract Features

### TWAP Contract (`Twap.sol`)

The core contract provides:

- **Execution Window Management**: Setup and manage time-based execution windows
- **Fill Count Tracking**: Monitor and limit the number of order fills
- **Interval Enforcement**: Ensure minimum time between fills
- **Fee Collection**: Support for configurable fee structures
- **Order Validation**: Comprehensive checks for execution conditions

### Key Functions

```solidity
// Setup execution window for an order
function setupExecutionWindow(
    bytes32 orderHash,
    bytes32 orderKey,
    uint256 startTime,
    uint256 endTime,
    uint256 maxFills,
    uint256 interval
) external

// Check if order can be executed
function canExecute(bytes32 orderKey) external view returns (uint256)

// Record a fill (called automatically)
function postInteraction(...) external
```

## Usage Examples

### Basic TWAP Order Setup

```typescript
// Setup a TWAP order with:
// - Start time: now + 1 hour
// - End time: now + 5 hours
// - Max fills: 10
// - Interval: 30 minutes between fills
await twap.setupExecutionWindow(
  orderHash,
  orderKey,
  startTime,
  endTime,
  10, // maxFills
  1800 // interval (30 minutes)
);
```

### Order Execution Flow

1. **Setup**: Configure execution window with time constraints and fill limits
2. **Validation**: Contract checks time window, fill count, and intervals
3. **Execution**: Orders can be filled by anyone within constraints
4. **Tracking**: Fill count and timing automatically recorded
5. **Completion**: Order closes when max fills reached or time expires

## Testing

The project includes comprehensive tests covering:

- ✅ Time window validation
- ✅ Fill count tracking
- ✅ Interval enforcement
- ✅ Fee collection
- ✅ ETH/WETH handling
- ✅ Integration with Limit Order Protocol
- ✅ Edge cases and error conditions

Run tests with:

```bash
cd foundry
forge test
```

## Development

### Prerequisites

- Foundry
- Node.js
- TypeScript

### Setup

```bash
# Install dependencies
cd foundry && forge install
cd web && npm install

# Run tests
cd foundry && forge test

# Start development server
cd web && npm run dev
```

## Security Features

- **Time-based Validation**: Orders can only execute within specified windows
- **Fill Limit Enforcement**: Prevents over-execution of orders
- **Interval Protection**: Ensures proper TWAP execution timing
- **Fee Safety**: Secure fee collection and distribution
- **Access Control**: Owner-only functions for critical operations

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## License

MIT License - see LICENSE file for details.
