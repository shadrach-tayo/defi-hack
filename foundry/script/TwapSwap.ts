import { ethers } from "hardhat";
import {
  parseEther,
  formatEther,
  hexlify,
  Signer,
  JsonRpcProvider,
  Contract,
  Wallet,
} from "ethers";
import { constants, ether, trim0x } from "@1inch/solidity-utils";
import {
  signOrder,
  buildOrder,
  buildTakerTraits,
  buildMakerTraits,
} from "../test/helpers/orderUtils";
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
import { TWAP as TWAPContract } from "../typechain-types/contracts/Twap.sol/TWAP";
import { TokenMock as TokenContract } from "../typechain-types/contracts/mocks/TokenMock.sol/TokenMock";
import { WrappedTokenMock as WrappedTokenContract } from "../typechain-types/contracts/mocks/WrappedTokenMock.sol/WrappedTokenMock";
import { LimitOrderProtocol } from "../typechain-types/contracts/LimitOrderProtocol";
import LimitOrderProtocolAbi from "../abi/LimitOrderProtocol.json";
import TWAPAbi from "../abi/TWAP.json";
import TokenMockAbi from "../abi/TokenMock.json";
import WrappedTokenMockAbi from "../abi/WrappedTokenMock.json";

// Network configurations
const NETWORK_CONFIG = {
  1: {
    // Ethereum Mainnet
    name: "Ethereum Mainnet",
    lopAddress: "0x1111111254EEB25477B68fb85Ed929f73A960582",
    wethAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    usdcAddress: "0xA0b86a33E6441b8C4C8C8C8C8C8C8C8C8C8C8C8",
    daiAddress: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    twapAddress: "",
    rpcUrl: process.env.MAINNET_RPC_URL,
  },
  42161: {
    // Arbitrum
    name: "Arbitrum",
    lopAddress: "0x1111111254EEB25477B68fb85Ed929f73A960582",
    wethAddress: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
    usdcAddress: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
    daiAddress: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    twapAddress: "",
    rpcUrl:
      process.env.ARBITRUM_RPC_URL ||
      "https://arb-mainnet.g.alchemy.com/v2/your-api-key",
  },
  8453: {
    // Base
    name: "Base",
    lopAddress: "0x1111111254EEB25477B68fb85Ed929f73A960582",
    wethAddress: "0x4200000000000000000000000000000000000006",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    daiAddress: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    twapAddress: "",
    rpcUrl: process.env.BASE_RPC_URL || "https://mainnet.base.org",
  },
  10: {
    // Optimism
    name: "Optimism",
    lopAddress: "0x1111111254EEB25477B68fb85Ed929f73A960582",
    wethAddress: "0x4200000000000000000000000000000000000006",
    usdcAddress: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    daiAddress: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    twapAddress: "",
    rpcUrl: process.env.OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
  },
  137: {
    // Polygon
    name: "Polygon",
    lopAddress: "0x1111111254EEB25477B68fb85Ed929f73A960582",
    wethAddress: "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
    usdcAddress: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
    daiAddress: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
    twapAddress: "",
    rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
  },
  1337: {
    // Local network
    name: "Anvil",
    lopAddress: "0x84ea74d481ee0a5332c457a4d796187f6ba67feb",
    wethAddress: "0xc3e53f4d16ae77db1c982e75a937b9f60fe63690",
    usdcAddress: "0xe6e340d132b5f46d1e472debcd681b2abc16e57e",
    daiAddress: "0x67d269191c92caf3cd7723f116c85e6e9bf55933",
    twapAddress: "0x9e545e3c0baab3e08cdfd552c960a1050f373042",
    rpcUrl: "http://localhost:8545",
  },
  31337: {
    // Local network
    name: "Anvil",
    lopAddress: "0x84ea74d481ee0a5332c457a4d796187f6ba67feb",
    wethAddress: "0xc3e53f4d16ae77db1c982e75a937b9f60fe63690",
    usdcAddress: "0xe6e340d132b5f46d1e472debcd681b2abc16e57e",
    daiAddress: "0x67d269191c92caf3cd7723f116c85e6e9bf55933",
    twapAddress: "0x9e545e3c0baab3e08cdfd552c960a1050f373042",
    rpcUrl: "http://localhost:8545",
  },
};

