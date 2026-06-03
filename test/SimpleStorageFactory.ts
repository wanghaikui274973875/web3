import { expect } from "chai";
import { ethers } from "hardhat";
import type { SimpleStorage, SimpleStorageFactory } from "../typechain-types";

describe("SimpleStorageFactory", function () {
  async function deployFixture() {
    const [creator] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("SimpleStorageFactory");
    const factory = (await Factory.deploy()) as unknown as SimpleStorageFactory;
    await factory.waitForDeployment();
    return { factory, creator };
  }

  it("create 部署新的 SimpleStorage 实例", async function () {
    const { factory } = await deployFixture();

    const tx = await factory.create();
    const receipt = await tx.wait();
    const created = receipt?.logs
      .map((log) => factory.interface.parseLog(log))
      .find((parsed) => parsed?.name === "SimpleStorageCreated");
    const instanceAddr = created?.args.instance as string;

    const instance = (await ethers.getContractAt(
      "SimpleStorage",
      instanceAddr
    )) as unknown as SimpleStorage;
    expect(await instance.getNum()).to.equal(0n);

    await instance.setNum(100n);
    expect(await instance.getNum()).to.equal(100n);
  });

  it("多次 create 产生不同地址并可通过 getInstance 查询", async function () {
    const { factory } = await deployFixture();

    const tx1 = await factory.create();
    const tx2 = await factory.create();
    const addr1 = (await tx1.wait())!.logs
      .map((log) => factory.interface.parseLog(log))
      .find((parsed) => parsed?.name === "SimpleStorageCreated")!.args.instance;
    const addr2 = (await tx2.wait())!.logs
      .map((log) => factory.interface.parseLog(log))
      .find((parsed) => parsed?.name === "SimpleStorageCreated")!.args.instance;

    expect(addr1).to.not.equal(addr2);
    expect(await factory.instanceCount()).to.equal(2n);
    expect(await factory.getInstance(0)).to.equal(addr1);
    expect(await factory.getInstance(1)).to.equal(addr2);
  });
});
