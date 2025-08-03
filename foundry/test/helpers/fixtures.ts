import { constants } from "@1inch/solidity-utils";
import { ethers } from "hardhat";
import { BaseContract } from "ethers";
import { TokenMock } from "../../typechain-types/contracts/mocks/TokenMock";
import { WrappedTokenMock } from "../../typechain-types/contracts/mocks/WrappedTokenMock";
import { LimitOrderProtocol } from "../../typechain-types/@1inch/limit-order-protocol-contract/contracts/LimitOrderProtocol";
import { TokenCustomDecimalsMock } from "../../typechain-types/contracts/mocks/TokenCustomDecimalsMock";

interface SwapTokens {
  dai: TokenMock;
  weth: WrappedTokenMock;
  inch: TokenMock;
  swap: LimitOrderProtocol;
  chainId: number;
  usdc: TokenCustomDecimalsMock;
}

async function deploySwapTokens(): Promise<SwapTokens> {
  const TokenMock = await ethers.getContractFactory("TokenMock");
  const dai = await TokenMock.deploy("DAI", "DAI");
  await dai.waitForDeployment();
  const WrappedTokenMock = await ethers.getContractFactory("WrappedTokenMock");
  const weth = await WrappedTokenMock.deploy("WETH", "WETH");
  await weth.waitForDeployment();
  const inch = await TokenMock.deploy("1INCH", "1INCH");
  await inch.waitForDeployment();
  const LimitOrderProtocol = await ethers.getContractFactory(
    "LimitOrderProtocol"
  );
  const swap = await LimitOrderProtocol.deploy(weth);
  await swap.waitForDeployment();
  const TokenCustomDecimalsMock = await ethers.getContractFactory(
    "TokenCustomDecimalsMock"
  );
  const usdc = await TokenCustomDecimalsMock.deploy("USDC", "USDC", "0", 6);
  await usdc.waitForDeployment();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  return { dai, weth, inch, swap, chainId, usdc };
}

async function deploySwap(): Promise<{ swap: BaseContract }> {
  const LimitOrderProtocol = await ethers.getContractFactory(
    "LimitOrderProtocol"
  );
  const swap = await LimitOrderProtocol.deploy(constants.ZERO_ADDRESS);
  await swap.waitForDeployment();
  return { swap };
}

async function deployUSDC(): Promise<{ usdc: BaseContract }> {
  const TokenMock = await ethers.getContractFactory("TokenMock");
  const usdc = await TokenMock.deploy("USDC", "USDC");
  await usdc.waitForDeployment();
  return { usdc };
}

async function deployArbitraryPredicate(): Promise<{
  arbitraryPredicate: BaseContract;
}> {
  const ArbitraryPredicateMock = await ethers.getContractFactory(
    "ArbitraryPredicateMock"
  );
  const arbitraryPredicate = await ArbitraryPredicateMock.deploy();
  await arbitraryPredicate.waitForDeployment();
  return { arbitraryPredicate };
}

async function deployUSDT(): Promise<{ usdt: BaseContract }> {
  const TokenMock = await ethers.getContractFactory("TokenMock");
  const usdt = await TokenMock.deploy("USDT", "USDT");
  await usdt.waitForDeployment();
  return { usdt };
}

async function deploySeriesEpochManager(): Promise<{
  seriesEpochManager: BaseContract;
}> {
  const SeriesEpochManager = await ethers.getContractFactory(
    "SeriesEpochManager"
  );
  const seriesEpochManager = await SeriesEpochManager.deploy();
  await seriesEpochManager.waitForDeployment();
  return { seriesEpochManager };
}

async function deployRangeAmountCalculator(): Promise<{
  rangeAmountCalculator: BaseContract;
}> {
  const RangeAmountCalculator = await ethers.getContractFactory(
    "RangeAmountCalculator"
  );
  const rangeAmountCalculator = await RangeAmountCalculator.deploy();
  await rangeAmountCalculator.waitForDeployment();
  return { rangeAmountCalculator };
}

export {
  deploySwapTokens,
  deploySeriesEpochManager,
  deployRangeAmountCalculator,
  deployUSDT,
  deployUSDC,
  deployArbitraryPredicate,
  deploySwap,
};
