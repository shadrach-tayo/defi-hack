import { constants, trim0x } from "@1inch/solidity-utils";
import { assert } from "chai";
import { keccak256, toUtf8String, hexlify } from "ethers";
import { setn } from "./utils";
import { ethers } from "hardhat";
import { IOrderMixin } from "../../typechain-types/@1inch/limit-order-protocol-contract/contracts/LimitOrderProtocol";

const Order = [
  { name: "salt", type: "uint256" },
  { name: "maker", type: "address" },
  { name: "receiver", type: "address" },
  { name: "makerAsset", type: "address" },
  { name: "takerAsset", type: "address" },
  { name: "makingAmount", type: "uint256" },
  { name: "takingAmount", type: "uint256" },
  { name: "makerTraits", type: "uint256" },
];

const ABIOrder = {
  type: "tuple",
  name: "order",
  components: Order,
};

const name = "1inch Limit Order Protocol";
const version = "4";

const _NO_PARTIAL_FILLS_FLAG = 255;
const _ALLOW_MULTIPLE_FILLS_FLAG = 254;
const _NEED_PREINTERACTION_FLAG = 252;
const _NEED_POSTINTERACTION_FLAG = 251;
const _NEED_EPOCH_CHECK_FLAG = 250;
const _HAS_EXTENSION_FLAG = 249;
const _USE_PERMIT2_FLAG = 248;
const _UNWRAP_WETH_FLAG = 247;

const TakerTraitsConstants = {
  _MAKER_AMOUNT_FLAG: 1n << 255n,
  _UNWRAP_WETH_FLAG: 1n << 254n,
  _SKIP_ORDER_PERMIT_FLAG: 1n << 253n,
  _USE_PERMIT2_FLAG: 1n << 252n,
  _ARGS_HAS_TARGET: 1n << 251n,

  _ARGS_EXTENSION_LENGTH_OFFSET: 224n,
  _ARGS_EXTENSION_LENGTH_MASK: 0xffffff,
  _ARGS_INTERACTION_LENGTH_OFFSET: 200n,
  _ARGS_INTERACTION_LENGTH_MASK: 0xffffff,
};

interface TakerTraitsOptions {
  makingAmount?: boolean;
  unwrapWeth?: boolean;
  skipMakerPermit?: boolean;
  usePermit2?: boolean;
  target?: string;
  extension?: string;
  interaction?: string;
  threshold?: bigint;
}

function buildTakerTraits({
  makingAmount = false,
  unwrapWeth = false,
  skipMakerPermit = false,
  usePermit2 = false,
  target = "0x",
  extension = "0x",
  interaction = "0x",
  threshold = 0n,
}: TakerTraitsOptions = {}): { traits: bigint; args: string } {
  return {
    traits:
      BigInt(threshold) |
      ((makingAmount ? TakerTraitsConstants._MAKER_AMOUNT_FLAG : 0n) |
        (unwrapWeth ? TakerTraitsConstants._UNWRAP_WETH_FLAG : 0n) |
        (skipMakerPermit ? TakerTraitsConstants._SKIP_ORDER_PERMIT_FLAG : 0n) |
        (usePermit2 ? TakerTraitsConstants._USE_PERMIT2_FLAG : 0n) |
        (trim0x(target).length > 0
          ? TakerTraitsConstants._ARGS_HAS_TARGET
          : 0n) |
        (BigInt(trim0x(extension).length / 2) <<
          TakerTraitsConstants._ARGS_EXTENSION_LENGTH_OFFSET) |
        (BigInt(trim0x(interaction).length / 2) <<
          TakerTraitsConstants._ARGS_INTERACTION_LENGTH_OFFSET)),
    args: ethers.solidityPacked(
      ["bytes", "bytes", "bytes"],
      [target, extension, interaction]
    ),
  };
}

interface MakerTraitsRFQOptions {
  allowedSender?: string;
  shouldCheckEpoch?: boolean;
  allowPartialFill?: boolean;
  usePermit2?: boolean;
  unwrapWeth?: boolean;
  expiry?: number;
  nonce?: number;
  series?: number;
}

function buildMakerTraitsRFQ({
  allowedSender = constants.ZERO_ADDRESS,
  shouldCheckEpoch = false,
  allowPartialFill = true,
  usePermit2 = false,
  unwrapWeth = false,
  expiry = 0,
  nonce = 0,
  series = 0,
}: MakerTraitsRFQOptions = {}): bigint {
  return buildMakerTraits({
    allowedSender,
    shouldCheckEpoch,
    allowPartialFill,
    allowMultipleFills: false,
    usePermit2,
    unwrapWeth,
    expiry,
    nonce,
    series,
  });
}

