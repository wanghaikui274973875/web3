import { expect } from "chai";
import { ethers } from "hardhat";
import type { PermissionStorage } from "../typechain-types";

describe("PermissionStorage", function () {
  async function deployFixture() {
    const [owner, alice, bob] = await ethers.getSigners();
    const PermissionStorage = await ethers.getContractFactory("PermissionStorage");
    const storage = (await PermissionStorage.deploy()) as unknown as PermissionStorage;
    await storage.waitForDeployment();
    return { storage, owner, alice, bob };
  }

  it("部署后 owner 为部署者", async function () {
    const { storage, owner } = await deployFixture();
    expect(await storage.owner()).to.equal(owner.address);
  });

  it("owner 可写入权限，getPermission 可读回", async function () {
    const { storage, owner, alice } = await deployFixture();
    expect(await storage.getPermission(alice.address)).to.equal(false);

    await expect(storage.connect(owner).setPermission(alice.address, true))
      .to.emit(storage, "PermissionUpdated")
      .withArgs(alice.address, true);

    expect(await storage.getPermission(alice.address)).to.equal(true);
  });

  it("非 owner 调用 setPermission 失败", async function () {
    const { storage, alice, bob } = await deployFixture();
    await expect(storage.connect(alice).setPermission(bob.address, true)).to.be.revertedWithCustomError(
      storage,
      "NotOwner"
    );
  });

  it("transferOwnership 后新 owner 可改权限", async function () {
    const { storage, owner, alice, bob } = await deployFixture();

    await expect(storage.connect(owner).transferOwnership(alice.address))
      .to.emit(storage, "OwnershipTransferred")
      .withArgs(owner.address, alice.address);

    expect(await storage.owner()).to.equal(alice.address);

    await storage.connect(alice).setPermission(bob.address, true);
    expect(await storage.getPermission(bob.address)).to.equal(true);
  });

  it("不能将 owner 转给零地址", async function () {
    const { storage, owner } = await deployFixture();
    await expect(storage.connect(owner).transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(
      storage,
      "ZeroAddress"
    );
  });
});
