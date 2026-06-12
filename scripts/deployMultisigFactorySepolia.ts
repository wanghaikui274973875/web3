import { ethers } from "hardhat";

/**
 * Sepolia 部署 MultisigWalletFactory（CREATE2 + EIP-1167 克隆）
 *
 * 命令：npm run deploy:sepolia:multisig-factory
 *
 * 可选 .env：
 *   SEPOLIA_MULTISIG_DEMO=1
 *   SEPOLIA_MULTISIG_OWNERS=0x...,0x...,0x...   （缺省：部署者 + 前两个 hardhat 账户不可用，仅用 deployer 重复不行）
 *   SEPOLIA_MULTISIG_THRESHOLD=2
 *
 * 说明：Sepolia 上通常只有 deployer 一个 signer，演示钱包建议手动传 2~3 个 owner 地址。
 */
async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL?.trim();
  const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
  if (!rpc) throw new Error("缺少环境变量 SEPOLIA_RPC_URL");
  if (!pk) throw new Error("缺少环境变量 SEPOLIA_PRIVATE_KEY");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const Factory = await ethers.getContractFactory("MultisigWalletFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();
  const factoryAddr = await factory.getAddress();
  const implAddr = await factory.implementation();

  console.log("\n========== MultisigWalletFactory 部署完成 ==========");
  console.log("Factory:       ", factoryAddr);
  console.log("Implementation:", implAddr);
  console.log("\n写入 web3-dapp/.env：");
  console.log(`VITE_MULTISIG_FACTORY_ADDRESS=${factoryAddr}`);
  console.log("\nHardhat 一键 createWallet：");
  console.log("  npx hardhat multisig:create --network sepolia --factory", factoryAddr);
  console.log("\nEtherscan 验证：");
  console.log(`  npx hardhat verify --network sepolia ${factoryAddr}`);

  const demo = process.env.SEPOLIA_MULTISIG_DEMO?.trim() === "1";
  if (!demo) {
    console.log("\n可选：设置 SEPOLIA_MULTISIG_DEMO=1 并配置 SEPOLIA_MULTISIG_OWNERS 自动 createWallet");
    return;
  }

  const ownersRaw = process.env.SEPOLIA_MULTISIG_OWNERS?.trim();
  const owners = ownersRaw
    ? ownersRaw.split(",").map((s) => s.trim())
    : [deployer.address];
  if (owners.length < 2) {
    throw new Error("演示多签至少需要 2 个 owner，请设置 SEPOLIA_MULTISIG_OWNERS=0x...,0x...");
  }

  const threshold = Number(process.env.SEPOLIA_MULTISIG_THRESHOLD?.trim() || "2");
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > owners.length) {
    throw new Error("SEPOLIA_MULTISIG_THRESHOLD 须为 1~owners.length 的整数");
  }

  const salt = await factory.computeSalt(owners, threshold);
  const predicted = await factory.predictAddress(salt);
  console.log("\n--- 演示 createWallet ---");
  console.log("owners:", owners);
  console.log("threshold:", threshold);
  console.log("salt:", salt);
  console.log("predictAddress:", predicted);

  const tx = await factory.createWallet(owners, threshold, salt);
  await tx.wait();
  const wallet = await factory.walletOf(salt);
  console.log("Wallet deployed:", wallet);
  console.log("walletCount:", (await factory.walletCount()).toString());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