interface TWAPOrderConfig {
  makerAsset: string;
  takerAsset: string;
  makingAmount: bigint;
  takingAmount: bigint;
  startTime: number;
  endTime: number;
  maxFills: number;
  interval: number;
  fee?: number;
  feeRecipient?: string;
  unwrapWeth?: boolean;
}

interface TWAPSimulationResult {
  orderHash: string;
  orderKey: string;
  fillCount: number;
  totalFilled: bigint;
  remainingAmount: bigint;
  timeRemaining: number;
  canFillNow: boolean;
  nextFillTime: number;
}

class TWAPSwapSimulator {
  private twap: TWAPContract;
  private lop: LimitOrderProtocol;
  private networkConfig: any;
  private resolver: Wallet;
  private maker: Wallet;
  private signer: Wallet;

  constructor(
    twap: TWAPContract,
    lop: LimitOrderProtocol,
    networkConfig: any,
    signer: Wallet,
    resolver: Wallet,
    maker: Wallet
  ) {
    this.twap = twap;
    this.lop = lop;
    this.networkConfig = networkConfig;
    this.maker = maker;
    this.resolver = resolver;
    this.signer = signer;
  }

  /**
   * Create a TWAP order with the specified configuration
   */
  async createTWAPOrder(config: TWAPOrderConfig, makerAddress: string) {
    console.log(`\n🔧 Creating TWAP order on ${this.networkConfig.name}...`);
    console.log(`Maker: ${makerAddress}`);
    console.log(`Maker Asset: ${config.makerAsset}`);
    console.log(`Taker Asset: ${config.takerAsset}`);
    console.log(`Making Amount: ${formatEther(config.makingAmount)}`);
    console.log(`Taking Amount: ${formatEther(config.takingAmount)}`);
    console.log(
      `Time Window: ${new Date(
        config.startTime * 1000
      ).toISOString()} - ${new Date(config.endTime * 1000).toISOString()}`
    );
    console.log(`Max Fills: ${config.maxFills}, Interval: ${config.interval}s`);

    const orderKey = ethers.keccak256(ethers.randomBytes(32));
    const twapAddress = await this.twap.getAddress();

    // Create extension for TWAP integration
    const ext = new Extension({
      makerAssetSuffix: "0x",
      takerAssetSuffix: "0x",
      makerPermit: "0x",
      predicate: this.lop.interface.encodeFunctionData("arbitraryStaticCall", [
        await this.twap.getAddress(),
        this.twap.interface.encodeFunctionData("canExecute", [orderKey]),
      ]),
      makingAmountData: "0x",
      takingAmountData: "0x",
      preInteraction: "0x",
      postInteraction: config.fee
        ? twapAddress +
          trim0x(
            ethers.solidityPacked(
              ["uint16", "address"],
              [config.fee, config.feeRecipient || twapAddress]
            )
          )
        : twapAddress,
      customData: "0x",
    });

    // Build maker traits
    let makerTraits = MakerTraits.default()
      .allowPartialFills()
      .allowMultipleFills()
      .enablePostInteraction()
      .withExtension();

    if (config.unwrapWeth) {
      makerTraits = makerTraits.enableNativeUnwrap();
    }

    if (config.endTime > 0) {
      makerTraits = makerTraits.withExpiration(BigInt(config.endTime));
    }

    // Create limit order
    const limitOrder = new LimitOrder(
      {
        makerAsset: new Address(config.makerAsset),
        takerAsset: new Address(config.takerAsset),
        makingAmount: config.makingAmount,
        takingAmount: config.takingAmount,
        maker: new Address(makerAddress),
        salt: LimitOrder.buildSalt(ext),
        receiver: config.feeRecipient
          ? new Address(config.feeRecipient)
          : undefined,
      },
      makerTraits,
      ext
    );

    const orderHash = await this.lop.hashOrder(limitOrder.build());

    // Setup execution window
    await this.twap
      .connect(this.signer)
      .setupExecutionWindow(
        orderHash,
        orderKey,
        config.startTime,
        config.endTime,
        config.maxFills,
        config.interval
      );

    console.log(`✅ TWAP order created successfully!`);
    console.log(`Order Hash: ${orderHash}`);
    console.log(`Order Key: ${orderKey}`);

    return {
      orderKey,
      orderHash,
      order: limitOrder.build(),
      extension: ext,
      makerTraits,
    };
  }

