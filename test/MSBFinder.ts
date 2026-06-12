/**
 * MSBFinder 最高有效位测试
 * 运行：npx hardhat test test/MSBFinder.ts
 */

import { expect } from "chai";
import { ethers } from "hardhat";

describe("MSBFinder", function () {
  async function deploy() {
    const Factory = await ethers.getContractFactory("MSBFinder");
    const finder = await Factory.deploy();
    await finder.waitForDeployment();
    return finder;
  }

  const cases: { x: bigint; pos: number; value: bigint }[] = [
    { x: 1n, pos: 0, value: 1n },
    { x: 2n, pos: 1, value: 2n },
    { x: 3n, pos: 1, value: 2n },
    { x: 8n, pos: 3, value: 8n },
    { x: 13n, pos: 3, value: 8n },
    { x: 256n, pos: 8, value: 256n },
    { x: (1n << 128n) - 1n, pos: 127, value: 1n << 127n },
    { x: 1n << 128n, pos: 128, value: 1n << 128n },
    { x: (1n << 256n) - 1n, pos: 255, value: 1n << 255n }
  ];

  it("msb binary search returns correct index", async function () {
    const finder = await deploy();
    for (const { x, pos } of cases) {
      expect(await finder.msb(x)).to.equal(pos);
    }
  });

  it("msbNaive matches msb", async function () {
    const finder = await deploy();
    for (const { x, pos } of cases) {
      expect(await finder.msbNaive(x)).to.equal(pos);
    }
  });

  it("msbOz matches msb", async function () {
    const finder = await deploy();
    for (const { x, pos } of cases) {
      expect(await finder.msbOz(x)).to.equal(pos);
    }
  });

  it("msbValue returns single highest bit", async function () {
    const finder = await deploy();
    for (const { x, value } of cases) {
      expect(await finder.msbValue(x)).to.equal(value);
    }
  });

  it("reverts on zero input", async function () {
    const finder = await deploy();
    await expect(finder.msb(0n)).to.be.revertedWithCustomError(finder, "ZeroInput");
    await expect(finder.msbNaive(0n)).to.be.revertedWithCustomError(finder, "ZeroInput");
    await expect(finder.msbOz(0n)).to.be.revertedWithCustomError(finder, "ZeroInput");
    await expect(finder.msbValue(0n)).to.be.revertedWithCustomError(finder, "ZeroInput");
  });
});
