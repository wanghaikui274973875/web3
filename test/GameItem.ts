import { expect } from "chai";
import { ethers } from "hardhat";
import type { GameItem } from "../typechain-types";

describe("GameItem", function () {
  async function deployFixture() {
    const [owner, alice, bob] = await ethers.getSigners();
    const GameItemFactory = await ethers.getContractFactory("GameItem");
    const nft = (await GameItemFactory.deploy()) as unknown as GameItem;
    await nft.waitForDeployment();
    return { nft, owner, alice, bob };
  }

  it("部署后 totalMinted 为 0", async function () {
    const { nft } = await deployFixture();
    expect(await nft.totalMinted()).to.equal(0n);
  });

  it("任意用户可 mint 到本人并设置 tokenURI", async function () {
    const { nft, alice } = await deployFixture();
    const uri = "https://example.com/meta/0.json";
    await expect(nft.connect(alice).mint(uri))
      .to.emit(nft, "Transfer")
      .withArgs(ethers.ZeroAddress, alice.address, 0n);

    expect(await nft.totalMinted()).to.equal(1n);
    expect(await nft.ownerOf(0)).to.equal(alice.address);
    expect(await nft.tokenURI(0)).to.equal(uri);
  });

  it("owner 可 awardItem 给他人", async function () {
    const { nft, owner, alice } = await deployFixture();
    const uri = "ipfs://bafy";
    const id = await nft.connect(owner).awardItem.staticCall(alice.address, uri);
    await nft.connect(owner).awardItem(alice.address, uri);
    expect(id).to.equal(0n);
    expect(await nft.ownerOf(0)).to.equal(alice.address);
    expect(await nft.tokenURI(0)).to.equal(uri);
  });

  it("非 owner 不能 awardItem", async function () {
    const { nft, alice, bob } = await deployFixture();
    await expect(nft.connect(alice).awardItem(bob.address, "x")).to.be.revertedWithCustomError(
      nft,
      "OwnableUnauthorizedAccount"
    );
  });
});