  /**
   * Execute a TWAP order fill
   */
  async executeTWAPFill(
    order: any,
    extension: Extension,
    takerAddress: string,
    fillAmount: bigint,
    chainId: number
  ) {
    console.log(`\n🚀 Executing TWAP fill...`);
    console.log(`Taker: ${takerAddress}`);
    console.log(`Fill Amount: ${formatEther(fillAmount)}`);

    // Sign the order
    const { r, yParityAndS: vs } = ethers.Signature.from(
      await signOrder(order, chainId, await this.lop.getAddress(), this.signer)
    );

    // Build taker traits
    const takerTraitsBuilder = TakerTraits.default();
    takerTraitsBuilder.setAmountThreshold(fillAmount);
    takerTraitsBuilder.setExtension(extension);
    const takerTraits = takerTraitsBuilder.encode();

    // Execute the fill
    const tx = await this.lop
      .connect(this.signer)
      .fillOrderArgs(
        order,
        r,
        vs,
        fillAmount,
        takerTraits.trait,
        takerTraits.args
      );

    const receipt = await tx.wait();
    console.log(`✅ TWAP fill executed successfully!`);
    console.log(`Transaction Hash: ${receipt?.hash}`);
    console.log(`Gas Used: ${receipt?.gasUsed?.toString()}`);

    return receipt;
  }

  /**
   * Get current status of a TWAP order
   */
  async getTWAPOrderStatus(orderHash: string): Promise<TWAPSimulationResult> {
    const [startTime, endTime, maxFills, interval] =
      await this.twap.getExecutionWindow(orderHash);

    const fillCount = await this.twap.getFillCount(orderHash);
    const canFillNow = await this.twap.canFillNow(orderHash);
    const nextFillTime = await this.twap.getNextFillTime(orderHash);
    const timeRemaining = await this.twap.getTimeRemaining(orderHash);
    const hasReachedMaxFills = await this.twap.hasReachedMaxFills(orderHash);

    const currentTime = Math.floor(Date.now() / 1000);
    const isWithinTimeWindow = await this.twap.isWithinTimeWindow(orderHash);

    return {
      orderHash,
      orderKey: "", // Would need to be passed separately
      fillCount: Number(fillCount),
      totalFilled: 0n, // Would need to track from order details
      remainingAmount: 0n, // Would need to calculate from order details
      timeRemaining: Number(timeRemaining),
      canFillNow,
      nextFillTime: Number(nextFillTime),
    };
  }

  async ensureTokenApproval(
    tokenContract: TokenContract | WrappedTokenContract,
    spender: Wallet,
    amount: bigint
  ) {
    const uint256Max = 1n << (256n - 1n);
    const allowance = await tokenContract.allowance(
      spender.getAddress(),
      tokenContract.getAddress()
    );
    console.log(
      `\n\n Allowance: ${allowance}, spender: ${spender.getAddress()}, tokenContract: ${tokenContract.getAddress()}`
    );
    if (allowance < amount) {
      const tx = await tokenContract
        .connect(spender)
        .approve(spender.getAddress(), uint256Max);

      await tx.wait();

      console.log(`✅ Token approval successful! ${tx.hash}`);
    }
  }

