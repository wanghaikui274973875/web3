import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * 荷兰拍卖手动测试脚本（本地 Hardhat 网络）
 *
 * 运行：npx hardhat run scripts/manualDutchAuction.ts
 *
 * 每一步都会打印状态，便于对照合约逻辑理解。
 */
async function main() {
  const [seller, buyer] = await ethers.getSigners();
  console.log("=== 账户 ===");
  console.log("卖家 seller:", seller.address);
  console.log("买家 buyer:", buyer.address);

  // ── Step 1: 部署 NFT 并 mint ──────────────────────────────────────────────
  console.log("\n[Step 1] 部署 GameItem 并 mint NFT #0 给卖家");
  const GameItem = await ethers.getContractFactory("GameItem");
  const nft = await GameItem.connect(seller).deploy();
  await nft.waitForDeployment();
  await nft.connect(seller).mint("ipfs://manual-test-nft");
  console.log("  GameItem:", await nft.getAddress());
  console.log("  NFT #0 owner:", await nft.ownerOf(0n));

  // ── Step 2: 设定拍卖时间参数 ──────────────────────────────────────────────
  const START_PRICE = ethers.parseEther("10");
  const END_PRICE = ethers.parseEther("1");
  const DURATION = 3600n; // 1 小时降价区间（演示用）

  const now = BigInt(await time.latest());
  const startTime = now + 60n; // 1 分钟后开始降价
  const endTime = startTime + DURATION;

  console.log("\n[Step 2] 拍卖参数");
  console.log("  起始价:", ethers.formatEther(START_PRICE), "ETH");
  console.log("  最低价:", ethers.formatEther(END_PRICE), "ETH");
  console.log("  startTime:", startTime.toString());
  console.log("  endTime:  ", endTime.toString());

  // ── Step 3: 卖家部署 DutchAuction ─────────────────────────────────────────
  console.log("\n[Step 3] 卖家部署 DutchAuction");
  const DutchAuction = await ethers.getContractFactory("DutchAuction");
  const auction = await DutchAuction.connect(seller).deploy(
    await nft.getAddress(),
    0n,
    ethers.ZeroAddress,
    START_PRICE,
    END_PRICE,
    startTime,
    endTime
  );
  await auction.waitForDeployment();
  const auctionAddr = await auction.getAddress();
  console.log("  DutchAuction:", auctionAddr);
  console.log("  itemDeposited:", await auction.itemDeposited());

  // ── Step 4: approve + deposit ───────────────────────────────────────────────
  console.log("\n[Step 4] 卖家 approve 并 deposit 托管 NFT");
  await nft.connect(seller).approve(auctionAddr, 0n);
  await auction.connect(seller).deposit();
  console.log("  itemDeposited:", await auction.itemDeposited());
  console.log("  NFT #0 owner:", await nft.ownerOf(0n), "(应为拍卖合约)");

  // ── Step 5: 查看降价前价格 ─────────────────────────────────────────────────
  console.log("\n[Step 5] 降价开始前查询 currentPrice");
  console.log("  currentPrice:", ethers.formatEther(await auction.currentPrice()), "ETH");

  // ── Step 6: 开始前 buy（应失败）──────────────────────────────────────────
  console.log("\n[Step 6] 买家在 startTime 之前 buy（预期失败 AuctionNotStarted）");
  try {
    await auction.connect(buyer).buy({ value: START_PRICE });
    console.log("  意外成功（不应发生）");
  } catch (e: unknown) {
    console.log("  已 revert ✓");
  }

  // ── Step 7: 快进到降价中期 ─────────────────────────────────────────────────
  const buyTime = startTime + DURATION / 2n;
  console.log("\n[Step 7] 快进到降价中期 buyTime =", buyTime.toString());
  await time.increaseTo(buyTime);
  const price = await auction.currentPrice();
  console.log("  currentPrice:", ethers.formatEther(price), "ETH");

  // ── Step 8: 买家购买（多付 0.1 ETH 测退款）────────────────────────────────
  console.log("\n[Step 8] 买家 buy，多付 0.1 ETH 测试退款");
  const overpay = ethers.parseEther("0.1");
  const sellerEthBefore = await ethers.provider.getBalance(seller.address);
  const buyerEthBefore = await ethers.provider.getBalance(buyer.address);

  const tx = await auction.connect(buyer).buy({ value: price + overpay });
  const receipt = await tx.wait();
  const gas = receipt!.gasUsed * receipt!.gasPrice;

  console.log("  ended:", await auction.ended());
  console.log("  buyer:", await auction.buyer());
  console.log("  NFT #0 owner:", await nft.ownerOf(0n), "(应为买家)");
  console.log("  卖家 ETH 增加:", ethers.formatEther(
    (await ethers.provider.getBalance(seller.address)) - sellerEthBefore
  ));
  console.log("  买家净花费约:", ethers.formatEther(
    buyerEthBefore - (await ethers.provider.getBalance(buyer.address)) - gas
  ), "ETH（含 gas）");

  // ── Step 9: 再次 buy（应失败）──────────────────────────────────────────────
  console.log("\n[Step 9] 再次 buy（预期失败 AuctionEnded）");
  try {
    await auction.connect(buyer).buy({ value: price });
    console.log("  意外成功（不应发生）");
  } catch {
    console.log("  已 revert ✓");
  }

  console.log("\n=== 手动测试脚本完成 ===");
  console.log("若要测 cancel / reclaim，请用 Hardhat console 按文档单独操作。");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
