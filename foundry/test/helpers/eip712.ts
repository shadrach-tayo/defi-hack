import { TypedDataVersion } from "@1inch/solidity-utils";
import { TypedDataUtils } from "@metamask/eth-sig-util";
import { cutSelector, trim0x } from "./utils";
import { ethers } from "hardhat";

const EIP712Domain = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
];

const Permit = [
  { name: "owner", type: "address" },
  { name: "spender", type: "address" },
  { name: "value", type: "uint256" },
  { name: "nonce", type: "uint256" },
  { name: "deadline", type: "uint256" },
];

function domainSeparator(
  name: string,
  version: string,
  chainId: number | bigint,
  verifyingContract: string
): string {
  return (
    "0x" +
    TypedDataUtils.hashStruct(
      "EIP712Domain",
      { name, version, chainId, verifyingContract },
      { EIP712Domain },
      TypedDataVersion
    ).toString("hex")
  );
}

function buildData(
  owner: string,
  name: string,
  version: string,
  chainId: number | bigint,
  verifyingContract: string,
  spender: string,
  nonce: number | bigint,
  value: number | bigint,
  deadline: number | bigint
) {
  return {
    domain: { name, version, chainId, verifyingContract },
    types: { Permit },
    value: { owner, spender, value, nonce, deadline },
  };
}

const defaultDeadline = "18446744073709551615";

async function getPermit(
  owner: string,
  wallet: any,
  token: any,
  tokenVersion: string,
  chainId: number | bigint,
  spender: string,
  value: number | bigint,
  deadline: string = defaultDeadline
): Promise<string> {
  const nonce = await token.nonces(owner);
  const name = await token.name();
  const data = buildData(
    owner,
    name,
    tokenVersion,
    chainId,
    await token.getAddress(),
    spender,
    nonce,
    value,
    deadline
  );
  const signature = await wallet.signTypedData(
    data.domain,
    data.types,
    data.value
  );
  const { v, r, s } = ethers.Signature.from(signature);
  const permitCall = token.interface.encodeFunctionData("permit", [
    owner,
    spender,
    value,
    deadline,
    v,
    r,
    s,
  ]);
  return cutSelector(permitCall);
}

function withTarget(target: string, data: string): string {
  return target.toString() + trim0x(data);
}

export { EIP712Domain, Permit, domainSeparator, getPermit, withTarget };