interface MakerTraitsOptions {
  allowedSender?: string;
  shouldCheckEpoch?: boolean;
  allowPartialFill?: boolean;
  allowMultipleFills?: boolean;
  usePermit2?: boolean;
  unwrapWeth?: boolean;
  expiry?: number;
  nonce?: number;
  series?: number;
}

function buildMakerTraits({
  allowedSender = constants.ZERO_ADDRESS,
  shouldCheckEpoch = false,
  allowPartialFill = true,
  allowMultipleFills = true,
  usePermit2 = false,
  unwrapWeth = false,
  expiry = 0,
  nonce = 0,
  series = 0,
}: MakerTraitsOptions = {}): bigint {
  let traits = 0n;

  if (allowedSender !== constants.ZERO_ADDRESS) {
    traits = setn(traits, _NO_PARTIAL_FILLS_FLAG, true);
  }

  if (shouldCheckEpoch) {
    traits = setn(traits, _NEED_EPOCH_CHECK_FLAG, true);
  }

  if (!allowPartialFill) {
    traits = setn(traits, _NO_PARTIAL_FILLS_FLAG, true);
  }

  if (allowMultipleFills) {
    traits = setn(traits, _ALLOW_MULTIPLE_FILLS_FLAG, true);
  }

  if (usePermit2) {
    traits = setn(traits, _USE_PERMIT2_FLAG, true);
  }

  if (unwrapWeth) {
    traits = setn(traits, _UNWRAP_WETH_FLAG, true);
  }

  if (expiry > 0) {
    traits = setn(traits, _NEED_POSTINTERACTION_FLAG, true);
  }

  if (nonce > 0) {
    traits = setn(traits, _NEED_PREINTERACTION_FLAG, true);
  }

  if (series > 0) {
    traits = setn(traits, _HAS_EXTENSION_FLAG, true);
  }

  return traits;
}

interface FeeTakerExtensionsOptions {
  feeTaker: string;
  getterExtraPrefix?: string;
  integratorFeeRecipient?: string;
  protocolFeeRecipient?: string;
  makerReceiver?: string;
  integratorFee?: number;
  integratorShare?: number;
  resolverFee?: number;
  whitelistDiscount?: number;
  whitelist?: string;
  whitelistPostInteraction?: string;
  customMakingGetter?: string;
  customTakingGetter?: string;
  customPostInteraction?: string;
}

function buildFeeTakerExtensions({
  feeTaker,
  getterExtraPrefix = "0x",
  integratorFeeRecipient = constants.ZERO_ADDRESS,
  protocolFeeRecipient = constants.ZERO_ADDRESS,
  makerReceiver = undefined,
  integratorFee = 0,
  integratorShare = 50,
  resolverFee = 0,
  whitelistDiscount = 50,
  whitelist = "0x00",
  whitelistPostInteraction = whitelist,
  customMakingGetter = "0x",
  customTakingGetter = "0x",
  customPostInteraction = "0x",
}: FeeTakerExtensionsOptions): { extension: string; postInteraction: string } {
  const extension = ethers.solidityPacked(
    [
      "address",
      "address",
      "address",
      "address",
      "uint256",
      "uint256",
      "uint256",
      "uint256",
      "bytes",
      "bytes",
      "bytes",
    ],
    [
      feeTaker,
      integratorFeeRecipient,
      protocolFeeRecipient,
      makerReceiver || constants.ZERO_ADDRESS,
      integratorFee,
      integratorShare,
      resolverFee,
      whitelistDiscount,
      whitelist,
      customMakingGetter,
      customTakingGetter,
    ]
  );

  const postInteraction = ethers.solidityPacked(
    ["bytes", "bytes"],
    [whitelistPostInteraction, customPostInteraction]
  );

  return { extension, postInteraction };
}

interface OrderRFQOptions {
  maker: string;
  receiver?: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: bigint;
  takingAmount: bigint;
  makerTraits?: string;
}

interface OrderRFQData {
  makerAssetSuffix?: string;
  takerAssetSuffix?: string;
  makingAmountData?: string;
  takingAmountData?: string;
  predicate?: string;
  permit?: string;
  preInteraction?: string;
  postInteraction?: string;
}

