import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { DutchAuction, GameItem } from "../typechain-types";

describe("DutchAuction", function () {
  const START_PRICE = ethers.parseEther("10");
  const END_PRICE = ethers.parseEther("1");
  const DURATION = 1000n;

  async function deployAuction(opts?: {
    paymentToken?: string;
    startTimeOffset?: bigint;
  }) {
    const [seller, buyer, other] = await ethers.getSigners();
    const now = BigInt(await time.latest());
    const startTime = now + (opts?.startTimeOffset ?? 100n);
    const endTime = startTime + DURATION;

    const GameItem = await ethers.getContractFactory("GameItem");
    const nft = (await GameItem.deploy()) as unknown as GameItem;
    await nft.waitForDeployment();

    const uri = "ipfs://auction-item";
    await nft.connect(seller).mint(uri);
    const tokenId = 0n;

    const DutchAuction = await ethers.getContractFactory("DutchAuction");
    const auction = (await DutchAuction.connect(seller).deploy(
      await nft.getAddress(),
      tokenId,
      opts?.paymentToken ?? ethers.ZeroAddress,
      START_PRICE,
      END_PRICE,
      startTime,
      endTime
    )) as unknown as DutchAuction;
    await auction.waitForDeployment();

    await nft.connect(seller).approve(await auction.getAddress(), tokenId);
    await auction.connect(seller).deposit();

    return { auction, nft, seller, buyer, other, startTime, endTime, tokenId };
  }

  it("部署后 NFT 托管在拍卖合约", async function () {
    const { auction, nft, tokenId } = await deployAuction();
    expect(await nft.ownerOf(tokenId)).to.equal(await auction.getAddress());
  });

  it("currentPrice：未开始为 startPrice，结束时间为 endPrice，中间线性下降", async function () {
    const { auction, startTime, endTime } = await deployAuction();

    expect(await auction.currentPrice()).to.equal(START_PRICE);

    await time.increaseTo(startTime);
    expect(await auction.currentPrice()).to.equal(START_PRICE);

    const mid = startTime + DURATION / 2n;
    await time.increaseTo(mid);
    const midPrice = await auction.currentPrice();
    expect(midPrice).to.be.gt(END_PRICE);
    expect(midPrice).to.be.lt(START_PRICE);

    await time.increaseTo(endTime);
    expect(await auction.currentPrice()).to.equal(END_PRICE);

    await time.increaseTo(endTime + 100n);
    expect(await auction.currentPrice()).to.equal(END_PRICE);
  });

  it("开始前 buy 应 revert", async function () {
    const { auction, buyer } = await deployAuction();
    await expect(auction.connect(buyer).buy({ value: START_PRICE })).to.be.revertedWithCustomError(
      auction,
      "AuctionNotStarted"
    );
  });

  it("ETH 支付：在中间时刻 buy，按当前价成交并退还多付 ETH", async function () {
    const { auction, nft, seller, buyer, startTime, endTime, tokenId } = await deployAuction();

    const buyTime = startTime + DURATION / 2n;
    await time.increaseTo(buyTime);
    const price = await auction.currentPrice();

    const buyerBefore = await ethers.provider.getBalance(buyer.address);
    const sellerBefore = await ethers.provider.getBalance(seller.address);
    const overpay = ethers.parseEther("1");

    const tx = await auction.connect(buyer).buy({ value: price + overpay });
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;

    const purchased = receipt!.logs
      .map((log) => {
        try {
          return auction.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "Purchased");
    const paidPrice = purchased!.args.price as bigint;

    expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
    expect(await auction.buyer()).to.equal(buyer.address);
    expect(await auction.ended()).to.equal(true);

    expect(await ethers.provider.getBalance(seller.address)).to.equal(sellerBefore + paidPrice);
    const buyerAfter = await ethers.provider.getBalance(buyer.address);
    expect(buyerAfter).to.be.closeTo(buyerBefore - paidPrice - gasCost, ethers.parseEther("0.001"));
  });

  it("成交后不可再次 buy", async function () {
    const { auction, buyer, startTime } = await deployAuction();
    await time.increaseTo(startTime);
    const price = await auction.currentPrice();
    await auction.connect(buyer).buy({ value: price });

    await expect(auction.connect(buyer).buy({ value: price })).to.be.revertedWithCustomError(
      auction,
      "AuctionEnded"
    );
  });

  it("开始前卖家可 cancel 取回 NFT", async function () {
    const { auction, nft, seller, tokenId } = await deployAuction({ startTimeOffset: 200n });
    await auction.connect(seller).cancel();
    expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
    expect(await auction.ended()).to.equal(true);
  });

  it("开始后不可 cancel", async function () {
    const { auction, seller, startTime } = await deployAuction();
    await time.increaseTo(startTime);
    await expect(auction.connect(seller).cancel()).to.be.revertedWithCustomError(
      auction,
      "CannotCancel"
    );
  });

  it("结束后无人购买可 reclaim", async function () {
    const { auction, nft, seller, endTime, tokenId } = await deployAuction();
    await time.increaseTo(endTime);
    await auction.connect(seller).reclaim();
    expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
    expect(await auction.ended()).to.equal(true);
  });

  it("reclaim：未结束或已售出应 revert", async function () {
    const { auction, seller, buyer, startTime, endTime } = await deployAuction();
    await expect(auction.connect(seller).reclaim()).to.be.revertedWithCustomError(
      auction,
      "NotEnded"
    );

    await time.increaseTo(startTime);
    const price = await auction.currentPrice();
    await auction.connect(buyer).buy({ value: price });

    await time.increaseTo(endTime + 1n);
    await expect(auction.connect(seller).reclaim()).to.be.revertedWithCustomError(
      auction,
      "AlreadySold"
    );
  });

  it("ERC20 支付：buy 时从买家转代币给卖家", async function () {
    const [seller, buyer] = await ethers.getSigners();
    const now = BigInt(await time.latest());
    const startTime = now + 10n;
    const endTime = startTime + DURATION;

    const Token = await ethers.getContractFactory("SampleERC20");
    const token = await Token.connect(seller).deploy("Pay", "PAY", 18, ethers.parseEther("1000000"));
    await token.waitForDeployment();

    const GameItem = await ethers.getContractFactory("GameItem");
    const nft = (await GameItem.deploy()) as unknown as GameItem;
    await nft.waitForDeployment();
    await nft.connect(seller).mint("uri");

    const DutchAuction = await ethers.getContractFactory("DutchAuction");
    const auction = (await DutchAuction.connect(seller).deploy(
      await nft.getAddress(),
      0n,
      await token.getAddress(),
      START_PRICE,
      END_PRICE,
      startTime,
      endTime
    )) as unknown as DutchAuction;
    await auction.waitForDeployment();
    await nft.connect(seller).approve(await auction.getAddress(), 0n);
    await auction.connect(seller).deposit();

    await time.increaseTo(startTime);

    const sellerBefore = await token.balanceOf(seller.address);
    await token.connect(seller).transfer(buyer.address, START_PRICE);
    await token.connect(buyer).approve(await auction.getAddress(), START_PRICE);

    const tx = await auction.connect(buyer).buy();
    const receipt = await tx.wait();
    const purchased = receipt!.logs
      .map((log) => {
        try {
          return auction.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .find((parsed) => parsed?.name === "Purchased");
    const paidPrice = purchased!.args.price as bigint;

    expect(await token.balanceOf(seller.address)).to.equal(sellerBefore - START_PRICE + paidPrice);
    expect(await token.balanceOf(buyer.address)).to.equal(START_PRICE - paidPrice);
    expect(await nft.ownerOf(0n)).to.equal(buyer.address);
  });

  it("终结后 currentPrice：成交固定为成交价", async function () {
    const { auction, buyer, startTime } = await deployAuction();
    await time.increaseTo(startTime);
    await auction.connect(buyer).buy({ value: START_PRICE });
    const paid = await auction.finalPrice();

    await time.increaseTo(startTime + DURATION * 2n);
    expect(await auction.state()).to.equal(1n); // Sold
    expect(await auction.currentPrice()).to.equal(paid);
  });

  it("终结后 currentPrice：取消固定为 0", async function () {
    const { auction, seller, startTime } = await deployAuction({ startTimeOffset: 200n });
    await auction.connect(seller).cancel();

    await time.increaseTo(startTime + DURATION);
    expect(await auction.state()).to.equal(2n); // Cancelled
    expect(await auction.currentPrice()).to.equal(0n);
  });

  it("终结后 currentPrice：流拍固定为 endPrice", async function () {
    const { auction, seller, endTime } = await deployAuction();
    await time.increaseTo(endTime);
    await auction.connect(seller).reclaim();

    await time.increaseTo(endTime + DURATION);
    expect(await auction.state()).to.equal(3n); // Expired
    expect(await auction.currentPrice()).to.equal(END_PRICE);
  });

  it("部署：startPrice <= endPrice 应 revert", async function () {
    const [seller] = await ethers.getSigners();
    const GameItem = await ethers.getContractFactory("GameItem");
    const nft = await GameItem.deploy();
    await nft.waitForDeployment();
    await nft.connect(seller).mint("x");

    const now = BigInt(await time.latest());
    const DutchAuction = await ethers.getContractFactory("DutchAuction");
    await expect(
      DutchAuction.connect(seller).deploy(
        await nft.getAddress(),
        0n,
        ethers.ZeroAddress,
        END_PRICE,
        START_PRICE,
        now + 10n,
        now + 100n
      )
    ).to.be.revertedWithCustomError(DutchAuction, "InvalidPriceRange");
  });
});
