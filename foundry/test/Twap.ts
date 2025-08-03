import { expect, time } from "@1inch/solidity-utils";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ether, trim0x } from "./helpers/utils";
import {
  signOrder,
  buildOrder,
  buildTakerTraits,
  buildMakerTraits,
} from "./helpers/orderUtils";
import { deploySwapTokens } from "./helpers/fixtures";
import hre from "hardhat";
import { formatEther, hexlify, N, parseEther } from "ethers";
import type { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import type { Provider } from "ethers";
import { TWAP as TWAPContract } from "../typechain-types/contracts/Twap.sol/TWAP";
import { BigNumber } from "@ethersproject/bignumber";
import {
  Address,
  AmountMode,
  Extension,
  ExtensionBuilder,
  Interaction,
  LimitOrder,
  MakerTraits,
  TakerTraits,
} from "@1inch/limit-order-sdk";
import LimitOrderProtocolAbi from "../abi/LimitOrderProtocol.json";
import { LimitOrderProtocol } from "../typechain-types/contracts/LimitOrderProtocol";

const ethers = (hre as any).ethers;

describe("TWAP", function () {
  let addr: SignerWithAddress,
    addr1: SignerWithAddress,
    addr2: SignerWithAddress;
  let provider: Provider;

  before(async function () {
    [addr, addr1, addr2] = await ethers.getSigners();
    provider = ethers.provider;

    const block = await provider.getBlock("latest");
    const currentTime = block?.timestamp || 0;
    console.log("currentTime", currentTime);
  });

  async function deployContractsAndInit() {
    const { dai, weth, swap, chainId } = await deploySwapTokens();

    await dai.mint(addr1, ether("6000"));
    await dai.connect(addr1).approve(swap, ether("6000"));

    await dai.mint(addr2, ether("6000"));
    await dai.connect(addr2).approve(swap, ether("6000"));

    await weth.connect(addr).deposit({ value: ether("100") });
    await weth.connect(addr).approve(swap, ether("100"));

    await weth.connect(addr2).deposit({ value: ether("100") });
    await weth.connect(addr2).approve(swap, ether("100"));

    // Deploy the TWAP contract
    const TWAP = await ethers.getContractFactory("TWAP");
    const twap = (await TWAP.deploy(
      await swap.getAddress(),
      await weth.getAddress()
    )) as TWAPContract;
    await twap.waitForDeployment();

    return {
      dai,
      weth,
      swap,
      chainId,
      twap,
    };
  }

  async function createTwapOrder({
    makingAmount,
    takingAmount,
    maker,
    taker,
    swap,
    twap,
    makerAsset,
    takerAsset,
    withFees,
  }: {
    makingAmount: bigint;
    takingAmount: bigint;
    maker: Address;
    taker: Address;
    swap: LimitOrderProtocol;
    twap: TWAPContract;
    makerAsset: Address;
    takerAsset: Address;
    withFees?: {
      fee: number;
      feeRecipient: string;
      receiver?: Address;
    };
  }) {
    const orderKey = ethers.keccak256(ethers.randomBytes(32));
    const twapAddress = await twap.getAddress();

    const ext = new Extension({
      makerAssetSuffix: "0x",
      takerAssetSuffix: "0x",
      makerPermit: "0x",
      predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
        await twap.getAddress(),
        twap.interface.encodeFunctionData("canExecute", [orderKey]),
      ]),
      makingAmountData: "0x", // withFees ? await twap.getAddress() : "0x",
      takingAmountData: "0x", // withFees ? await twap.getAddress() : "0x",
      preInteraction: "0x",
      postInteraction:
        twapAddress +
        (withFees
          ? trim0x(
              ethers.solidityPacked(
                ["uint16", "address"],
                [withFees.fee, withFees.feeRecipient]
              )
            )
          : ""),
      customData: "0x",
    });

    const makerTraits = MakerTraits.default()
      .allowPartialFills()
      .allowMultipleFills()
      .enablePostInteraction()
      .withExtension()
      .enableNativeUnwrap();

    const limitOrder = new LimitOrder(
      {
        makerAsset,
        takerAsset,
        makingAmount,
        takingAmount,
        maker,
        salt: LimitOrder.buildSalt(ext),
        receiver: withFees?.receiver ? withFees.receiver : undefined,
      },
      makerTraits,
      ext
    );
    // Setup execution window for this order
    const orderHash = await swap.hashOrder(limitOrder.build());

    return {
      orderKey,
      orderHash,
      order: limitOrder.build(),
      makerTraits,
      extension: ext,
    };
  }

  describe("Basic functionality", function () {
    it("should setup execution window correctly", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 100;
      const endTime = startTime + 1000;
      const maxFills = 5;
      const interval = 200; // 200 seconds between fills

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      const [
        retrievedStartTime,
        retrievedEndTime,
        retrievedMaxFills,
        retrievedInterval,
      ] = await twap.getExecutionWindow(orderHash);

      expect(retrievedStartTime).to.equal(startTime);
      expect(retrievedEndTime).to.equal(endTime);
      expect(retrievedMaxFills).to.equal(maxFills);
      expect(retrievedInterval).to.equal(interval);
      expect(await twap.isTWAPOrder(orderHash)).to.be.true;
    });

    it("should reject invalid execution window", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));

      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 1000;
      const endTime = startTime - 100; // Invalid: end before start
      const maxFills = 5;
      const interval = 200;

      await expect(
        twap.setupExecutionWindow(
          orderHash,
          orderKey,
          startTime,
          endTime,
          maxFills,
          interval
        )
      ).to.be.revertedWithCustomError(twap, "InvalidExecutionWindow");
    });

    it("should reject zero max fills", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 100;
      const endTime = startTime + 1000;
      const maxFills = 0;
      const interval = 200;
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      await expect(
        twap.setupExecutionWindow(
          orderHash,
          orderKey,
          startTime,
          endTime,
          maxFills,
          interval
        )
      ).to.be.revertedWithCustomError(twap, "InvalidMaxFills");
    });

    it("should reject zero interval", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 100;
      const endTime = startTime + 1000;
      const maxFills = 5;
      const interval = 0;
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      await expect(
        twap.setupExecutionWindow(
          orderHash,
          orderKey,
          startTime,
          endTime,
          maxFills,
          interval
        )
      ).to.be.revertedWithCustomError(twap, "InvalidExecutionWindow");
    });
  });

  describe("Time window checks", function () {
    it("should return false before execution window starts", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 1000;
      const endTime = startTime + 1000;
      const maxFills = 5;
      const interval = 200;

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      expect(await twap.isWithinTimeWindow(orderHash)).to.be.false;
      expect(await twap.canFillNow(orderHash)).to.be.equal(false);
      console.log("canExecute", await twap.canFillNow(orderHash));
    });

    it("should return true during execution window", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;
      const maxFills = 5;
      const interval = 200;

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      expect(await twap.isWithinTimeWindow(orderHash)).to.be.true;
      expect(await twap.canFillNow(orderHash)).to.be.equal(true);
    });

    it("should return false after execution window ends", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 100;
      const maxFills = 5;
      const interval = 200;

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward past the window
      await time.increase(200);

      expect(await twap.isWithinTimeWindow(orderHash)).to.be.false;
      expect(await twap.canFillNow(orderHash)).to.be.equal(false);
    });
  });

  describe("TWAP interval functionality", function () {
    it("should enforce intervals between fills", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      let block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;
      const maxFills = 3;
      const interval = 100; // 100 seconds between fills

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to start time
      await time.increase(20);

      // First fill should be allowed
      console.log("startTime", startTime);
      block = await provider.getBlock("latest");
      const currentTime = block?.timestamp || 0;
      console.log("currentTime", currentTime);
      console.log("getNextFillTime", await twap.getNextFillTime(orderHash));
      console.log("canExecute", await twap.canFillNow(orderHash));
      expect(await twap.canFillNow(orderHash)).to.be.equal(true);
      expect(await twap.getNextFillTime(orderHash)).to.equal(startTime);

      // Record first fill
      await twap.recordFill(orderHash);

      // Second fill should not be allowed yet (need to wait for interval)
      expect(await twap.canFillNow(orderHash)).to.be.equal(false);
      expect(await twap.getNextFillTime(orderHash)).to.equal(
        startTime + interval
      );

      // Fast forward to allow second fill
      await time.increase(110);

      // Second fill should now be allowed
      expect(await twap.canFillNow(orderHash)).to.be.equal(true);
      expect(await twap.getNextFillTime(orderHash)).to.equal(
        startTime + interval
      );

      // Record second fill
      await twap.recordFill(orderHash);

      // Third fill should not be allowed yet
      expect(await twap.canFillNow(orderHash)).to.be.equal(false);
      expect(await twap.getNextFillTime(orderHash)).to.equal(
        startTime + interval * 2
      );

      // Fast forward to allow third fill
      await time.increase(110);

      // Third fill should now be allowed
      expect(await twap.canFillNow(orderHash)).to.be.equal(true);
    });

    it("should check if can fill now correctly", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;
      const maxFills = 2;
      const interval = 100;

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Before start time
      expect(await twap.canFillNow(orderHash)).to.be.false;

      // At start time
      await time.increase(20);
      expect(await twap.canFillNow(orderHash)).to.be.true;

      // After first fill but before interval
      await twap.recordFill(orderHash);
      expect(await twap.canFillNow(orderHash)).to.be.false;

      // After interval
      await time.increase(110);
      expect(await twap.canFillNow(orderHash)).to.be.true;
    });
  });

  describe("Fill count tracking", function () {
    it("should track fill counts correctly", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;
      const maxFills = 3;
      const interval = 100;

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      expect(await twap.getFillCount(orderHash)).to.equal(0);
      expect(await twap.hasReachedMaxFills(orderHash)).to.be.false;
      expect(await twap.getRemainingFills(orderHash)).to.equal(3);

      // Record some fills
      await twap.recordFill(orderHash);
      expect(await twap.getFillCount(orderHash)).to.equal(1);
      expect(await twap.hasReachedMaxFills(orderHash)).to.be.false;
      expect(await twap.getRemainingFills(orderHash)).to.equal(2);

      await time.increase(110);
      await twap.recordFill(orderHash);
      expect(await twap.getFillCount(orderHash)).to.equal(2);
      expect(await twap.hasReachedMaxFills(orderHash)).to.be.false;
      expect(await twap.getRemainingFills(orderHash)).to.equal(1);

      await time.increase(110);
      await twap.recordFill(orderHash);
      expect(await twap.getFillCount(orderHash)).to.equal(3);
      expect(await twap.hasReachedMaxFills(orderHash)).to.be.true;
      expect(await twap.getRemainingFills(orderHash)).to.equal(0);

      // Should reject additional fills
      await expect(twap.recordFill(orderHash)).to.be.revertedWithCustomError(
        twap,
        "OrderAlreadyClosed"
      );
    });

    it("should prevent execution when max fills reached", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;
      const maxFills = 2;
      const interval = 100;

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Record fills up to max
      await twap.recordFill(orderHash);
      await time.increase(110);
      await twap.recordFill(orderHash);

      // Should now return false for canExecute
      expect(await twap.canFillNow(orderHash)).to.be.equal(false);
    });
  });

  describe("Time remaining functionality", function () {
    it("should calculate time remaining correctly", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 100;
      const endTime = startTime + 1000;
      const maxFills = 5;
      const interval = 200;

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Before window starts
      expect(await twap.getTimeRemaining(orderHash)).to.equal(1000);

      // During window
      await time.increase(200);
      expect(await twap.getTimeRemaining(orderHash)).to.equal(899);

      // After window ends
      await time.increase(900);
      expect(await twap.getTimeRemaining(orderHash)).to.equal(0);
    });
  });

  describe("Integration with Limit Order Protocol", function () {
    it("should allow order execution within time window and fill limits", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;
      const maxFills = 3;
      const interval = 200;

      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount: ether("1"),
        takingAmount: ether("1"),
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Sign and fill the order
      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );

      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(1n);
      takerTraitsBuilder.setExtension(extension);
      const takerTraits = takerTraitsBuilder.encode();

      console.log("maker dai balance", await dai.balanceOf(addr1.address));
      console.log("maker weth balance", await weth.balanceOf(addr1.address));
      console.log("taker dai balance", await dai.balanceOf(addr.address));
      console.log("taker weth balance", await weth.balanceOf(addr.address));

      const fillTx = swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.trait,
          takerTraits.args
        );

      console.log("\n\n\nPOST FILL");
      console.log("maker dai balance", await dai.balanceOf(addr1.address));
      console.log("maker weth balance", await weth.balanceOf(addr1.address));
      console.log("taker dai balance", await dai.balanceOf(addr.address));
      console.log("taker weth balance", await weth.balanceOf(addr.address));

      await expect(fillTx).to.changeTokenBalances(
        dai,
        [addr, addr1],
        [ether("1"), -ether("1")]
      );
      await expect(fillTx).to.changeTokenBalances(
        weth,
        [addr, addr1],
        [-ether("1"), ether("1")]
      );

      console.log("Fill count", await twap.getFillCount(orderHash));
      // Check that fill was recorded
      expect(await twap.getFillCount(orderHash)).to.equal(1);
    });

    it("should allow partial fill", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 10000;
      const maxFills = 3;
      const interval = 2000;
      const makingAmount = ether("6000");
      const takingAmount = ether("2");

      const orderKey = ethers.keccak256(ethers.randomBytes(32));

      const ext = new Extension({
        makerAssetSuffix: "0x",
        takerAssetSuffix: "0x",
        makerPermit: "0x",
        predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
          await twap.getAddress(),
          twap.interface.encodeFunctionData("canExecute", [orderKey]),
        ]),
        makingAmountData: "0x",
        takingAmountData: "0x",
        preInteraction: "0x",
        postInteraction: await twap.getAddress(),
        customData: "0x",
      });

      const makerTraits = MakerTraits.default()
        .allowPartialFills()
        .allowMultipleFills()
        .enablePostInteraction()
        .withExtension();

      const limitOrder = new LimitOrder(
        {
          makerAsset: new Address(await dai.getAddress()),
          takerAsset: new Address(await weth.getAddress()),
          makingAmount,
          takingAmount,
          maker: new Address(addr1.address),
          salt: LimitOrder.buildSalt(ext),
        },
        makerTraits,
        ext
      );
      // Setup execution window for this order
      const orderHash = await swap.hashOrder(limitOrder.build());
      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Sign and fill the order
      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(
          limitOrder.build(),
          chainId,
          await swap.getAddress(),
          addr1
        )
      );

      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(1n);
      takerTraitsBuilder.setExtension(ext);

      const takerTraits = takerTraitsBuilder.encode();

      console.log("\n\nPRE");
      console.log(
        "maker dai balance",
        formatEther(await dai.balanceOf(addr1.address))
      );
      console.log(
        "maker weth balance",
        formatEther(await weth.balanceOf(addr1.address))
      );
      console.log(
        "taker dai balance",
        formatEther(await dai.balanceOf(addr.address))
      );
      console.log(
        "taker weth balance",
        formatEther(await weth.balanceOf(addr.address))
      );

      const fillTx1 = swap
        .connect(addr)
        .fillOrderArgs(
          limitOrder.build(),
          r,
          vs,
          takingAmount / 2n,
          takerTraits.trait,
          takerTraits.args
        );

      try {
        await fillTx1;
      } catch (err) {
        const errorInterface = new ethers.Interface(LimitOrderProtocolAbi.abi);
        const error = errorInterface.parseError(err);
        console.log("parsed error", error);
        console.log("transaction reverted", err);
        console.log("transaction reverted", (err as any).stack);
        console.log("transaction reverted", (err as any).message);
      }

      console.log("\n\nPOST FILL");
      console.log(
        "maker dai balance",
        formatEther(await dai.balanceOf(addr1.address))
      );
      console.log(
        "maker weth balance",
        formatEther(await weth.balanceOf(addr1.address))
      );
      console.log(
        "taker dai balance",
        formatEther(await dai.balanceOf(addr.address))
      );
      console.log(
        "taker weth balance",
        formatEther(await weth.balanceOf(addr.address))
      );

      await expect(fillTx1).to.changeTokenBalances(
        dai,
        [addr, addr1],
        [makingAmount / 2n, -makingAmount / 2n]
      );
      await expect(fillTx1).to.changeTokenBalances(
        weth,
        [addr, addr1],
        [-takingAmount / 2n, takingAmount / 2n]
      );

      // Fast forward to within the window
      await time.increase(2000);

      const fillTx = swap
        .connect(addr)
        .fillOrderArgs(
          limitOrder.build(),
          r,
          vs,
          takingAmount / 2n,
          takerTraits.trait,
          takerTraits.args
        );

      try {
        await fillTx;
      } catch (err) {
        const errorInterface = new ethers.Interface(LimitOrderProtocolAbi.abi);
        const error = errorInterface.parseError(err);
        console.log("parsed error", error);
        console.log("transaction reverted", err);
        console.log("transaction reverted", (err as any).stack);
        console.log("transaction reverted", (err as any).message);
      }

      await expect(fillTx).to.changeTokenBalances(
        dai,
        [addr, addr1],
        [makingAmount / 2n, -makingAmount / 2n]
      );
      await expect(fillTx).to.changeTokenBalances(
        weth,
        [addr, addr1],
        [-takingAmount / 2n, takingAmount / 2n]
      );

      // Check that fill was recorded
      expect(await twap.getFillCount(orderHash)).to.equal(2);
    });

    it("should reject order execution outside time window", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window in the future
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 1000;
      const endTime = startTime + 1000;
      const maxFills = 3;
      const interval = 200;

      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount: ether("1"),
        takingAmount: ether("1"),
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Try to fill the order before the window starts
      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );

      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(1n);
      takerTraitsBuilder.setExtension(extension);
      const takerTraits = takerTraitsBuilder.encode();

      // Fast forward to outside the window
      await time.increase(5000);

      await expect(
        swap.fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.trait,
          takerTraits.args
        )
      ).to.be.revertedWithCustomError(swap, "PredicateIsNotTrue");
    });

    it("should reject order execution when max fills reached", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window with max fills of 1
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;
      const maxFills = 1;
      const interval = 200;

      // Setup execution window for this order
      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount: ether("2"),
        takingAmount: ether("2"),
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Fill the order once (should succeed)
      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );
      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(1n);
      takerTraitsBuilder.setExtension(extension);
      const takerTraits = takerTraitsBuilder.encode();

      await swap.fillOrderArgs(
        order,
        r,
        vs,
        ether("1"),
        takerTraits.trait,
        takerTraits.args
      );

      // Try to fill again (should fail)
      await expect(
        swap.fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.trait,
          takerTraits.args
        )
      ).to.be.revertedWithCustomError(swap, "PredicateIsNotTrue");
    });

    it("should reject during partial fill if execution window falls within previous fill execution window", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;
      const maxFills = 3;
      const interval = 200;
      const makingAmount = ether("6000");
      const takingAmount = ether("2");

      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount,
        takingAmount,
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Sign and fill the order
      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );
      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(1n);
      takerTraitsBuilder.setExtension(extension);
      const takerTraits = takerTraitsBuilder.encode();

      const fillTx1 = swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          takingAmount / 2n,
          takerTraits.trait,
          takerTraits.args
        );

      await expect(fillTx1).to.changeTokenBalances(
        dai,
        [addr, addr1],
        [makingAmount / 2n, -makingAmount / 2n]
      );
      await expect(fillTx1).to.changeTokenBalances(
        weth,
        [addr, addr1],
        [-takingAmount / 2n, takingAmount / 2n]
      );

      // Fast forward to within the window
      // await time.increase(200);

      const fillTx = swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          takingAmount / 2n,
          takerTraits.trait,
          takerTraits.args
        );

      await expect(fillTx).to.be.revertedWithCustomError(
        swap,
        "PredicateIsNotTrue"
      );
    });

    it("should handle multiple orders with different TWAP settings", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Create two different orders with different TWAP settings
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;

      const {
        orderKey: orderKey1,
        orderHash: orderHash1,
        order: order1,
        extension: extension1,
      } = await createTwapOrder({
        makingAmount: ether("2"),
        takingAmount: ether("2"),
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      const {
        orderKey: orderKey2,
        orderHash: orderHash2,
        order: order2,
        extension: extension2,
      } = await createTwapOrder({
        makingAmount: ether("3"),
        takingAmount: ether("3"),
        maker: new Address(addr2.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      // Setup execution windows
      await twap.setupExecutionWindow(
        orderHash1,
        orderKey1,
        startTime,
        endTime,
        2, // maxFills
        100 // interval
      );

      await twap.setupExecutionWindow(
        orderHash2,
        orderKey2,
        startTime,
        endTime,
        3, // maxFills
        300 // interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Fill order 1
      const { r: r1, yParityAndS: vs1 } = ethers.Signature.from(
        await signOrder(order1, chainId, await swap.getAddress(), addr1)
      );
      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(1n);
      takerTraitsBuilder.setExtension(extension1);
      const takerTraits1 = takerTraitsBuilder.encode();

      await swap
        .connect(addr)
        .fillOrderArgs(
          order1,
          r1,
          vs1,
          ether("1"),
          takerTraits1.trait,
          takerTraits1.args
        );

      // Fill order 2
      const { r: r2, yParityAndS: vs2 } = ethers.Signature.from(
        await signOrder(order2, chainId, await swap.getAddress(), addr2)
      );
      const takerTraitsBuilder2 = TakerTraits.default();
      takerTraitsBuilder2.setAmountThreshold(1n);
      takerTraitsBuilder2.setExtension(extension2);
      const takerTraits2 = takerTraitsBuilder2.encode();

      await swap
        .connect(addr)
        .fillOrderArgs(
          order2,
          r2,
          vs2,
          ether("1"),
          takerTraits2.trait,
          takerTraits2.args
        );

      // Check fill counts
      expect(await twap.getFillCount(orderHash1)).to.equal(1);
      expect(await twap.getFillCount(orderHash2)).to.equal(1);

      // Fast forward to allow second fills
      await time.increase(180); // Between 100s and 200s intervals

      // Order 1 should be fillable again, order 2 should not
      expect(await twap.canFillNow(orderHash1)).to.be.equal(true);
      expect(await twap.canFillNow(orderHash2)).to.be.equal(false);

      // Fill order 1 again
      await swap
        .connect(addr)
        .fillOrderArgs(
          order1,
          r1,
          vs1,
          ether("1"),
          takerTraits1.trait,
          takerTraits1.args
        );

      // Order 1 should now be at max fills
      expect(await twap.getFillCount(orderHash1)).to.equal(2);
      expect(await twap.hasReachedMaxFills(orderHash1)).to.be.true;
    });

    it.skip("should reject concurrent fills from multiple takers (only the first valid fill is permitted)", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;

      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount: ether("10"),
        takingAmount: ether("10"),
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        3, // maxFills
        100 // interval
      );

      // Fast forward to within the window
      await time.increase(20);

      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );

      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(5n);
      takerTraitsBuilder.setExtension(extension);
      const takerTraits = takerTraitsBuilder.encode();

      // Multiple takers try to fill simultaneously
      const fillPromises = [
        swap
          .connect(addr)
          .fillOrderArgs(
            order,
            r,
            vs,
            ether("5"),
            takerTraits.trait,
            takerTraits.args
          ),
        swap
          .connect(addr2)
          .fillOrderArgs(
            order,
            r,
            vs,
            ether("5"),
            takerTraits.trait,
            takerTraits.args
          ),
      ];

      const response = Promise.race(fillPromises);
      // console.log("response", response);
      // Only one should succeed due to TWAP constraints
      expect(response).to.be.revertedWithCustomError(
        swap,
        "PredicateIsNotTrue"
      );

      // await time.increase(100);

      // Check that only one fill was recorded
      console.log("fill count", await twap.getFillCount(orderHash));
      console.log("remaining fills", await twap.getRemainingFills(orderHash));
      expect(await twap.getFillCount(orderHash)).to.equal(1);
    });

    it.skip("should handle order cancellation and re-creation", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;

      // const { order } = buildOrder(
      //   {
      //     makerAsset: await dai.getAddress(),
      //     takerAsset: await weth.getAddress(),
      //     makingAmount: ether("1"),
      //     takingAmount: ether("1"),
      //     maker: addr1.address,
      //     salt: hexlify(BigNumber.from(ethers.randomBytes(32)).toHexString()),
      //   },

      //   {
      //     predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
      //       await twap.getAddress(),
      //       twap.interface.encodeFunctionData("canExecute", [orderKey]),
      //     ]),
      //     postInteraction: await twap.getAddress(),
      //   }
      // );

      // const orderHash = await swap.hashOrder(order);
      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount: ether("1"),
        takingAmount: ether("1"),
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        2, // maxFills
        100 // interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Fill the order once
      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );
      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(1n);
      takerTraitsBuilder.setExtension(extension);
      const takerTraits = takerTraitsBuilder.encode();

      await swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.trait,
          takerTraits.args
        );

      expect(await twap.getFillCount(orderHash)).to.equal(1);

      // Cancel the order (simulate by setting max fills to 0)
      // In a real scenario, this would be done by the maker
      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        1, // maxFills (effectively canceling)
        100 // interval
      );

      // Try to fill again (should fail)
      await expect(
        swap
          .connect(addr2)
          .fillOrderArgs(
            order,
            r,
            vs,
            ether("1"),
            takerTraits.trait,
            takerTraits.args
          )
      ).to.be.revertedWithCustomError(swap, "PredicateIsNotTrue");
    });

    it("should handle edge cases with very short intervals", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;

      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount: ether("2"),
        takingAmount: ether("2"),
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        3, // maxFills
        50 // very short interval (1 second)
      );

      // Fast forward to within the window
      await time.increase(20);

      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );
      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(1n);
      takerTraitsBuilder.setExtension(extension);
      const takerTraits = takerTraitsBuilder.encode();

      // First fill
      await swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.trait,
          takerTraits.args
        );

      expect(await twap.getFillCount(orderHash)).to.equal(1);

      // Wait exactly the interval
      await time.increase(50);

      // Second fill should be allowed
      expect(await twap.canFillNow(orderHash)).to.be.equal(true);

      await swap
        .connect(addr2)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.trait,
          takerTraits.args
        );

      expect(await twap.getFillCount(orderHash)).to.equal(2);
    });

    it("should handle large order amounts with TWAP constraints", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 1000;

      // Large order amount
      await weth.connect(addr).deposit({ value: ether("1000") });
      await weth.connect(addr).approve(swap, ether("1000"));
      const largeAmount = ether("1000");

      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount: largeAmount,
        takingAmount: largeAmount,
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        5, // maxFills
        200 // interval
      );

      // Fast forward to within the window
      await time.increase(20);

      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );
      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(ether("200")); // Partial fill
      takerTraitsBuilder.setExtension(extension);
      const takerTraits = takerTraitsBuilder.encode();

      // Check balances changed correctly
      const daiBalanceBefore = Math.round(
        Number(formatEther(await dai.balanceOf(addr1.address)))
      );
      const wethBalanceBefore = Math.round(
        Number(formatEther(await weth.balanceOf(addr.address)))
      );

      // Fill with large amount
      await swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("200"),
          takerTraits.trait,
          takerTraits.args
        );

      expect(await twap.getFillCount(orderHash)).to.equal(1);

      // Check balances changed correctly
      const daiBalanceAfter = Math.round(
        Number(formatEther(await dai.balanceOf(addr1.address)))
      );
      const wethBalanceAfter = Math.round(
        Number(formatEther(await weth.balanceOf(addr.address)))
      );

      console.log("daiBalanceBefore", daiBalanceBefore);
      console.log("daiBalanceAfter", daiBalanceAfter);
      console.log("wethBalanceBefore", wethBalanceBefore);
      console.log("wethBalanceAfter", wethBalanceAfter);

      expect(daiBalanceAfter).to.be.equal(daiBalanceBefore - 200);
      expect(wethBalanceAfter).to.be.lte(wethBalanceBefore - 200);
    });
  });

  describe("TWAP with fees", async function () {
    it("should charge zero fees from the taker asset", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 3600;
      const maxFills = 3;
      const interval = 1200;

      const fee = 0;
      const feeRecipient = await twap.getAddress();

      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount: ether("10"),
        takingAmount: ether("10"),
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
        withFees: {
          fee,
          feeRecipient,
          receiver: new Address(await twap.getAddress()),
        },
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Sign and fill the order
      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );

      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(10n);
      takerTraitsBuilder.setExtension(extension);
      // takerTraitsBuilder.setAmountMode(AmountMode.taker);
      // takerTraitsBuilder.
      const takerTraits = takerTraitsBuilder.encode();

      console.log("maker dai balance", await dai.balanceOf(addr1.address));
      console.log("maker weth balance", await weth.balanceOf(addr1.address));
      console.log("taker dai balance", await dai.balanceOf(addr.address));
      console.log("taker weth balance", await weth.balanceOf(addr.address));

      const fillTx = swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("10"),
          takerTraits.trait,
          takerTraits.args
        );

      console.log("\n\n\nPOST FILL");
      console.log("maker dai balance", await dai.balanceOf(addr1.address));
      console.log("maker weth balance", await weth.balanceOf(addr1.address));
      console.log("taker dai balance", await dai.balanceOf(addr.address));
      console.log("taker weth balance", await weth.balanceOf(addr.address));

      await expect(fillTx).to.changeTokenBalances(
        dai,
        [addr, addr1],
        [ether("10"), -ether("10")]
      );
      await expect(fillTx).to.changeTokenBalances(
        weth,
        [addr, addr1],
        [-ether("10"), ether("10")]
      );

      console.log("Fill count", await twap.getFillCount(orderHash));
      // Check that fill was recorded
      expect(await twap.getFillCount(orderHash)).to.equal(1);
    });

    it("should charge fees in weth from the taker asset", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 3600;
      const maxFills = 3;
      const interval = 1200;

      const makingAmount = ether("10");
      const takingAmount = ether("10");

      console.log("\n\nMaker", addr1.address);
      console.log("Taker", addr.address);

      const fee = 1e4;
      const feeBase = 1e6;
      const calculatedFee = (takingAmount * BigInt(fee)) / BigInt(feeBase);
      console.log("calculatedFee", formatEther(calculatedFee));
      const feeRecipient = await twap.getAddress();

      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount,
        takingAmount,
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
        withFees: {
          fee,
          feeRecipient,
          receiver: new Address(await twap.getAddress()),
        },
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Sign and fill the order
      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );

      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(10n);
      takerTraitsBuilder.setExtension(extension);
      // takerTraitsBuilder.setAmountMode(AmountMode.taker);
      // takerTraitsBuilder.
      const takerTraits = takerTraitsBuilder.encode();

      console.log(
        "\n\n\n maker dai balance",
        formatEther(await dai.balanceOf(addr1.address))
      );
      console.log(
        "maker weth balance",
        formatEther(await weth.balanceOf(addr1.address))
      );
      console.log(
        "taker dai balance",
        formatEther(await dai.balanceOf(addr.address))
      );
      console.log(
        "taker weth balance",
        formatEther(await weth.balanceOf(addr.address))
      );

      const twapAddress = await twap.getAddress();
      const twapWethBalance = await weth.balanceOf(twapAddress);
      console.log("\n\n\n twap weth balance", formatEther(twapWethBalance));

      const fillTx = swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("10"),
          takerTraits.trait,
          takerTraits.args
        );

      await fillTx;

      const twapWethBalanceAfter = await weth.balanceOf(twapAddress);
      console.log(
        "\n\n\n twap weth balance",
        formatEther(twapWethBalanceAfter)
      );
      console.log("Receiver", addr1.address);
      // expect(twapWethBalanceAfter).to.be.equal(twapWethBalance + calculatedFee);

      await expect(fillTx).to.changeTokenBalances(
        dai,
        [addr, addr1],
        [makingAmount, -makingAmount]
      );
      await expect(fillTx).to.changeTokenBalances(
        weth,
        [addr, addr1, twapAddress],
        [-takingAmount, takingAmount - calculatedFee, calculatedFee]
      );

      console.log("Fill count", await twap.getFillCount(orderHash));
      // Check that fill was recorded
      expect(await twap.getFillCount(orderHash)).to.equal(1);

      console.log("\n\n\nPOST FILL");
      console.log(
        "maker dai balance",
        formatEther(await dai.balanceOf(addr1.address))
      );
      console.log(
        "maker weth balance",
        formatEther(await weth.balanceOf(addr1.address))
      );
      console.log(
        "taker dai balance",
        formatEther(await dai.balanceOf(addr.address))
      );
      console.log(
        "taker weth balance",
        formatEther(await weth.balanceOf(addr.address))
      );
    });

    it("should charge fees in eth from the taker asset", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window
      const block = await provider.getBlock("latest");
      const startTime = (block?.timestamp || 0) + 10;
      const endTime = startTime + 3600;
      const maxFills = 3;
      const interval = 1200;

      const makingAmount = ether("10");
      const takingAmount = ether("10");

      console.log("\n\nMaker", addr1.address);
      console.log("Taker", addr.address);

      const fee = 1e4;
      const feeBase = 1e6;
      const calculatedFee = (takingAmount * BigInt(fee)) / BigInt(feeBase);
      console.log("calculatedFee", formatEther(calculatedFee));
      const feeRecipient = await twap.getAddress();

      const { orderKey, orderHash, order, extension } = await createTwapOrder({
        makingAmount,
        takingAmount,
        maker: new Address(addr1.address),
        taker: new Address(addr.address),
        swap,
        twap,
        makerAsset: new Address(await dai.getAddress()),
        takerAsset: new Address(await weth.getAddress()),
        withFees: {
          fee,
          feeRecipient,
          receiver: new Address(await twap.getAddress()),
        },
      });

      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        maxFills,
        interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Sign and fill the order
      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );

      const takerTraitsBuilder = TakerTraits.default();
      takerTraitsBuilder.setAmountThreshold(10n);
      takerTraitsBuilder.setExtension(extension);
      // takerTraitsBuilder.setAmountMode(AmountMode.taker);
      // takerTraitsBuilder.
      const takerTraits = takerTraitsBuilder.encode();

      console.log(
        "\n\n\n maker dai balance",
        formatEther(await dai.balanceOf(addr1.address))
      );
      console.log(
        "maker weth balance",
        formatEther(await weth.balanceOf(addr1.address))
      );
      console.log(
        "taker dai balance",
        formatEther(await dai.balanceOf(addr.address))
      );
      console.log(
        "taker weth balance",
        formatEther(await weth.balanceOf(addr.address))
      );

      const twapAddress = await twap.getAddress();
      const twapWethBalance = await weth.balanceOf(twapAddress);
      console.log("\n\n\n twap weth balance", formatEther(twapWethBalance));

      const fillTx = swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("10"),
          takerTraits.trait,
          takerTraits.args
        );

      await fillTx;

      const twapWethBalanceAfter = await weth.balanceOf(twapAddress);
      console.log(
        "\n\n\n twap weth balance",
        formatEther(twapWethBalanceAfter)
      );
      console.log("Receiver", addr1.address);
      // expect(twapWethBalanceAfter).to.be.equal(twapWethBalance + calculatedFee);

      await expect(fillTx).to.changeTokenBalances(
        dai,
        [addr, addr1],
        [makingAmount, -makingAmount]
      );
      await expect(fillTx).to.changeTokenBalances(
        weth,
        [addr],
        [-takingAmount]
      );
      await expect(fillTx).to.changeEtherBalances(
        [addr1, twapAddress],
        [takingAmount - calculatedFee, calculatedFee]
      );

      console.log("Fill count", await twap.getFillCount(orderHash));
      // Check that fill was recorded
      expect(await twap.getFillCount(orderHash)).to.equal(1);

      console.log("\n\n\nPOST FILL");
      console.log(
        "maker dai balance",
        formatEther(await dai.balanceOf(addr1.address))
      );
      console.log(
        "maker weth balance",
        formatEther(await weth.balanceOf(addr1.address))
      );
      console.log(
        "taker dai balance",
        formatEther(await dai.balanceOf(addr.address))
      );
      console.log(
        "taker weth balance",
        formatEther(await weth.balanceOf(addr.address))
      );
    });
  });
});
