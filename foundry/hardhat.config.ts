import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@matterlabs/hardhat-zksync-deploy";
import "@matterlabs/hardhat-zksync-solc";
import "@nomicfoundation/hardhat-chai-matchers";
import "solidity-coverage";
import "solidity-docgen";
import "hardhat-dependency-compiler";
import "hardhat-deploy";
import "hardhat-gas-reporter";
import "hardhat-tracer";
import dotenv from "dotenv";
// import { oneInchTemplates } from "@1inch/solidity-utils/dist/docgen";
import { Networks, getNetwork } from "@1inch/solidity-utils/hardhat-setup";
import { HardhatNetworkUserConfig } from "hardhat/types";

dotenv.config();

if (getNetwork().indexOf("zksync") !== -1) {
  import("@matterlabs/hardhat-zksync-verify");
} else {
  import("@nomicfoundation/hardhat-verify");
}

const { networks, etherscan } = new Networks().registerAll();

const config: HardhatUserConfig = {
  etherscan,
  solidity: {
    version: "0.8.28",
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
  networks,
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

module.exports = config;
