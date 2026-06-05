import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

/**
 * 荷兰拍卖「真实流程」模拟
 *
 * 用法：
 *   npx hardhat run scripts/simulateDutchAuction.ts
 *   npx hardhat run scripts/simulateDutchAuction.ts -- --scenario buy
 *   npx hardhat run scripts/simulateDutchAuction.ts -- --scenario reclaim
 *   npx hardhat run scripts/simulateDutchAuction.ts -- --scenario cancel
 *
 * 模拟内容：
 *   - 7 天拍卖周期（链上用 time.increase 压缩）
 *   - 每隔「1 天」打印一次价格（买家观望）
 *   - buy：买家设心理价位，到价成交
 *   - reclaim：全程无人买，卖家取回
 *   - cancel：开始前卖家取消
 */

type Scenario = "buy" | "reclaim" | "cancel";

const DAY = 86400n;
const AUCTION_DAYS = 7n;

function parseScenario(): Scenario {
  const idx = process.argv.indexOf("--scenario");
  const raw = idx >= 0 ? process.argv[idx + 1] : "buy";
  if (raw === "buy" || raw === "reclaim" || raw === "cancel") return raw;
  return "buy";
}

function fmtEth(wei: bigint): string {
  return `${ethers.formatEther(wei)} ETH`;
}

function fmtTime(ts: bigint): string {
  return new Date(Number(ts) * 1000).toISOString().replace("T", " ").slice(0, 19);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function deployBase(seller: Awaited<ReturnType<typeof ethers.getSigners>>[0]) {
  const START_PRICE = ethers.parseEther("10");
  const END_PRICE = ethers.parseEther("2");

  const now = BigInt(await time.latest());
  const startTime = now + 300n; // 5 分钟后开拍（给 deposit 留窗口）
  const endTime = startTime + AUCTION_DAYS * DAY;

  const GameItem = await ethers.getContractFactory("GameItem");
  const nft = await GameItem.connect(seller).deploy();
  await nft.waitForDeployment();
  await nft.connect(seller).mint("ipfs://simulation-auction");

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

  await nft.connect(seller).approve(await auction.getAddress(), 0n);
  await auction.connect(seller).deposit();

  return { nft, auction, START_PRICE, END_PRICE, startTime, endTime };
}

/** 模拟买家每天来看一次价格 */
async function watchPrices(
  auction: Awaited<ReturnType<typeof deployBase>>["auction"],
  startTime: bigint,
  days: bigint,
  label: string
) {
  console.log(`\n── ${label}：每日观望价格 ──`);
  for (let d = 0n; d <= days; d++) {
    const t = startTime + d * DAY;
    if (t > await auction.endTime()) break;
    await time.increaseTo(t);
    const price = await auction.currentPrice();
    const ts = await time.latest();
    console.log(
      `  [${fmtTime(BigInt(ts))}] 第 ${d} 天 | 当前价: ${fmtEth(price)} | ended: ${await auction.ended()}`
    );
    await sleep(200); // 终端输出节奏，模拟「隔一天来看」
  }
}

async function scenarioBuy() {
  const [seller, alice, bob] = await ethers.getSigners();
  const TARGET = ethers.parseEther("5"); // 买家心理价位 ≤5 ETH 就买

  console.log("\n========== 场景 A：买家观望，到价成交 ==========");
  console.log("卖家:", seller.address);
  console.log("买家 Alice:", alice.address, "（心理价位", fmtEth(TARGET), "）");
  console.log("旁观者 Bob:", bob.address);

  const { nft, auction, startTime, endTime } = await deployBase(seller);
  console.log("\n拍卖已创建");
  console.log("  合约:", await auction.getAddress());
  console.log("  开始:", fmtTime(startTime), "| 结束:", fmtTime(endTime));
  console.log("  价格: 10 ETH → 2 ETH，历时 7 天");

  // 每日观望，到价即买（时间只往前推进，避免 increaseTo 回退）
  console.log(`\n── Alice：每日观望，目标价 ${fmtEth(TARGET)} ──`);
  let bought = false;
  for (let d = 0n; d <= AUCTION_DAYS; d++) {
    const t = startTime + d * DAY;
    await time.increaseTo(t);
    const price = await auction.currentPrice();
    const ts = await time.latest();
    console.log(
      `  [${fmtTime(BigInt(ts))}] 第 ${d} 天 | 当前价: ${fmtEth(price)}`
    );

    if (!bought && price <= TARGET) {
      console.log(`\n✦ Alice 发现价格 ${fmtEth(price)} ≤ 目标价，立即购买`);
      const before = await ethers.provider.getBalance(alice.address);
      const tx = await auction.connect(alice).buy({ value: price });
      await tx.wait();
      const after = await ethers.provider.getBalance(alice.address);
      console.log("  成交! buyer:", await auction.buyer());
      console.log("  NFT owner:", await nft.ownerOf(0n));
      console.log("  Alice 花费约:", fmtEth(before - after), "（含 gas）");
      bought = true;
      break;
    }
    await sleep(200);
  }

  if (!bought) {
    throw new Error("模拟异常：7 天内未触及目标价");
  }
}

async function scenarioReclaim() {
  const [seller, alice] = await ethers.getSigners();

  console.log("\n========== 场景 B：流拍，卖家 reclaim ==========");
  const { nft, auction, startTime } = await deployBase(seller);

  await watchPrices(auction, startTime, AUCTION_DAYS, "Alice（只看不买）");

  const endTime = await auction.endTime();
  await time.increaseTo(endTime);
  console.log(`\n拍卖结束，仍 ended=${await auction.ended()}，Alice 未购买`);

  await auction.connect(seller).reclaim();
  console.log("卖家 reclaim 成功");
  console.log("  NFT owner:", await nft.ownerOf(0n), "（应回到卖家）");
  console.log("  ended:", await auction.ended());
}

async function scenarioCancel() {
  const [seller] = await ethers.getSigners();

  console.log("\n========== 场景 C：开始前卖家取消 ==========");
  const { nft, auction } = await deployBase(seller);

  console.log("开拍前卖家决定不卖了…");
  await auction.connect(seller).cancel();
  console.log("  ended:", await auction.ended());
  console.log("  NFT owner:", await nft.ownerOf(0n), "（应回到卖家）");
}

async function main() {
  const scenario = parseScenario();
  console.log("荷兰拍卖真实流程模拟 | scenario =", scenario);
  console.log("说明：7 天周期用 time.increase 在本地链上瞬间完成\n");

  if (scenario === "buy") await scenarioBuy();
  else if (scenario === "reclaim") await scenarioReclaim();
  else await scenarioCancel();

  console.log("\n========== 模拟完成 ==========");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
