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
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  },
  networks: {
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: sepoliaPrivateKey()
    }
  }
};

export default config;
