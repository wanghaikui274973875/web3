import { expect } from "chai";
import { ethers } from "hardhat";
import type { MemoStorage } from "../typechain-types";

describe("MemoStorage", function () {
  async function deployFixture() {
    const [alice, bob] = await ethers.getSigners();
    const MemoStorageFactory = await ethers.getContractFactory("MemoStorage");
    const memo = (await MemoStorageFactory.deploy()) as unknown as MemoStorage;
    await memo.waitForDeployment();
    return { memo, alice, bob };
  }

  it("初始备忘录为空串", async function () {
    const { memo, alice } = await deployFixture();
    expect(await memo.getMemo(alice.address)).to.equal("");
  });

  it("本人可写入并读取", async function () {
    const { memo, alice } = await deployFixture();
    const text = "hello chain";
    await expect(memo.connect(alice).setMyMemo(text))
      .to.emit(memo, "MemoUpdated")
      .withArgs(alice.address, text);
    expect(await memo.getMemo(alice.address)).to.equal(text);
  });

  it("他人可读不可改他人备忘录", async function () {
    const { memo, alice, bob } = await deployFixture();
    await memo.connect(alice).setMyMemo("alice secret");
    expect(await memo.connect(bob).getMemo(alice.address)).to.equal("alice secret");
    await memo.connect(bob).setMyMemo("bob own");
    expect(await memo.getMemo(alice.address)).to.equal("alice secret");
    expect(await memo.getMemo(bob.address)).to.equal("bob own");
  });

  it("本人可删除", async function () {
    const { memo, alice } = await deployFixture();
    await memo.connect(alice).setMyMemo("to delete");
    await expect(memo.connect(alice).deleteMyMemo()).to.emit(memo, "MemoDeleted").withArgs(alice.address);
    expect(await memo.getMemo(alice.address)).to.equal("");
  });

  it("他人无法删除别人的备忘录", async function () {
    const { memo, alice, bob } = await deployFixture();
    await memo.connect(alice).setMyMemo("keep");
    await memo.connect(bob).deleteMyMemo();
    expect(await memo.getMemo(alice.address)).to.equal("keep");
  });
});
