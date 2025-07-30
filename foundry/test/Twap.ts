import { expect } from "@1inch/solidity-utils";
import { time } from "@1inch/solidity-utils";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ether } from "./helpers/utils";
import {
  signOrder,
  buildOrder,
  buildTakerTraits,
  buildMakerTraits,
} from "./helpers/orderUtils";
import { deploySwapTokens } from "./helpers/fixtures";
import hre from "hardhat";
import { parseEther } from "ethers";
const { ethers } = hre;

describe("TWAP", function () {
  let addr, addr1, addr2;
  let provider;

  before(async function () {
    if (hre.__SOLIDITY_COVERAGE_RUNNING) {
      this.skip();
    }
    [addr, addr1, addr2] = await ethers.getSigners();
    provider = ethers.provider;

    const currentTime = await (await provider.getBlock("latest")).timestamp;
    console.log("currentTime", currentTime);
  });

  async function deployContractsAndInit() {
    const { dai, weth, swap, chainId } = await deploySwapTokens();

    await dai.mint(addr, ether("2000"));
    await dai.mint(addr1, ether("2000"));
    await dai.mint(addr2, ether("2000"));
    await dai.connect(addr1).approve(swap, ether("2000000"));
    await dai.connect(addr2).approve(swap, ether("2000000"));

    await weth.connect(addr).deposit({ value: ether("100") });
    await weth.connect(addr1).deposit({ value: ether("100") });
    await weth.connect(addr).approve(swap, ether("100"));
    await weth.connect(addr1).approve(swap, ether("100"));

    // Deploy the TWAP contract
    const TWAP = await ethers.getContractFactory("TWAP");
    const twap = await TWAP.deploy(await swap.getAddress());
    await twap.waitForDeployment();

    return {
      dai,
      weth,
      swap,
      chainId,
      twap,
    };
  }

  describe("Basic functionality", function () {
    it("should setup execution window correctly", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 100;
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

      const startTime = (await provider.getBlock("latest")).timestamp + 1000;
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
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 100;
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
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 100;
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
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 1000;
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
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(0));
      console.log("canExecute", await twap.canExecute(orderKey));
    });

    it("should return true during execution window", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 10;
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
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(1));
    });

    it("should return false after execution window ends", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 10;
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
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(0));
    });
  });

  describe("TWAP interval functionality", function () {
    it("should enforce intervals between fills", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 10;
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
      const currentTime = await (await provider.getBlock("latest")).timestamp;
      console.log("currentTime", currentTime);
      console.log("getNextFillTime", await twap.getNextFillTime(orderHash));
      console.log("canExecute", await twap.canExecute(orderKey));
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(1));
      expect(await twap.getNextFillTime(orderHash)).to.equal(startTime);

      // Record first fill
      await twap.recordFill(orderHash);

      // Second fill should not be allowed yet (need to wait for interval)
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(0));
      expect(await twap.getNextFillTime(orderHash)).to.equal(
        startTime + interval
      );

      // Fast forward to allow second fill
      await time.increase(110);

      // Second fill should now be allowed
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(1));
      expect(await twap.getNextFillTime(orderHash)).to.equal(
        startTime + interval
      );

      // Record second fill
      await twap.recordFill(orderHash);

      // Third fill should not be allowed yet
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(0));
      expect(await twap.getNextFillTime(orderHash)).to.equal(
        startTime + interval * 2
      );

      // Fast forward to allow third fill
      await time.increase(110);

      // Third fill should now be allowed
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(1));
    });

    it("should check if can fill now correctly", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 10;
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
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 10;
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
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 10;
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
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(0));
    });
  });

  describe("Time remaining functionality", function () {
    it("should calculate time remaining correctly", async function () {
      const { twap } = await loadFixture(deployContractsAndInit);

      const orderHash = ethers.keccak256(ethers.randomBytes(32));
      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 100;
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
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 10;
      const endTime = startTime + 1000;
      const maxFills = 3;
      const interval = 200;

      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      console.log("orderKey", orderKey);
      // Create order
      const order = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: 1,
          takingAmount: 1,
          maker: addr1.address,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      // Setup execution window for this order
      const orderHash = await swap.hashOrder(order);

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
      const takerTraits = buildTakerTraits({
        threshold: 1,
        extension: order.extension,
      });
      console.log("orderHash", orderHash);
      console.log("orderKey", orderKey);
      console.log("dai", await dai.getAddress());
      console.log("weth", await weth.getAddress());
      console.log("addr1", addr1.address);
      console.log("dai balance", await dai.balanceOf(addr1.address));
      console.log("weth balance", await weth.balanceOf(addr1.address));
      console.log("addr", addr.address);
      console.log("dai balance", await dai.balanceOf(addr.address));
      console.log("weth balance", await weth.balanceOf(addr.address));
      const fillTx = swap
        .connect(addr)
        .fillOrderArgs(order, r, vs, 1, takerTraits.traits, takerTraits.args);
      await expect(fillTx).to.changeTokenBalances(dai, [addr, addr1], [1, -1]);
      await expect(fillTx).to.changeTokenBalances(weth, [addr, addr1], [-1, 1]);

      // Check that fill was recorded
      expect(await twap.getFillCount(orderHash)).to.equal(1);
    });

    it("should allow partial fill", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 10;
      const endTime = startTime + 1000;
      const maxFills = 3;
      const interval = 200;

      const orderKey = ethers.keccak256(ethers.randomBytes(32));

      const makerTraits = buildMakerTraits({
        shouldCheckEpoch: false,
        allowPartialFill: true,
        allowMultipleFills: true,
      });
      console.log("makerTraits", makerTraits);
      // Create order
      const order = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: 1,
          takingAmount: 1,
          maker: addr1.address,
          makerTraits,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      // Setup execution window for this order
      const orderHash = await swap.hashOrder(order);
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
      const takerTraits = buildTakerTraits({
        // threshold: 1,
        extension: order.extension,
      });

      const fillTx1 = swap.connect(addr).fillOrderArgs(
        order,
        r,
        vs,
        parseEther("0.0000000000000000005"),
        // formatEther('500000000000000000'),
        takerTraits.traits,
        takerTraits.args
      );
      // console.log('fillTx1', await fillTx1);

      await expect(fillTx1).to.changeTokenBalances(
        dai,
        [addr, addr1],
        [
          parseEther("0.000000000000000005"),
          -parseEther("0.000000000000000005"),
        ]
      );
      await expect(fillTx1).to.changeTokenBalances(
        weth,
        [addr, addr1],
        [
          -parseEther("0.000000000000000005"),
          parseEther("0.000000000000000005"),
        ]
      );

      // Fast forward to within the window
      await time.increase(200);

      const fillTx = swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          parseEther("0.000000000000000005"),
          takerTraits.traits,
          takerTraits.args
        );
      console.log("fillTx", await fillTx);

      console.log("\n\n");
      console.log("dai", await dai.getAddress());
      console.log("weth", await weth.getAddress());
      console.log("addr1", addr1.address);
      console.log("dai balance", await dai.balanceOf(addr1.address));
      console.log("weth balance", await weth.balanceOf(addr1.address));
      console.log("addr", addr.address);
      console.log("dai balance", await dai.balanceOf(addr.address));
      console.log("weth balance", await weth.balanceOf(addr.address));

      await expect(fillTx).to.changeTokenBalances(
        dai,
        [addr, addr1],
        [
          parseEther("0.0000000000000000005"),
          -parseEther("0.0000000000000000005"),
        ]
      );
      await expect(fillTx).to.changeTokenBalances(
        weth,
        [addr, addr1],
        [
          -parseEther("0.0000000000000000005"),
          parseEther("0.0000000000000000005"),
        ]
      );

      // Check that fill was recorded
      expect(await twap.getFillCount(orderHash)).to.equal(2);
    });

    it("should reject order execution outside time window", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window in the future
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 1000;
      const endTime = startTime + 1000;
      const maxFills = 3;
      const interval = 200;

      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      // Create order
      const order = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: ether("1"),
          takingAmount: ether("1"),
          maker: addr1.address,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      // Setup execution window for this order
      const orderHash = await swap.hashOrder(order);
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
      const takerTraits = buildTakerTraits({
        threshold: ether("1"),
        extension: order.extension,
      });

      await expect(
        swap.fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.traits,
          takerTraits.args
        )
      ).to.be.revertedWithCustomError(swap, "PredicateIsNotTrue");
    });

    it("should reject order execution when max fills reached", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Setup execution window with max fills of 1
      const startTime =
        (await (await provider.getBlock("latest")).timestamp) + 10;
      const endTime = startTime + 1000;
      const maxFills = 1;
      const interval = 200;

      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      // Create order
      const order = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: ether("2"),
          takingAmount: ether("2"),
          maker: addr1.address,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      // Setup execution window for this order
      const orderHash = await swap.hashOrder(order);
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
      const takerTraits = buildTakerTraits({
        threshold: ether("1"),
        extension: order.extension,
      });

      await swap.fillOrderArgs(
        order,
        r,
        vs,
        ether("1"),
        takerTraits.traits,
        takerTraits.args
      );

      // Try to fill again (should fail)
      await expect(
        swap.fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.traits,
          takerTraits.args
        )
      ).to.be.revertedWithCustomError(swap, "PredicateIsNotTrue");
    });

    it("should handle multiple orders with different TWAP settings", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      // Create two different orders with different TWAP settings
      const orderKey1 = ethers.keccak256(ethers.randomBytes(32));
      const orderKey2 = ethers.keccak256(ethers.randomBytes(32));

      const startTime = (await provider.getBlock("latest")).timestamp + 10;
      const endTime = startTime + 1000;

      // Order 1: 2 fills, 100s interval
      const order1 = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: ether("1"),
          takingAmount: ether("1"),
          maker: addr1.address,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey1]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      // Order 2: 3 fills, 200s interval
      const order2 = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: ether("1"),
          takingAmount: ether("1"),
          maker: addr2.address,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey2]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      const orderHash1 = await swap.hashOrder(order1);
      const orderHash2 = await swap.hashOrder(order2);

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
        200 // interval
      );

      // Fast forward to within the window
      await time.increase(20);

      // Fill order 1
      const { r: r1, yParityAndS: vs1 } = ethers.Signature.from(
        await signOrder(order1, chainId, await swap.getAddress(), addr1)
      );
      const takerTraits1 = buildTakerTraits({
        threshold: ether("1"),
        extension: order1.extension,
      });

      await swap
        .connect(addr)
        .fillOrderArgs(
          order1,
          r1,
          vs1,
          ether("1"),
          takerTraits1.traits,
          takerTraits1.args
        );

      // Fill order 2
      const { r: r2, yParityAndS: vs2 } = ethers.Signature.from(
        await signOrder(order2, chainId, await swap.getAddress(), addr2)
      );
      const takerTraits2 = buildTakerTraits({
        threshold: ether("1"),
        extension: order2.extension,
      });

      await swap
        .connect(addr)
        .fillOrderArgs(
          order2,
          r2,
          vs2,
          ether("1"),
          takerTraits2.traits,
          takerTraits2.args
        );

      // Check fill counts
      expect(await twap.getFillCount(orderHash1)).to.equal(1);
      expect(await twap.getFillCount(orderHash2)).to.equal(1);

      // Fast forward to allow second fills
      await time.increase(150); // Between 100s and 200s intervals

      // Order 1 should be fillable again, order 2 should not
      expect(await twap.canExecute(orderKey1)).to.be.equal(BigInt(1));
      expect(await twap.canExecute(orderKey2)).to.be.equal(BigInt(0));

      // Fill order 1 again
      await swap
        .connect(addr)
        .fillOrderArgs(
          order1,
          r1,
          vs1,
          ether("1"),
          takerTraits1.traits,
          takerTraits1.args
        );

      // Order 1 should now be at max fills
      expect(await twap.getFillCount(orderHash1)).to.equal(2);
      expect(await twap.hasReachedMaxFills(orderHash1)).to.be.true;
    });

    it("should handle concurrent fills from multiple takers", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime = (await provider.getBlock("latest")).timestamp + 10;
      const endTime = startTime + 1000;

      const order = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: ether("10"),
          takingAmount: ether("10"),
          maker: addr1.address,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      const orderHash = await swap.hashOrder(order);
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
      const takerTraits = buildTakerTraits({
        threshold: ether("1"),
        extension: order.extension,
      });

      // Multiple takers try to fill simultaneously
      const fillPromises = [
        swap
          .connect(addr)
          .fillOrderArgs(
            order,
            r,
            vs,
            ether("1"),
            takerTraits.traits,
            takerTraits.args
          ),
        swap
          .connect(addr2)
          .fillOrderArgs(
            order,
            r,
            vs,
            ether("1"),
            takerTraits.traits,
            takerTraits.args
          ),
      ];

      // Only one should succeed due to TWAP constraints
      await expect(Promise.race(fillPromises)).to.be.fulfilled;

      // Check that only one fill was recorded
      expect(await twap.getFillCount(orderHash)).to.equal(1);
    });

    it("should handle order cancellation and re-creation", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime = (await provider.getBlock("latest")).timestamp + 10;
      const endTime = startTime + 1000;

      const order = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: ether("1"),
          takingAmount: ether("1"),
          maker: addr1.address,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      const orderHash = await swap.hashOrder(order);
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
      const takerTraits = buildTakerTraits({
        threshold: ether("1"),
        extension: order.extension,
      });

      await swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.traits,
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
            takerTraits.traits,
            takerTraits.args
          )
      ).to.be.revertedWithCustomError(swap, "PredicateIsNotTrue");
    });

    it("should handle edge cases with very short intervals", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime = (await provider.getBlock("latest")).timestamp + 10;
      const endTime = startTime + 1000;

      const order = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: ether("1"),
          takingAmount: ether("1"),
          maker: addr1.address,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      const orderHash = await swap.hashOrder(order);
      await twap.setupExecutionWindow(
        orderHash,
        orderKey,
        startTime,
        endTime,
        3, // maxFills
        1 // very short interval (1 second)
      );

      // Fast forward to within the window
      await time.increase(20);

      const { r, yParityAndS: vs } = ethers.Signature.from(
        await signOrder(order, chainId, await swap.getAddress(), addr1)
      );
      const takerTraits = buildTakerTraits({
        threshold: ether("1"),
        extension: order.extension,
      });

      // First fill
      await swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.traits,
          takerTraits.args
        );

      expect(await twap.getFillCount(orderHash)).to.equal(1);

      // Wait exactly the interval
      await time.increase(1);

      // Second fill should be allowed
      expect(await twap.canExecute(orderKey)).to.be.equal(BigInt(1));

      await swap
        .connect(addr2)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("1"),
          takerTraits.traits,
          takerTraits.args
        );

      expect(await twap.getFillCount(orderHash)).to.equal(2);
    });

    it("should handle large order amounts with TWAP constraints", async function () {
      const { dai, weth, swap, chainId, twap } = await loadFixture(
        deployContractsAndInit
      );

      const orderKey = ethers.keccak256(ethers.randomBytes(32));
      const startTime = (await provider.getBlock("latest")).timestamp + 10;
      const endTime = startTime + 1000;

      // Large order amount
      const largeAmount = ether("1000");

      const order = buildOrder(
        {
          makerAsset: await dai.getAddress(),
          takerAsset: await weth.getAddress(),
          makingAmount: largeAmount,
          takingAmount: largeAmount,
          maker: addr1.address,
        },
        {
          predicate: swap.interface.encodeFunctionData("arbitraryStaticCall", [
            await twap.getAddress(),
            twap.interface.encodeFunctionData("canExecute", [orderKey]),
          ]),
          postInteraction: await twap.getAddress(),
        }
      );

      const orderHash = await swap.hashOrder(order);
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
      const takerTraits = buildTakerTraits({
        threshold: ether("200"), // Partial fill
        extension: order.extension,
      });

      // Fill with large amount
      await swap
        .connect(addr)
        .fillOrderArgs(
          order,
          r,
          vs,
          ether("200"),
          takerTraits.traits,
          takerTraits.args
        );

      expect(await twap.getFillCount(orderHash)).to.equal(1);

      // Check balances changed correctly
      const daiBalanceAfter = await dai.balanceOf(addr.address);
      const wethBalanceAfter = await weth.balanceOf(addr.address);

      expect(daiBalanceAfter).to.be.gt(0);
      expect(wethBalanceAfter).to.be.lt(await weth.balanceOf(addr1.address));
    });
  });
});
