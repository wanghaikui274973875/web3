/**
 * StakingRewards 完整流程测试
 * 运行：npx hardhat test test/StakingRewards.ts
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("StakingRewards", function () {
  const SUPPLY = ethers.parseEther("1000000");
  const DURATION = 7 * 24 * 60 * 60; // 7 days

  async function deployFixture() {
    const [owner, distributor, alice, bob] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("SampleERC20");
    const stakingToken = await Token.deploy("Stake Token", "STK", 18, SUPPLY);
    const rewardsToken = await Token.deploy("Reward Token", "RWD", 18, SUPPLY);
    await stakingToken.waitForDeployment();
    await rewardsToken.waitForDeployment();

    const Staking = await ethers.getContractFactory("StakingRewards");
    const staking = await Staking.deploy(
      owner.address,
      await rewardsToken.getAddress(),
      await stakingToken.getAddress(),
      distributor.address
    );
    await staking.waitForDeployment();

    const stakeAmt = ethers.parseEther("1000");
    const rewardAmt = ethers.parseEther("7000");

    await stakingToken.transfer(alice.address, stakeAmt);
    await stakingToken.transfer(bob.address, stakeAmt);
    await rewardsToken.transfer(distributor.address, rewardAmt);

    await stakingToken.connect(alice).approve(await staking.getAddress(), stakeAmt);
    await stakingToken.connect(bob).approve(await staking.getAddress(), stakeAmt);
    await rewardsToken.connect(distributor).approve(await staking.getAddress(), rewardAmt);

    return { owner, distributor, alice, bob, stakingToken, rewardsToken, staking, stakeAmt, rewardAmt };
  }

  async function startRewardPeriod(
    staking: Awaited<ReturnType<typeof deployFixture>>["staking"],
    distributor: Awaited<ReturnType<typeof deployFixture>>["distributor"],
    reward: bigint
  ) {
    await staking.connect(distributor).notifyRewardAmount(reward);
  }

  it("deploys with correct immutables and default duration", async function () {
    const { staking, stakingToken, rewardsToken, distributor } = await deployFixture();

    expect(await staking.rewardsToken()).to.equal(await rewardsToken.getAddress());
    expect(await staking.stakingToken()).to.equal(await stakingToken.getAddress());
    expect(await staking.rewardsDistribution()).to.equal(distributor.address);
    expect(await staking.rewardsDuration()).to.equal(BigInt(DURATION));
    expect(await staking.totalSupply()).to.equal(0n);
  });

  it("stake and withdraw update balances", async function () {
    const { alice, staking, stakeAmt } = await deployFixture();
    const amount = ethers.parseEther("100");

    await staking.connect(alice).stake(amount);
    expect(await staking.balanceOf(alice.address)).to.equal(amount);
    expect(await staking.totalSupply()).to.equal(amount);

    await staking.connect(alice).withdraw(amount);
    expect(await staking.balanceOf(alice.address)).to.equal(0n);
    expect(await staking.totalSupply()).to.equal(0n);
  });

  it("distributes rewards proportionally between two stakers", async function () {
    const { alice, bob, staking, distributor, rewardAmt } = await deployFixture();
    const aliceStake = ethers.parseEther("300");
    const bobStake = ethers.parseEther("100");

    await startRewardPeriod(staking, distributor, rewardAmt);
    await staking.connect(alice).stake(aliceStake);
    await staking.connect(bob).stake(bobStake);

    await time.increase(DURATION);

    const aliceEarned = await staking.earned(alice.address);
    const bobEarned = await staking.earned(bob.address);

    // 3:1 质押比例 → 奖励约 5250 : 1750
    expect(aliceEarned).to.be.closeTo(ethers.parseEther("5250"), ethers.parseEther("1"));
    expect(bobEarned).to.be.closeTo(ethers.parseEther("1750"), ethers.parseEther("1"));
    expect(aliceEarned + bobEarned).to.be.closeTo(rewardAmt, ethers.parseEther("2"));
  });

  it("getReward transfers reward tokens", async function () {
    const { alice, staking, distributor, rewardsToken, stakeAmt, rewardAmt } = await deployFixture();

    await startRewardPeriod(staking, distributor, rewardAmt);
    await staking.connect(alice).stake(stakeAmt);
    await time.increase(DURATION);

    const earned = await staking.earned(alice.address);
    await expect(staking.connect(alice).getReward())
      .to.emit(staking, "RewardPaid")
      .withArgs(alice.address, earned);

    expect(await rewardsToken.balanceOf(alice.address)).to.equal(earned);
    expect(await staking.earned(alice.address)).to.equal(0n);
  });

  it("exit withdraws all stake and claims rewards", async function () {
    const { alice, staking, distributor, stakingToken, rewardsToken, stakeAmt, rewardAmt } =
      await deployFixture();

    await startRewardPeriod(staking, distributor, rewardAmt);
    await staking.connect(alice).stake(stakeAmt);
    await time.increase(DURATION / 2);

    const balBefore = await stakingToken.balanceOf(alice.address);
    await staking.connect(alice).exit();

    expect(await staking.balanceOf(alice.address)).to.equal(0n);
    expect(await stakingToken.balanceOf(alice.address)).to.equal(balBefore + stakeAmt);
    expect(await rewardsToken.balanceOf(alice.address)).to.be.gt(0n);
  });

  it("rolls leftover rewards when notifying during active period", async function () {
    const { alice, staking, distributor, rewardAmt, rewardsToken, owner } = await deployFixture();
    const half = rewardAmt / 2n;

    await startRewardPeriod(staking, distributor, rewardAmt);
    await staking.connect(alice).stake(ethers.parseEther("1"));
    await time.increase(DURATION / 2);

    const earnedMid = await staking.earned(alice.address);
    expect(earnedMid).to.be.closeTo(ethers.parseEther("3500"), ethers.parseEther("10"));

    await rewardsToken.connect(owner).transfer(distributor.address, half);
    await rewardsToken.connect(distributor).approve(await staking.getAddress(), half);
    await staking.connect(distributor).notifyRewardAmount(half);

    await time.increase(DURATION);
    const earnedFinal = await staking.earned(alice.address);
    // 前半 3500 + 后半约 3500 + 新注入 3500 ≈ 10500（滚存后按新 rate 释放）
    expect(earnedFinal).to.be.gt(ethers.parseEther("10000"));
  });

  it("owner can update distribution and duration when idle", async function () {
    const { owner, alice, staking, distributor } = await deployFixture();

    await staking.connect(owner).setRewardsDistribution(alice.address);
    expect(await staking.rewardsDistribution()).to.equal(alice.address);

    await staking.connect(owner).setRewardsDuration(14 * 24 * 60 * 60);
    expect(await staking.rewardsDuration()).to.equal(BigInt(14 * 24 * 60 * 60));

    await expect(
      staking.connect(distributor).notifyRewardAmount(ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(staking, "NotRewardsDistribution");
  });

  it("cannot change duration during active reward period", async function () {
    const { owner, staking, distributor, rewardAmt } = await deployFixture();

    await startRewardPeriod(staking, distributor, rewardAmt);
    await expect(staking.connect(owner).setRewardsDuration(1)).to.be.revertedWithCustomError(
      staking,
      "RewardPeriodActive"
    );
  });

  it("recoverERC20 blocks staking and reward tokens", async function () {
    const { owner, staking, stakingToken, rewardsToken } = await deployFixture();

    await expect(
      staking.connect(owner).recoverERC20(await stakingToken.getAddress(), 1n)
    ).to.be.revertedWithCustomError(staking, "CannotRecoverStakingOrRewardToken");

    await expect(
      staking.connect(owner).recoverERC20(await rewardsToken.getAddress(), 1n)
    ).to.be.revertedWithCustomError(staking, "CannotRecoverStakingOrRewardToken");
  });

  it("reverts zero stake and unauthorized notify", async function () {
    const { alice, bob, staking, distributor } = await deployFixture();

    await expect(staking.connect(alice).stake(0n)).to.be.revertedWithCustomError(
      staking,
      "ZeroAmount"
    );
    await expect(
      staking.connect(bob).notifyRewardAmount(ethers.parseEther("1"))
    ).to.be.revertedWithCustomError(staking, "NotRewardsDistribution");
    await expect(
      staking.connect(distributor).notifyRewardAmount(0n)
    ).to.be.revertedWithCustomError(staking, "ZeroReward");
  });

  it("late staker earns less than early staker", async function () {
    const { alice, bob, staking, distributor, rewardAmt } = await deployFixture();

    await startRewardPeriod(staking, distributor, rewardAmt);
    await staking.connect(alice).stake(ethers.parseEther("100"));
    await time.increase(DURATION / 2);
    await staking.connect(bob).stake(ethers.parseEther("100"));
    await time.increase(DURATION / 2);

    const aliceEarned = await staking.earned(alice.address);
    const bobEarned = await staking.earned(bob.address);
    expect(aliceEarned).to.be.gt(bobEarned);
  });
});