  /**
   * Simulate a complete TWAP execution over time
   */
  async simulateTWAPExecution(
    orderConfig: TWAPOrderConfig,
    makerAddress: string,
    takerAddress: string,
    chainId: number
  ) {
    console.log(`\n📊 Starting TWAP simulation...`);

    // Create the order
    const { orderKey, orderHash, order, extension } =
      await this.createTWAPOrder(orderConfig, makerAddress);

    const results: TWAPSimulationResult[] = [];
    const currentTime = Math.floor(Date.now() / 1000);

    // Wait for execution window to start
    if (currentTime < orderConfig.startTime) {
      const waitTime = orderConfig.startTime - currentTime;
      console.log(
        `⏰ Waiting ${waitTime} seconds for execution window to start...`
      );

      await new Promise((resolve) => setTimeout(resolve, waitTime * 1000));
      // In production, you would wait or use a different approach
    }

    // Simulate fills over time
    for (let i = 0; i < orderConfig.maxFills; i++) {
      const status = await this.getTWAPOrderStatus(orderHash);

      if (!status.canFillNow) {
        console.log(
          `⏸️  Order cannot be filled now. Next fill time: ${new Date(
            status.nextFillTime * 1000
          ).toISOString()}`
        );
        break;
      }

      const fillAmount =
        orderConfig.takingAmount / BigInt(orderConfig.maxFills);

      try {
        await this.ensureTokenApproval(
          new Contract(
            orderConfig.makerAsset,
            TokenMockAbi.abi,
            this.maker
          ) as unknown as TokenContract,
          this.maker,
          orderConfig.makingAmount
        );

        await this.ensureTokenApproval(
          new Contract(
            orderConfig.takerAsset,
            WrappedTokenMockAbi.abi,
            this.maker
          ) as unknown as TokenContract,
          this.maker,
          orderConfig.takingAmount
        );

        await this.executeTWAPFill(
          order,
          extension,
          takerAddress,
          fillAmount,
          chainId
        );

        results.push(await this.getTWAPOrderStatus(orderHash));

        console.log(`✅ Fill ${i + 1}/${orderConfig.maxFills} completed`);

        // Wait for next interval (in simulation, we just log)
        if (i < orderConfig.maxFills - 1) {
          console.log(
            `⏰ Waiting ${orderConfig.interval} seconds for next fill...`
          );
        }
      } catch (error) {
        console.error(`❌ Fill ${i + 1} failed:`, error);
        break;
      }
    }

    return {
      orderHash,
      orderKey,
      results,
      finalStatus: await this.getTWAPOrderStatus(orderHash),
    };
  }

  /**
   * Monitor TWAP orders and execute when conditions are met
   */
  async monitorAndExecuteTWAP(
    orderHash: string,
    order: any,
    extension: Extension,
    takerAddress: string,
    chainId: number,
    maxFills: number
  ) {
    console.log(`\n👀 Monitoring TWAP order: ${orderHash}`);

    let fillCount = 0;

    while (fillCount < maxFills) {
      const status = await this.getTWAPOrderStatus(orderHash);

      console.log(`\n📊 Current Status:`);
      console.log(`- Fill Count: ${status.fillCount}/${maxFills}`);
      console.log(`- Can Fill Now: ${status.canFillNow}`);
      console.log(`- Time Remaining: ${status.timeRemaining}s`);
      console.log(
        `- Next Fill Time: ${new Date(
          status.nextFillTime * 1000
        ).toISOString()}`
      );

      if (status.canFillNow) {
        const fillAmount = order.takingAmount / BigInt(maxFills);

        try {
          await this.executeTWAPFill(
            order,
            extension,
            takerAddress,
            fillAmount,
            chainId
          );

          fillCount++;
          console.log(`✅ Fill ${fillCount}/${maxFills} completed`);

          // Wait for next interval
          if (fillCount < maxFills) {
            console.log(`⏰ Waiting for next fill window...`);
            // In production, you might use a different approach for waiting
          }
        } catch (error) {
          console.error(`❌ Fill failed:`, error);
          break;
        }
      } else {
        console.log(`⏸️  Waiting for next fill window...`);
        // In production, you would implement proper waiting logic
        break;
      }
    }

    console.log(`\n🏁 TWAP execution completed. Total fills: ${fillCount}`);
  }

