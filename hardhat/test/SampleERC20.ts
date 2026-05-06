import { expect } from "chai";
import { ethers } from "hardhat";

describe("SampleERC20", function () {
  it("sets token metadata and mints total supply", async function () {
    const [owner] = await ethers.getSigners();
    const totalSupply = 1000n;

    const SampleERC20 = await ethers.getContractFactory("SampleERC20");
    const token = await SampleERC20.deploy("TestToken", "TST", 18, totalSupply);
    await token.waitForDeployment();

    expect(await token.name()).to.equal("TestToken");
    expect(await token.symbol()).to.equal("TST");
    expect(await token.decimals()).to.equal(18);
    expect(await token.totalSupply()).to.equal(totalSupply);
    expect(await token.balanceOf(owner.address)).to.equal(totalSupply);
  });
});
