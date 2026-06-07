import { ethers } from "hardhat";

/**
 * 部署生产级 SampleERC20 到 Sepolia（固定总量，一次性 mint 给部署者）。
 *
 * 环境变量（可选）：
 *   TOKEN_NAME / TOKEN_SYMBOL / TOKEN_DECIMALS / TOKEN_SUPPLY（人类可读数量，默认 1000000）
 *
 * 运行：npm run deploy:sepolia:erc20
 */
async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL?.trim();
  const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
  if (!rpc) throw new Error("缺少环境变量 SEPOLIA_RPC_URL");
  if (!pk) throw new Error("缺少环境变量 SEPOLIA_PRIVATE_KEY");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const name = process.env.TOKEN_NAME?.trim() || "Sample Token";
  const symbol = process.env.TOKEN_SYMBOL?.trim() || "SMPL";
  const decimals = Number(process.env.TOKEN_DECIMALS?.trim() || "18");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("TOKEN_DECIMALS 须为 0~18 的整数");
  }

  const supplyHuman = process.env.TOKEN_SUPPLY?.trim() || "1000000";
  const supply = ethers.parseUnits(supplyHuman, decimals);

  const SampleERC20 = await ethers.getContractFactory("SampleERC20");
  const token = await SampleERC20.deploy(name, symbol, decimals, supply);
  await token.waitForDeployment();

  const addr = await token.getAddress();
  console.log("\n========== SampleERC20 部署完成 ==========");
  console.log("Address:   ", addr);
  console.log("Name:      ", await token.name());
  console.log("Symbol:    ", await token.symbol());
  console.log("Decimals:  ", await token.decimals());
  console.log("MaxSupply: ", ethers.formatUnits(await token.maxSupply(), decimals));
  console.log("Owner:     ", await token.owner());
  console.log("Deployer:  ", ethers.formatUnits(await token.balanceOf(deployer.address), decimals), symbol);
  console.log("\n前端 .env：");
  console.log("VITE_SAMPLE_ERC20_ADDRESS=", addr);
  console.log("\n生产建议：");
  console.log("- Etherscan 验证合约源码");
  console.log("- 分发代币后若无需暂停，可调用 renounceOwnership() 放弃管理权");
  console.log("- 英式/荷兰拍卖 ERC20 轮次：买家 approve 或 permit 后出价");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