  async getTokenPrices(tokenAddresses: string[]) {
    const response = await fetch(
      `https://api.1inch.dev/price/v1.1/1/${tokenAddresses.join(",")}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.ONE_INCH_API_KEY}`,
        },
      }
    );

    if (response.status !== 200) {
      throw new Error("Failed to get token prices");
    }

    const data = await response.json();
    console.log("💰 Token Prices:", data);
    return data;
  }

  async estimateTakerAmount(
    makerToken: string,
    takerToken: string,
    makerAmount: number
  ) {
    const tokenPrices = await this.getTokenPrices([makerToken, takerToken]);
    const makerPrice = tokenPrices[makerToken].price;
    const takerPrice = tokenPrices[takerToken].price;
    const takerAmount = (makerAmount * makerPrice) / takerPrice;
    return takerAmount;
  }
}

async function getAccounts(provider: JsonRpcProvider) {
  const chainId = (await provider.getNetwork()).chainId;
  console.log("🌐 Chain ID:", chainId);
  if (chainId === 1337n || chainId === 31337n) {
    const signer = new ethers.Wallet(
      "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
      provider
    );
    const resolver = new ethers.Wallet(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
      provider
    );
    const maker = new ethers.Wallet(
      "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
      provider
    );
    return { resolver, maker, signer };
  } else {
    const privateKey = process.env.PRIVATE_KEY;
    if (!privateKey) {
      throw new Error("PRIVATE_KEY is not set");
    }
    const resolverPrivateKey = process.env.RESOLVER_PRIVATE_KEY;
    if (!resolverPrivateKey) {
      throw new Error("RESOLVER_PRIVATE_KEY is not set");
    }

    const makerPrivateKey = process.env.MAKER_PRIVATE_KEY;
    if (!makerPrivateKey) {
      throw new Error("MAKER_PRIVATE_KEY is not set");
    }
    // Get signer
    const signer = new ethers.Wallet(privateKey, provider);
    const resolver = new ethers.Wallet(resolverPrivateKey, provider);
    const maker = new ethers.Wallet(makerPrivateKey, provider);

    return { resolver, maker, signer };
  }
}
/**
 * Main function to run TWAP swap simulation
 */
