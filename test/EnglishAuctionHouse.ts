/**
 * EnglishAuctionHouse 测试（Pull 退款 / Pull 结算）
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { EnglishAuctionHouse, GameItem } from "../typechain-types";

describe("EnglishAuctionHouse", function () {
  const MIN_BID = ethers.parseEther("1");
  const MIN_INCREMENT = ethers.parseEther("0.1");
  const DURATION = 3600n;

  async function deployHouse() {
    const [seller, bidderA, bidderB, other] = await ethers.getSigners();

    const GameItem = await ethers.getContractFactory("GameItem");
    const nft = (await GameItem.deploy()) as unknown as GameItem;
    await nft.waitForDeployment();

    const House = await ethers.getContractFactory("EnglishAuctionHouse");
    const house = (await House.deploy()) as unknown as EnglishAuctionHouse;
    await house.waitForDeployment();

    return { house, nft, seller, bidderA, bidderB, other };
  }

  async function createDepositedRound(
    house: EnglishAuctionHouse,
    nft: GameItem,
    seller: { address: string },
    tokenId: bigint,
    opts?: { startOffset?: bigint; duration?: bigint; paymentToken?: string }
  ) {
    const now = BigInt(await time.latest());
    const startTime = now + (opts?.startOffset ?? 100n);
    const endTime = startTime + (opts?.duration ?? DURATION);
    const paymentToken = opts?.paymentToken ?? ethers.ZeroAddress;

    const tx = await house
      .connect(seller as never)
      .createRound(
        await nft.getAddress(),
        tokenId,
        paymentToken,
        startTime,
        endTime,
        MIN_BID,
        MIN_INCREMENT
      );
    await tx.wait();

    const roundId = (await house.roundCounter()) - 1n;

    await nft.connect(seller as never).approve(await house.getAddress(), tokenId);
    await house.connect(seller as never).depositItem(roundId);

    return { roundId, startTime, endTime };
  }

  async function finalizeAndClaim(
    house: EnglishAuctionHouse,
    roundId: bigint,
    seller: { address: string },
    winner: { address: string }
  ) {
    await house.finalizeRound(roundId);
    await house.connect(seller as never).claimProceeds(roundId);
    await house.connect(winner as never).claimItem(roundId);
  }

  it("createRound + depositItem：NFT 托管在 House", async function () {
    const { house, nft, seller } = await deployHouse();
    await nft.connect(seller).mint("ipfs://english-0");
    const { roundId } = await createDepositedRound(house, nft, seller, 0n);

    expect(await nft.ownerOf(0n)).to.equal(await house.getAddress());
    const round = await house.getRound(roundId);
    expect(round.itemDeposited).to.equal(true);
    expect(round.seller).to.equal(seller.address);
  });

  it("首标与加价：被超越者 Pull 领取退款", async function () {
    const { house, nft, seller, bidderA, bidderB } = await deployHouse();
    await nft.connect(seller).mint("ipfs://english-1");
    const { roundId, startTime } = await createDepositedRound(house, nft, seller, 0n);

    await time.increaseTo(startTime);

    const bid1 = ethers.parseEther("1");
    await house.connect(bidderA).bid(roundId, bid1, { value: bid1 });

    const bid2 = ethers.parseEther("1.2");
    await house.connect(bidderB).bid(roundId, bid2, { value: bid2 });

    expect(await house.pendingRefund(roundId, bidderA.address)).to.equal(bid1);

    const balBefore = await ethers.provider.getBalance(bidderA.address);
    const tx = await house.connect(bidderA).claimRefund(roundId);
    const receipt = await tx.wait();
    const gasCost = receipt!.gasUsed * receipt!.gasPrice;
    const balAfter = await ethers.provider.getBalance(bidderA.address);

    expect(balAfter + gasCost).to.be.closeTo(balBefore + bid1, ethers.parseEther("0.001"));
    expect(await house.pendingRefund(roundId, bidderA.address)).to.equal(0n);

    const round = await house.getRound(roundId);
    expect(round.highestBidder).to.equal(bidderB.address);
    expect(round.highestBid).to.equal(bid2);
  });

  it("拒收 ETH 的出价者不阻塞后续加价", async function () {
    const { house, nft, seller, bidderB } = await deployHouse();
    await nft.connect(seller).mint("ipfs://reject");

    const Reject = await ethers.getContractFactory("RejectEthBidder");
    const rejector = await Reject.deploy();
    await rejector.waitForDeployment();

    const { roundId, startTime } = await createDepositedRound(house, nft, seller, 0n);
    await time.increaseTo(startTime);

    const bid1 = ethers.parseEther("1");
    await rejector.placeBid(await house.getAddress(), roundId, bid1, { value: bid1 });

    const bid2 = ethers.parseEther("1.2");
    await expect(house.connect(bidderB).bid(roundId, bid2, { value: bid2 })).to.not.be.reverted;

    expect(await house.pendingRefund(roundId, await rejector.getAddress())).to.equal(bid1);
    await expect(house.connect(bidderB).claimRefund(roundId)).to.be.revertedWithCustomError(
      house,
      "NothingToClaim"
    );
  });

  it("ETH 出价金额须与 msg.value 一致", async function () {
    const { house, nft, seller, bidderA } = await deployHouse();
    await nft.connect(seller).mint("ipfs://pay");
    const { roundId, startTime } = await createDepositedRound(house, nft, seller, 0n);
    await time.increaseTo(startTime);

    await expect(
      house.connect(bidderA).bid(roundId, MIN_BID, { value: MIN_BID + 1n })
    ).to.be.revertedWithCustomError(house, "IncorrectPayment");
  });

  it("出价过低应 revert", async function () {
    const { house, nft, seller, bidderA } = await deployHouse();
    await nft.connect(seller).mint("ipfs://english-2");
    const { roundId, startTime } = await createDepositedRound(house, nft, seller, 0n);
    await time.increaseTo(startTime);

    await expect(
      house.connect(bidderA).bid(roundId, ethers.parseEther("0.5"), { value: ethers.parseEther("0.5") })
    ).to.be.revertedWithCustomError(house, "BidTooLow");

    await house.connect(bidderA).bid(roundId, MIN_BID, { value: MIN_BID });

    await expect(
      house.connect(bidderA).bid(roundId, MIN_BID + ethers.parseEther("0.05"), {
        value: MIN_BID + ethers.parseEther("0.05")
      })
    ).to.be.revertedWithCustomError(house, "BidTooLow");
  });

  it("开始前不能 bid", async function () {
    const { house, nft, seller, bidderA } = await deployHouse();
    await nft.connect(seller).mint("ipfs://english-3");
    const { roundId } = await createDepositedRound(house, nft, seller, 0n);

    await expect(
      house.connect(bidderA).bid(roundId, MIN_BID, { value: MIN_BID })
    ).to.be.revertedWithCustomError(house, "AuctionNotStarted");
  });

  it("finalize + claim：NFT 给赢家，ETH 给卖家", async function () {
    const { house, nft, seller, bidderA, bidderB } = await deployHouse();
    await nft.connect(seller).mint("ipfs://english-4");
    const { roundId, startTime, endTime } = await createDepositedRound(house, nft, seller, 0n);

    await time.increaseTo(startTime);
    await house.connect(bidderA).bid(roundId, ethers.parseEther("1"), { value: ethers.parseEther("1") });
    await house.connect(bidderB).bid(roundId, ethers.parseEther("1.5"), { value: ethers.parseEther("1.5") });
    await house.connect(bidderA).claimRefund(roundId);
    await time.increaseTo(endTime);

    await house.finalizeRound(roundId);

    const sellerBefore = await ethers.provider.getBalance(seller.address);
    const proceedsTx = await house.connect(seller).claimProceeds(roundId);
    const proceedsRc = await proceedsTx.wait();
    const proceedsGas = proceedsRc!.gasUsed * proceedsRc!.gasPrice;
    await house.connect(bidderB).claimItem(roundId);

    const sellerAfter = await ethers.provider.getBalance(seller.address);
    expect(sellerAfter + proceedsGas - sellerBefore).to.equal(ethers.parseEther("1.5"));

    const round = await house.getRound(roundId);
    expect(round.state).to.equal(2);
    expect(round.proceedsClaimed).to.equal(true);
    expect(round.itemClaimed).to.equal(true);
  });

  it("无出价 reclaim：NFT 回卖家", async function () {
    const { house, nft, seller } = await deployHouse();
    await nft.connect(seller).mint("ipfs://english-5");
    const { roundId, endTime } = await createDepositedRound(house, nft, seller, 0n);

    await time.increaseTo(endTime);
    await house.connect(seller).reclaim(roundId);

    expect(await nft.ownerOf(0n)).to.equal(seller.address);
    const round = await house.getRound(roundId);
    expect(round.state).to.equal(4);
  });

  it("开始前 cancel：退回 NFT", async function () {
    const { house, nft, seller } = await deployHouse();
    await nft.connect(seller).mint("ipfs://english-6");
    const { roundId } = await createDepositedRound(house, nft, seller, 0n);

    await house.connect(seller).cancelRound(roundId);
    expect(await nft.ownerOf(0n)).to.equal(seller.address);

    const round = await house.getRound(roundId);
    expect(round.state).to.equal(3);
  });

  it("多轮互不影响", async function () {
    const { house, nft, seller, bidderA } = await deployHouse();
    await nft.connect(seller).mint("ipfs://r0");
    await nft.connect(seller).mint("ipfs://r1");

    const r0 = await createDepositedRound(house, nft, seller, 0n);
    const r1 = await createDepositedRound(house, nft, seller, 1n);

    await time.increaseTo(r0.startTime);
    await house.connect(bidderA).bid(r0.roundId, ethers.parseEther("2"), { value: ethers.parseEther("2") });

    await time.increaseTo(r1.startTime);
    const round1 = await house.getRound(r1.roundId);
    expect(round1.highestBid).to.equal(0n);
    expect(await house.isBiddable(r1.roundId)).to.equal(true);
  });

  it("结束后不能 bid", async function () {
    const { house, nft, seller, bidderA } = await deployHouse();
    await nft.connect(seller).mint("ipfs://english-7");
    const { roundId, endTime } = await createDepositedRound(house, nft, seller, 0n);

    await time.increaseTo(endTime);
    await expect(
      house.connect(bidderA).bid(roundId, MIN_BID, { value: MIN_BID })
    ).to.be.revertedWithCustomError(house, "AuctionEnded");
  });

  it("未结束前不能 finalize", async function () {
    const { house, nft, seller, bidderA } = await deployHouse();
    await nft.connect(seller).mint("ipfs://english-8");
    const { roundId, startTime } = await createDepositedRound(house, nft, seller, 0n);

    await time.increaseTo(startTime);
    await house.connect(bidderA).bid(roundId, MIN_BID, { value: MIN_BID });

    await expect(house.finalizeRound(roundId)).to.be.revertedWithCustomError(house, "NotEnded");
  });

  it("ERC20 轮次：Pull 退款与 Pull 结算", async function () {
    const { house, nft, seller, bidderA, bidderB } = await deployHouse();
    await nft.connect(seller).mint("ipfs://erc20-round");

    const Token = await ethers.getContractFactory("SampleERC20");
    const token = await Token.connect(seller).deploy("Pay", "PAY", 18, ethers.parseEther("1000000"));
    await token.waitForDeployment();
    const tokenAddr = await token.getAddress();

    const { roundId, startTime, endTime } = await createDepositedRound(
      house,
      nft,
      seller,
      0n,
      { paymentToken: tokenAddr }
    );

    await token.connect(seller).transfer(bidderA.address, ethers.parseEther("100"));
    await token.connect(seller).transfer(bidderB.address, ethers.parseEther("100"));

    await time.increaseTo(startTime);

    const bid1 = ethers.parseEther("1");
    await token.connect(bidderA).approve(await house.getAddress(), bid1);
    await house.connect(bidderA).bidWithToken(roundId, bid1);

    const bid2 = ethers.parseEther("1.2");
    await token.connect(bidderB).approve(await house.getAddress(), bid2);
    await house.connect(bidderB).bidWithToken(roundId, bid2);

    expect(await house.pendingRefund(roundId, bidderA.address)).to.equal(bid1);
    await house.connect(bidderA).claimRefund(roundId);
    expect(await token.balanceOf(bidderA.address)).to.equal(ethers.parseEther("100"));

    await time.increaseTo(endTime);

    const sellerBefore = await token.balanceOf(seller.address);
    await finalizeAndClaim(house, roundId, seller, bidderB);

    expect(await nft.ownerOf(0n)).to.equal(bidderB.address);
    expect(await token.balanceOf(seller.address)).to.equal(sellerBefore + bid2);
    expect(await token.balanceOf(await house.getAddress())).to.equal(0n);
  });

  it("ETH 轮次调用 bidWithToken 应 revert", async function () {
    const { house, nft, seller, bidderA } = await deployHouse();
    await nft.connect(seller).mint("ipfs://eth-only");
    const { roundId, startTime } = await createDepositedRound(house, nft, seller, 0n);
    await time.increaseTo(startTime);

    await expect(house.connect(bidderA).bidWithToken(roundId, MIN_BID)).to.be.revertedWithCustomError(
      house,
      "EthPaymentExpected"
    );
  });

  it("开拍后、结束前仍可 depositItem", async function () {
    const { house, nft, seller } = await deployHouse();
    await nft.connect(seller).mint("ipfs://late-deposit");
    const now = BigInt(await time.latest());
    const startTime = now + 100n;
    const endTime = startTime + DURATION;

    await house
      .connect(seller as never)
      .createRound(
        await nft.getAddress(),
        0n,
        ethers.ZeroAddress,
        startTime,
        endTime,
        MIN_BID,
        MIN_INCREMENT
      );
    const roundId = (await house.roundCounter()) - 1n;

    await time.increaseTo(startTime + 1n);
    await nft.connect(seller as never).approve(await house.getAddress(), 0n);
    await expect(house.connect(seller as never).depositItem(roundId)).to.not.be.reverted;

    const r = await house.getRound(roundId);
    expect(r.itemDeposited).to.equal(true);
    expect(await house.isBiddable(roundId)).to.equal(true);
  });

  it("abortUndepositedRound：结束且从未托管时可作废", async function () {
    const { house, nft, seller } = await deployHouse();
    await nft.connect(seller).mint("ipfs://abort");
    const now = BigInt(await time.latest());
    const startTime = now + 50n;
    const endTime = startTime + 200n;

    await house
      .connect(seller as never)
      .createRound(
        await nft.getAddress(),
        0n,
        ethers.ZeroAddress,
        startTime,
        endTime,
        MIN_BID,
        MIN_INCREMENT
      );
    const roundId = (await house.roundCounter()) - 1n;

    await time.increaseTo(endTime + 1n);
    await house.connect(seller as never).abortUndepositedRound(roundId);

    const r = await house.getRound(roundId);
    expect(r.state).to.equal(3n); // Cancelled
    expect(await nft.ownerOf(0n)).to.equal(seller.address);
  });
});