function buildOrderRFQ(
  {
    maker,
    receiver = constants.ZERO_ADDRESS,
    makerAsset,
    takerAsset,
    makingAmount,
    takingAmount,
    makerTraits = "0",
  }: OrderRFQOptions,
  {
    makerAssetSuffix = "0x",
    takerAssetSuffix = "0x",
    makingAmountData = "0x",
    takingAmountData = "0x",
    predicate = "0x",
    permit = "0x",
    preInteraction = "0x",
    postInteraction = "0x",
  }: OrderRFQData = {}
): { order: any; signature: string } {
  const order = {
    salt: "0x" + ethers.randomBytes(32).toString(),
    maker,
    receiver,
    makerAsset,
    takerAsset,
    makingAmount,
    takingAmount,
    makerTraits,
    makerAssetSuffix,
    takerAssetSuffix,
    makingAmountData,
    takingAmountData,
    predicate,
    permit,
    preInteraction,
    postInteraction,
  };

  const signature = ethers.solidityPackedKeccak256(
    [
      "bytes32",
      "address",
      "address",
      "address",
      "address",
      "uint256",
      "uint256",
      "uint256",
    ],
    [
      order.salt,
      order.maker,
      order.receiver,
      order.makerAsset,
      order.takerAsset,
      order.makingAmount,
      order.takingAmount,
      order.makerTraits,
    ]
  );

  return { order, signature };
}

interface OrderOptions {
  maker: string;
  receiver?: string;
  makerAsset: string;
  takerAsset: string;
  makingAmount: bigint;
  takingAmount: bigint;
  makerTraits?: bigint;
  salt?: string;
}

interface OrderData {
  makerAssetSuffix?: string;
  takerAssetSuffix?: string;
  makingAmountData?: string;
  takingAmountData?: string;
  predicate?: string;
  permit?: string;
  preInteraction?: string;
  postInteraction?: string;
  customData?: string;
}
function buildOrder(
  {
    maker,
    receiver = constants.ZERO_ADDRESS,
    makerAsset,
    takerAsset,
    makingAmount,
    takingAmount,
    makerTraits = buildMakerTraits(),
    salt = "0x0000000000000000000000000000000000000000000000000000000000000000",
  }: OrderOptions,
  {
    makerAssetSuffix = "0x",
    takerAssetSuffix = "0x",
    makingAmountData = "0x",
    takingAmountData = "0x",
    predicate = "0x",
    permit = "0x",
    preInteraction = "0x",
    postInteraction = "0x",
    customData = "0x",
  }: OrderData = {}
): { order: IOrderMixin.OrderStruct; signature: string } {
  const order = {
    salt,
    maker,
    receiver,
    makerAsset,
    takerAsset,
    makingAmount,
    takingAmount,
    makerTraits,
    makerAssetSuffix,
    takerAssetSuffix,
    makingAmountData,
    takingAmountData,
    predicate,
    permit,
    preInteraction,
    postInteraction,
    customData,
  };

  const signature = ethers.solidityPackedKeccak256(
    [
      "bytes32",
      "address",
      "address",
      "address",
      "address",
      "uint256",
      "uint256",
      "uint256",
    ],
    [
      order.salt,
      order.maker,
      order.receiver,
      order.makerAsset,
      order.takerAsset,
      order.makingAmount,
      order.takingAmount,
      order.makerTraits,
    ]
  );

  return { order, signature };
}

function buildOrderData(
  chainId: number,
  verifyingContract: string,
  order: any
): any {
  return {
    domain: { name, version, chainId, verifyingContract },
    types: { Order },
    value: order,
  };
}

async function signOrder(
  order: any,
  chainId: number,
  target: string,
  wallet: any
): Promise<string> {
  const data = buildOrderData(chainId, target, order);
  return await wallet.signTypedData(data.domain, data.types, data.value);
}

function fillWithMakingAmount(amount: bigint): bigint {
  return amount;
}

function unwrapWethTaker(amount: bigint): bigint {
  return amount;
}

function skipMakerPermit(amount: bigint): bigint {
  return amount;
}

export {
  buildTakerTraits,
  buildMakerTraitsRFQ,
  buildMakerTraits,
  buildFeeTakerExtensions,
  buildOrderRFQ,
  buildOrder,
  buildOrderData,
  signOrder,
  fillWithMakingAmount,
  unwrapWethTaker,
  skipMakerPermit,
};
