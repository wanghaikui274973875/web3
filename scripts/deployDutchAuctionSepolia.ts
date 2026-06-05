import { ethers } from "hardhat";

/**
 * 部署荷兰拍卖到 Sepolia（真实测试网）
 *
 * 前置：.env 中 SEPOLIA_RPC_URL、SEPOLIA_PRIVATE_KEY
 *
 * 运行：npx hardhat run scripts/deployDutchAuctionSepolia.ts --network sepolia
 *
 * 说明：每笔交易等待上链后再发下一笔，避免 RPC 报
 *       "in-flight transaction limit reached for delegated accounts"
 */

async function waitMined(label: string, tx: { wait: (conf?: number) => Promise<unknown> } | null | undefined) {
  if (!tx) return;
  console.log(`  等待上链: ${label}...`);
  await tx.wait(1);
  console.log(`  ✓ ${label} 已确认`);
}

async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL?.trim();
  const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
  if (!rpc) throw new Error("缺少 SEPOLIA_RPC_URL");
  if (!pk) throw new Error("缺少 SEPOLIA_PRIVATE_KEY");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("余额:", ethers.formatEther(balance), "ETH");
  if (balance < ethers.parseEther("0.01")) {
    console.warn("警告：Sepolia ETH 可能不足，请从水龙头领取");
  }

  const now = Math.floor(Date.now() / 1000);
  const startTime = now + 3600; // 1 小时后开拍
  const endTime = startTime + 7 * 86400; // 7 天降价

  console.log("\n[1/4] 部署 GameItem");
  const GameItem = await ethers.getContractFactory("GameItem");
  const nft = await GameItem.deploy();
  await waitMined("GameItem 部署", nft.deploymentTransaction());
  console.log("  GameItem:", await nft.getAddress());

  console.log("\n[2/4] mint NFT #0");
  await waitMined("mint", await nft.mint("ipfs://sepolia-dutch-auction"));

  console.log("\n[3/4] 部署 DutchAuction");
  const DutchAuction = await ethers.getContractFactory("DutchAuction");
  const auction = await DutchAuction.deploy(
    await nft.getAddress(),
    0n,
    ethers.ZeroAddress,
    ethers.parseEther("0.01"),
    ethers.parseEther("0.001"),
    startTime,
    endTime
  );
  await waitMined("DutchAuction 部署", auction.deploymentTransaction());
  const auctionAddr = await auction.getAddress();
  console.log("  DutchAuction:", auctionAddr);

  console.log("\n[4/4] approve + deposit");
  await waitMined("approve", await nft.approve(auctionAddr, 0n));
  await waitMined("deposit", await auction.deposit());
  console.log("  itemDeposited:", await auction.itemDeposited());
  console.log("  NFT owner:", await nft.ownerOf(0n));

  console.log("\n========== 部署完成 ==========");
  console.log("startTime:", new Date(startTime * 1000).toISOString());
  console.log("endTime: ", new Date(endTime * 1000).toISOString());
  console.log("\n开拍后（1 小时）在 Etherscan 或脚本调用：");
  console.log("  currentPrice = await auction.currentPrice()");
  console.log("  await auction.buy({ value: currentPrice })");
  console.log("\n合约地址（请保存）：");
  console.log("  NFT:    ", await nft.getAddress());
  console.log("  Auction:", auctionAddr);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
