import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

function sepoliaPrivateKey(): string[] {
  const raw = process.env.SEPOLIA_PRIVATE_KEY?.trim();
  if (!raw) return [];
  const key = raw.startsWith("0x") ? raw : `0x${raw}`;
  return [key];
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.30",
    settings: {
      evmVersion: "cancun"
    }
  },
  networks: {
    // 内置链：跑测试/脚本用；取消 mining 注释后 `npx hardhat node` 每 12s 出一个块
    // hardhat: { mining: { auto: true, interval: 12_000 } },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: sepoliaPrivateKey(),
      timeout: 120_000
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || ""
  }
};

export default config;
