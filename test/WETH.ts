/**
 * WETH deposit / withdraw 测试
 * 运行：npx hardhat test test/WETH.ts
 */

import { expect } from "chai";
import { ethers } from "hardhat";

describe("WETH", function () {
  async function deployWETH() {
    const [alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("WETH");
    const weth = await Factory.deploy();
    await weth.waitForDeployment();
    return { weth, alice, bob };
  }

  it("deposit mints WETH 1:1 with ETH", async function () {
    const { weth, alice } = await deployWETH();
    const amount = ethers.parseEther("1.5");

    await expect(weth.connect(alice).deposit({ value: amount }))
      .to.emit(weth, "Deposit")
      .withArgs(alice.address, amount);

    expect(await weth.balanceOf(alice.address)).to.equal(amount);
    expect(await weth.totalSupply()).to.equal(amount);
    expect(await ethers.provider.getBalance(await weth.getAddress())).to.equal(amount);
  });

  it("withdraw burns WETH and returns ETH", async function () {
    const { weth, alice } = await deployWETH();
    const depositAmt = ethers.parseEther("2");
    const withdrawAmt = ethers.parseEther("0.8");

    await weth.connect(alice).deposit({ value: depositAmt });
    const balBefore = await ethers.provider.getBalance(alice.address);

    const tx = await weth.connect(alice).withdraw(withdrawAmt);
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;

    await expect(tx).to.emit(weth, "Withdrawal").withArgs(alice.address, withdrawAmt);

    expect(await weth.balanceOf(alice.address)).to.equal(depositAmt - withdrawAmt);
    expect(await weth.totalSupply()).to.equal(depositAmt - withdrawAmt);

    const balAfter = await ethers.provider.getBalance(alice.address);
    expect(balAfter).to.equal(balBefore + withdrawAmt - gas);
  });

  it("receive() auto-deposits plain ETH transfer", async function () {
    const { weth, alice } = await deployWETH();
    const amount = ethers.parseEther("0.5");

    await alice.sendTransaction({
      to: await weth.getAddress(),
      value: amount
    });

    expect(await weth.balanceOf(alice.address)).to.equal(amount);
  });

  it("reverts withdraw when balance insufficient", async function () {
    const { weth, alice } = await deployWETH();
    await expect(weth.connect(alice).withdraw(1n)).to.be.reverted;
  });

  it("supports ERC20 transfer between users", async function () {
    const { weth, alice, bob } = await deployWETH();
    const amount = ethers.parseEther("1");

    await weth.connect(alice).deposit({ value: amount });
    await weth.connect(alice).transfer(bob.address, amount);

    expect(await weth.balanceOf(alice.address)).to.equal(0n);
    expect(await weth.balanceOf(bob.address)).to.equal(amount);
  });
});
