import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { DutchAuction, GameItem } from "../typechain-types";

/**
 * 真实时间线模拟测试：7 天降价、每日查价、到价成交 / 流拍取回
 */
describe("DutchAuction 真实流程模拟", function () {
  const DAY = 86400n;
  const START = ethers.parseEther("10");
  const END = ethers.parseEther("2");

  async function setup() {
    const [seller, buyer] = await ethers.getSigners();
    const now = BigInt(await time.latest());
    const startTime = now + 60n;
    const endTime = startTime + 7n * DAY;

    const GameItem = await ethers.getContractFactory("GameItem");
    const nft = (await GameItem.deploy()) as unknown as GameItem;
    await nft.waitForDeployment();
    await nft.connect(seller).mint("sim");

    const DutchAuction = await ethers.getContractFactory("DutchAuction");
    const auction = (await DutchAuction.connect(seller).deploy(
      await nft.getAddress(),
      0n,
      ethers.ZeroAddress,
      START,
      END,
      startTime,
      endTime
    )) as unknown as DutchAuction;
    await auction.waitForDeployment();
    await nft.connect(seller).approve(await auction.getAddress(), 0n);
    await auction.connect(seller).deposit();

    return { seller, buyer, nft, auction, startTime, endTime, tokenId: 0n };
  }

  it("模拟 7 天降价曲线单调递减", async function () {
    const { auction, startTime } = await setup();
    let last = START;

    for (let d = 0n; d <= 7n; d++) {
      await time.increaseTo(startTime + d * DAY);
      const p = await auction.currentPrice();
      expect(p).to.be.lte(last);
      last = p;
    }
    expect(last).to.equal(END);
  });

  it("模拟：买家在第 4 天价格合适时成交", async function () {
    const { auction, nft, buyer, startTime, tokenId } = await setup();
    const TARGET = ethers.parseEther("6"); // 第 3 天价格约 6.57 ETH，第 4 天约 5.43 ETH

    let boughtAt: bigint | undefined;
    for (let d = 0n; d <= 7n; d++) {
      await time.increaseTo(startTime + d * DAY);
      const price = await auction.currentPrice();
      if (price <= TARGET) {
        await auction.connect(buyer).buy({ value: price });
        boughtAt = d;
        break;
      }
    }

    expect(boughtAt !== undefined).to.equal(true);
    expect(await auction.ended()).to.equal(true);
    expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
  });

  it("模拟：7 天结束无人购买，卖家 reclaim", async function () {
    const { auction, nft, seller, endTime, tokenId } = await setup();

    await time.increaseTo(endTime);
    expect(await auction.ended()).to.equal(false);

    await auction.connect(seller).reclaim();
    expect(await auction.ended()).to.equal(true);
    expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
  });
});
