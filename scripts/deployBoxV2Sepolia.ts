/**
 * 仅部署 BoxV2 实现合约到 Sepolia
 *
 * 使用场景：
 *   已有 UUPS 代理地址（VITE_BOX_UUPS_PROXY_ADDRESS），但缺少 V2 实现地址时使用。
 *   V2 实现可单独部署，任意同 bytecode 的 BoxV2 地址均可作为 upgradeToAndCall 目标。
 *
 * 命令：
 *   npx hardhat run scripts/deployBoxV2Sepolia.ts --network sepolia
 *
 * 前置 hardhat/.env：SEPOLIA_RPC_URL、SEPOLIA_PRIVATE_KEY
 */

import { ethers } from "hardhat";
// Hardhat + ethers v6，--network sepolia 时使用 config 中的 RPC 与私钥

async function main() {
  const [deployer] = await ethers.getSigners();
  // 部署账户 = .env 中 SEPOLIA_PRIVATE_KEY 对应地址

  console.log("Deployer:", deployer.address);
  // 打印地址；UUPS 升级时仍需用「代理 owner」钱包，通常即此 deployer

  const BoxV2 = await ethers.getContractFactory("BoxV2");
  // 获取 BoxV2 合约工厂（仅部署实现，不部署代理）

  const implV2 = await BoxV2.deploy();
  // 上链部署 V2 逻辑合约；constructor 内 _disableInitializers()

  await implV2.waitForDeployment();
  // 等待交易确认

  const addr = await implV2.getAddress();
  console.log("BoxV2 implementation:", addr);
  // V2 实现合约地址

  console.log("\n写入 web3-dapp/.env：");
  console.log(`VITE_BOX_UUPS_IMPL_V2_ADDRESS=${addr}`);
  // 复制此行到前端 .env；与已有 VITE_BOX_UUPS_PROXY_ADDRESS 配对使用

  console.log("\n保存后重启 npm run dev");
  // Vite 需重启才能读取新的环境变量
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
  // 部署失败时以非零码退出
});
