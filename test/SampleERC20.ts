/**
 * SampleERC20 生产级特性测试
 * 运行：npx hardhat test test/SampleERC20.ts
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("SampleERC20", function () {
  const SUPPLY = ethers.parseEther("1000000");

  async function deployToken(supply = SUPPLY) {
    const [owner, alice] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("SampleERC20");
    const token = await Factory.deploy("Sample Token", "SMPL", 18, supply);
    await token.waitForDeployment();
    return { token, owner, alice };
  }

  it("sets metadata, maxSupply and mints to deployer", async function () {
    const { token, owner } = await deployToken();

    expect(await token.name()).to.equal("Sample Token");
    expect(await token.symbol()).to.equal("SMPL");
    expect(await token.decimals()).to.equal(18);
    expect(await token.maxSupply()).to.equal(SUPPLY);
    expect(await token.totalSupply()).to.equal(SUPPLY);
    expect(await token.balanceOf(owner.address)).to.equal(SUPPLY);
  });

  it("reverts on invalid decimals or zero supply", async function () {
    const Factory = await ethers.getContractFactory("SampleERC20");
    await expect(Factory.deploy("X", "X", 19, 1n)).to.be.revertedWithCustomError(
      Factory,
      "InvalidDecimals"
    );
    await expect(Factory.deploy("X", "X", 18, 0n)).to.be.revertedWithCustomError(
      Factory,
      "ZeroSupply"
    );
  });

  it("holder can burn", async function () {
    const { token, owner } = await deployToken();
    const burnAmt = ethers.parseEther("100");
    await token.burn(burnAmt);
    expect(await token.totalSupply()).to.equal(SUPPLY - burnAmt);
    expect(await token.balanceOf(owner.address)).to.equal(SUPPLY - burnAmt);
  });

  it("owner can pause and unpause transfers", async function () {
    const { token, owner, alice } = await deployToken();
    const amt = ethers.parseEther("1");

    await token.pause();
    await expect(token.transfer(alice.address, amt)).to.be.revertedWithCustomError(
      token,
      "EnforcedPause"
    );

    await token.unpause();
    await token.transfer(alice.address, amt);
    expect(await token.balanceOf(alice.address)).to.equal(amt);
  });

  it("non-owner cannot pause", async function () {
    const { token, alice } = await deployToken();
    await expect(token.connect(alice).pause()).to.be.revertedWithCustomError(
      token,
      "OwnableUnauthorizedAccount"
    );
  });

  it("supports EIP-2612 permit + transferFrom", async function () {
    const { token, owner, alice } = await deployToken();
    const amt = ethers.parseEther("10");
    const deadline = (await time.latest()) + 3600;
    const nonce = await token.nonces(owner.address);
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const sig = await owner.signTypedData(
      {
        name: await token.name(),
        version: "1",
        chainId,
        verifyingContract: await token.getAddress()
      },
      {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      },
      {
        owner: owner.address,
        spender: alice.address,
        value: amt,
        nonce,
        deadline
      }
    );

    const { v, r, s } = ethers.Signature.from(sig);
    await token.permit(owner.address, alice.address, amt, deadline, v, r, s);
    await token.connect(alice).transferFrom(owner.address, alice.address, amt);
    expect(await token.balanceOf(alice.address)).to.equal(amt);
  });
});