async function main() {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("RPC_URL is not set");
  }

  // Get network configuration
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const chainId = (await provider.getNetwork()).chainId;
  const networkConfig = NETWORK_CONFIG[Number(chainId)];

  if (!networkConfig) {
    throw new Error(`Unsupported network: ${chainId}`);
  }

  console.log(
    `🚀 Starting TWAP Swap Simulation on ${networkConfig.name} (${chainId})`
  );

  const { resolver, maker, signer } = await getAccounts(provider);

  console.log(`👤 Signer: ${signer.address}`);
  console.log(`👤 Resolver: ${resolver.address}`);
  console.log(`👤 Maker: ${maker.address}`);

  // Deploy or get TWAP contract
  console.log("\n📦 Setting up contracts...");

  let twap: TWAPContract;
  let lop: LimitOrderProtocol;

  twap = new Contract(
    networkConfig.twapAddress,
    TWAPAbi.abi,
    provider
  ) as unknown as TWAPContract;
  lop = new Contract(
    networkConfig.lopAddress,
    LimitOrderProtocolAbi.abi,
    provider
  ) as unknown as LimitOrderProtocol;

  console.log(`✅ Using existing contracts on ${networkConfig.name}`);

  console.log(`TWAP Address: ${await twap.getAddress()}`);
  console.log(`LOP Address: ${await lop.getAddress()}`);

  // Create simulator
  const simulator = new TWAPSwapSimulator(
    twap,
    lop,
    networkConfig,
    signer,
    resolver,
    maker
  );

  // Example TWAP order configuration
  const currentTime = await provider.getBlockNumber();
  const TEN_MINUTES = 600;
  const ONE_HOUR = 3600;
  const FIVE_MINUTES = 300;
  const ONE_MINUTE = 60;
  const TWAP_INTERVAL = TEN_MINUTES;

  const makerAmount = 10;
  const takerAmount =
    chainId.toString() === "1337" || chainId.toString() === "31337"
      ? ether("1")
      : await simulator.estimateTakerAmount(
          networkConfig.daiAddress,
          networkConfig.wethAddress,
          makerAmount
        );

  const makingAmount = parseEther(makerAmount.toString());
  const takingAmount = parseEther(takerAmount.toString());

  // mint tokens to maker and resolver on testnet
  if (chainId.toString() === "1337" || chainId.toString() === "31337") {
    console.log(`\n\n 💰 Minting tokens to maker and resolver on testnet`);

    const dai = new Contract(
      networkConfig.daiAddress,
      TokenMockAbi.abi,
      signer
    ) as unknown as TokenContract;
    const weth = new Contract(
      networkConfig.wethAddress,
      WrappedTokenMockAbi.abi,
      signer
    ) as unknown as WrappedTokenContract;
    await dai.connect(signer).mint(maker.getAddress(), makingAmount);
    await weth.connect(signer).deposit(resolver.getAddress(), {
      value: takingAmount,
    });

    console.log(
      `💰 Maker DAI Balance: ${formatEther(
        await dai.balanceOf(maker.getAddress())
      )}`
    );
    console.log(
      `💰 Resolver WETH Balance: ${formatEther(
        await weth.balanceOf(resolver.getAddress())
      )}`
    );
    // await dai.mint(resolver.getAddress(), takingAmount);
    // await weth.mint(maker.getAddress(), makingAmount);
  }

  console.log(`💰 Making Amount: ${makingAmount}`);
  console.log(`💰 Taking Amount: ${takingAmount}`);

  const orderConfig: TWAPOrderConfig = {
    makerAsset: networkConfig.daiAddress,
    takerAsset: networkConfig.wethAddress,
    makingAmount: makingAmount,
    takingAmount: takingAmount,
    startTime: currentTime + 60, // Start in 1 minute
    endTime: currentTime + 2 * ONE_MINUTE, // End in 1 hour
    maxFills: 2, // 5 fills
    interval: ONE_MINUTE / 2, // 10 minutes between fills
    // fee: 1000, // 0.1% fee
    feeRecipient: await twap.getAddress(),
    unwrapWeth: false,
  };

  // Example addresses (in production, these would be real addresses)
  const makerAddress = maker.address;
  const takerAddress = resolver.address;

  console.log("\n📋 Order Configuration:");
  console.log(`- Maker Asset: ${orderConfig.makerAsset}`);
  console.log(`- Taker Asset: ${orderConfig.takerAsset}`);
  console.log(`- Making Amount: ${formatEther(orderConfig.makingAmount)} DAI`);
  console.log(`- Taking Amount: ${formatEther(orderConfig.takingAmount)} WETH`);
  console.log(`- Max Fills: ${orderConfig.maxFills}`);
  console.log(`- Interval: ${orderConfig.interval}s`);

  // Create and simulate TWAP order
  const simulation = await simulator.simulateTWAPExecution(
    orderConfig,
    makerAddress,
    takerAddress,
    Number(chainId)
  );

  console.log("\n📊 Simulation Results:");
  console.log(`Order Hash: ${simulation.orderHash}`);
  console.log(`Order Key: ${simulation.orderKey}`);
  console.log(`Final Fill Count: ${simulation.finalStatus.fillCount}`);
  console.log(`Time Remaining: ${simulation.finalStatus.timeRemaining}s`);
  console.log(`Can Fill Now: ${simulation.finalStatus.canFillNow}`);

  // Monitor and execute (commented out for safety in production)
  /*
  console.log("\n👀 Starting monitoring mode...");
  await simulator.monitorAndExecuteTWAP(
    simulation.orderHash,
    simulation.order,
    simulation.extension,
    takerAddress,
    chainId,
    orderConfig.maxFills
  );
  */

  console.log("\n✅ TWAP simulation completed successfully!");
}

// Error handling
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error during TWAP simulation:", error);
    process.exit(1);
  });
