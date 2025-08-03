import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

// import "@nomicfoundation/hardhat-toolbox-viem";
import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";
import "@nomicfoundation/hardhat-chai-matchers";
import "solidity-coverage";
import "solidity-docgen";
import "hardhat-dependency-compiler";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import "hardhat-tracer";

import "@typechain/hardhat";
import "@nomicfoundation/hardhat-ethers";

import "dotenv/config";

import { Networks, getNetwork } from "@1inch/solidity-utils/hardhat-setup";
import { HardhatNetworkUserConfig } from "hardhat/types";

if (getNetwork().indexOf("zksync") !== -1) {
  import("@matterlabs/hardhat-zksync-verify");
} else {
  import("@nomicfoundation/hardhat-verify");
}

const { networks, etherscan } = new Networks().registerAll();
console.log(networks);
const config: HardhatUserConfig = {
  etherscan,
  solidity: {
    version: "0.8.23",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1_000_000,
      },
      evmVersion:
        (networks[getNetwork()] as HardhatNetworkUserConfig)?.hardfork ||
        "shanghai",
      viaIR: true,
    },
  },
  networks: {
    ...networks,
    // mainnet: {
    //   chainId: 1,
    //   url: process.env.MAINNET_RPC_URL,
    //   accounts: [
    //     process.env.PRIVATE_KEY!,
    //     process.env.RESOLVER_PRIVATE_KEY!,
    //     process.env.MAKER_PRIVATE_KEY!,
    //   ],
    //   gas: 10000000,
    //   gasPrice: 10000000000,
    // },
  },
  namedAccounts: {
    deployer: {
      default: 0,
    },
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
  },
  // dependencyCompiler: {
  //   paths: [
  //     "@1inch/solidity-utils/contracts/mocks/TokenCustomDecimalsMock.sol",
  //     "@1inch/solidity-utils/contracts/mocks/TokenMock.sol",
  //     "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxyFactory.sol",
  //   ],
  // },
  // zksolc: {
  //   version: "1.4.0",
  //   compilerSource: "binary",
  //   settings: {},
  // },
  // docgen: {
  //   outputDir: "docs",
  //   templates: oneInchTemplates(),
  //   pages: "files",
  //   exclude: ["mocks"],
  // },
};

export default config;
