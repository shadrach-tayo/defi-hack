import { ethers } from "hardhat";
import { parseEther, formatEther } from "ethers";
import { TWAP as TWAPContract } from "../typechain-types/contracts/Twap.sol/TWAP";
import { LimitOrderProtocol } from "../typechain-types/contracts/LimitOrderProtocol";

/**
 * Simple TWAP Example
 *
 * This script demonstrates basic TWAP functionality:
 * 1. Deploy contracts (for local testing)
 * 2. Create a simple TWAP order
 * 3. Monitor order status
 * 4. Execute a single fill
 */

async function main() {
  console.log("🚀 Starting Simple TWAP Example...");

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log(`👤 Signer: ${signer.address}`);

  // Deploy contracts for local testing
  console.log("\n📦 Deploying contracts...");

  // Deploy WETH mock
  const WrappedTokenMock = await ethers.getContractFactory("WrappedTokenMock");
  const weth = await WrappedTokenMock.deploy("WETH", "WETH");
  await weth.waitForDeployment();
  console.log(`✅ WETH deployed: ${await weth.getAddress()}`);

  // Deploy Limit Order Protocol
  const LimitOrderProtocol = await ethers.getContractFactory(
    "LimitOrderProtocol"
  );
  const lop = (await LimitOrderProtocol.deploy(
    await weth.getAddress()
  )) as unknown as LimitOrderProtocol;
  await lop.waitForDeployment();
  console.log(`✅ LOP deployed: ${await lop.getAddress()}`);

  // Deploy TWAP
  const TWAP = await ethers.getContractFactory("TWAP");
  const twap = (await TWAP.deploy(
    await lop.getAddress(),
    await weth.getAddress()
  )) as unknown as TWAPContract;
  await twap.waitForDeployment();
  console.log(`✅ TWAP deployed: ${await twap.getAddress()}`);

  // Deploy DAI mock
  const TokenMock = await ethers.getContractFactory("TokenMock");
  const dai = await TokenMock.deploy("DAI", "DAI");
  await dai.waitForDeployment();
  console.log(`✅ DAI deployed: ${await dai.getAddress()}`);

  // Mint some tokens for testing
  await dai.mint(signer.address, parseEther("10000"));
  await weth.connect(signer).deposit({ value: parseEther("10") });
  console.log(`✅ Minted 10,000 DAI and 10 WETH to signer`);

  // Setup TWAP order parameters
  const currentTime = Math.floor(Date.now() / 1000);
  const orderHash = ethers.keccak256(ethers.randomBytes(32));
  const orderKey = ethers.keccak256(ethers.randomBytes(32));

  const startTime = currentTime + 10; // Start in 10 seconds
  const endTime = currentTime + 3600; // End in 1 hour
  const maxFills = 3; // 3 fills maximum
  const interval = 300; // 5 minutes between fills

  console.log("\n📋 TWAP Order Configuration:");
  console.log(`- Order Hash: ${orderHash}`);
  console.log(`- Order Key: ${orderKey}`);
  console.log(`- Start Time: ${new Date(startTime * 1000).toISOString()}`);
  console.log(`- End Time: ${new Date(endTime * 1000).toISOString()}`);
  console.log(`- Max Fills: ${maxFills}`);
  console.log(`- Interval: ${interval} seconds`);

  // Setup execution window
  console.log("\n🔧 Setting up execution window...");
  await twap.setupExecutionWindow(
    orderHash,
    orderKey,
    startTime,
    endTime,
    maxFills,
    interval
  );
  console.log(`✅ Execution window setup complete`);

  // Check initial status
  console.log("\n📊 Initial Order Status:");
  const [
    retrievedStartTime,
    retrievedEndTime,
    retrievedMaxFills,
    retrievedInterval,
  ] = await twap.getExecutionWindow(orderHash);

  console.log(`- Start Time: ${retrievedStartTime}`);
  console.log(`- End Time: ${retrievedEndTime}`);
  console.log(`- Max Fills: ${retrievedMaxFills}`);
  console.log(`- Interval: ${retrievedInterval}`);

  const fillCount = await twap.getFillCount(orderHash);
  const canFillNow = await twap.canFillNow(orderHash);
  const isTWAPOrder = await twap.isTWAPOrder(orderHash);

  console.log(`- Fill Count: ${fillCount}`);
  console.log(`- Can Fill Now: ${canFillNow}`);
  console.log(`- Is TWAP Order: ${isTWAPOrder}`);

  // Wait for execution window to start
  console.log("\n⏰ Waiting for execution window to start...");
  await new Promise((resolve) => setTimeout(resolve, 15000)); // Wait 15 seconds

  // Check status after waiting
  console.log("\n📊 Status After Waiting:");
  const newFillCount = await twap.getFillCount(orderHash);
  const newCanFillNow = await twap.canFillNow(orderHash);
  const nextFillTime = await twap.getNextFillTime(orderHash);
  const timeRemaining = await twap.getTimeRemaining(orderHash);

  console.log(`- Fill Count: ${newFillCount}`);
  console.log(`- Can Fill Now: ${newCanFillNow}`);
  console.log(
    `- Next Fill Time: ${new Date(Number(nextFillTime) * 1000).toISOString()}`
  );
  console.log(`- Time Remaining: ${timeRemaining} seconds`);

  // Record a fill (simulate execution)
  if (newCanFillNow) {
    console.log("\n🚀 Recording fill...");
    await twap.recordFill(orderHash);
    console.log(`✅ Fill recorded successfully`);

    // Check status after fill
    const finalFillCount = await twap.getFillCount(orderHash);
    const finalCanFillNow = await twap.canFillNow(orderHash);
    const hasReachedMaxFills = await twap.hasReachedMaxFills(orderHash);

    console.log("\n📊 Status After Fill:");
    console.log(`- Fill Count: ${finalFillCount}`);
    console.log(`- Can Fill Now: ${finalCanFillNow}`);
    console.log(`- Has Reached Max Fills: ${hasReachedMaxFills}`);
  } else {
    console.log("\n⏸️  Order cannot be filled at this time");
  }

  console.log("\n✅ Simple TWAP example completed!");
}

// Error handling
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error during TWAP example:", error);
    process.exit(1);
  });
