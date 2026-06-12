import { task } from "hardhat/config";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

/**
 * 解析 owner 列表：参数 owners 或 env SEPOLIA_MULTISIG_OWNERS（逗号分隔）
 */
function parseOwners(hre: HardhatRuntimeEnvironment, ownersArg?: string): string[] {
  const raw =
    ownersArg?.trim() ||
    process.env.SEPOLIA_MULTISIG_OWNERS?.trim() ||
    "";
  if (!raw) {
    throw new Error(
      "请提供 --owners 0x...,0x... 或在 .env 设置 SEPOLIA_MULTISIG_OWNERS"
    );
  }
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.map((a) => hre.ethers.getAddress(a));
}

/**
 * Factory 地址：--factory 或 env SEPOLIA_MULTISIG_FACTORY_ADDRESS
 */
function factoryAddr(factoryArg?: string): string {
  const raw =
    factoryArg?.trim() ||
    process.env.SEPOLIA_MULTISIG_FACTORY_ADDRESS?.trim() ||
    "";
  if (!raw) {
    throw new Error(
      "请提供 --factory 0x... 或在 .env 设置 SEPOLIA_MULTISIG_FACTORY_ADDRESS"
    );
  }
  return raw;
}

task("multisig:create", "CREATE2 一键 createWallet（MultisigWalletFactory）")
  .addOptionalParam("factory", "MultisigWalletFactory 地址")
  .addOptionalParam("owners", "owner 地址，逗号分隔")
  .addOptionalParam("threshold", "确认阈值", "2")
  .setAction(async (args, hre) => {
    const fa = factoryAddr(args.factory);
    const owners = parseOwners(hre, args.owners);
    const threshold = Number(args.threshold);

    if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
      throw new Error("threshold 须为 1 ~ owners.length 的整数");
    }

    const [deployer] = await hre.ethers.getSigners();
    console.log("Caller:", deployer.address);
    console.log("Factory:", fa);

    const factory = await hre.ethers.getContractAt("MultisigWalletFactory", fa);
    const salt = await factory.computeSalt(owners, threshold);
    const predicted = await factory.predictAddress(salt);

    console.log("owners:", owners);
    console.log("threshold:", threshold);
    console.log("salt:", salt);
    console.log("predictAddress:", predicted);

    const existing = await factory.walletOf(salt);
    if (existing !== hre.ethers.ZeroAddress) {
      console.log("该 salt 已部署，wallet:", existing);
      return;
    }

    const tx = await factory.createWallet(owners, threshold, salt);
    console.log("tx:", tx.hash);
    const receipt = await tx.wait();
    console.log("block:", receipt?.blockNumber);

    const wallet = await factory.walletOf(salt);
    console.log("\nWallet deployed:", wallet);
    console.log("walletCount:", (await factory.walletCount()).toString());
    console.log("Etherscan:", `https://sepolia.etherscan.io/address/${wallet}`);
  });

task("multisig:predict", "预测 CREATE2 多签钱包地址（不部署）")
  .addOptionalParam("factory", "MultisigWalletFactory 地址")
  .addOptionalParam("owners", "owner 地址，逗号分隔")
  .addOptionalParam("threshold", "确认阈值", "2")
  .setAction(async (args, hre) => {
    const fa = factoryAddr(args.factory);
    const owners = parseOwners(hre, args.owners);
    const threshold = Number(args.threshold);

    if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
      throw new Error("threshold 须为 1 ~ owners.length 的整数");
    }

    const factory = await hre.ethers.getContractAt("MultisigWalletFactory", fa);
    const salt = await factory.computeSalt(owners, threshold);
    const predicted = await factory.predictAddress(salt);
    const existing = await factory.walletOf(salt);

    console.log("salt:", salt);
    console.log("predictAddress:", predicted);
    console.log(
      "deployed:",
      existing === hre.ethers.ZeroAddress ? "(尚未部署)" : existing
    );
  });
