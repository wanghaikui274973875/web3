import { expect } from "chai";
import { ethers } from "hardhat";
import type { ReentrancyAttacker, SafeBank, VulnerableBank } from "../typechain-types";

describe("Reentrancy demo", function () {
  const SEED = ethers.parseEther("1");
  const VICTIM_DEPOSIT = ethers.parseEther("5");

  it("VulnerableBank 可被重入抽干", async function () {
    const [, victim, attackerEoa] = await ethers.getSigners();

    const Bank = await ethers.getContractFactory("VulnerableBank");
    const bank = (await Bank.deploy()) as unknown as VulnerableBank;
    await bank.waitForDeployment();

    await bank.connect(victim).deposit({ value: VICTIM_DEPOSIT });
    expect(await ethers.provider.getBalance(await bank.getAddress())).to.equal(VICTIM_DEPOSIT);

    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    const attacker = (await Attacker.connect(attackerEoa).deploy(
      await bank.getAddress()
    )) as unknown as ReentrancyAttacker;
    await attacker.waitForDeployment();

    await attacker.connect(attackerEoa).attack({ value: SEED });

    expect(await ethers.provider.getBalance(await bank.getAddress())).to.equal(0n);
    expect(await ethers.provider.getBalance(await attacker.getAddress())).to.equal(VICTIM_DEPOSIT + SEED);

    expect(await bank.balances(victim.address)).to.equal(VICTIM_DEPOSIT);
  });

  it("SafeBank 阻止重入：攻击 revert，资金安全", async function () {
    const [, victim, attackerEoa] = await ethers.getSigners();

    const Bank = await ethers.getContractFactory("SafeBank");
    const bank = (await Bank.deploy()) as unknown as SafeBank;
    await bank.waitForDeployment();

    await bank.connect(victim).deposit({ value: VICTIM_DEPOSIT });

    const Attacker = await ethers.getContractFactory("ReentrancyAttacker");
    const attacker = (await Attacker.connect(attackerEoa).deploy(
      await bank.getAddress()
    )) as unknown as ReentrancyAttacker;
    await attacker.waitForDeployment();

    // CEI 先清零余额：重入时第二次 withdraw 读到的 amount 为 0，在 call 前即失败；
    // 外层首次 withdraw 的 call 因 receive 内 revert 得到 ok=false，触发 "send fail"。
    await expect(attacker.connect(attackerEoa).attack({ value: SEED })).to.be.revertedWith("send fail");

    expect(await ethers.provider.getBalance(await bank.getAddress())).to.equal(VICTIM_DEPOSIT);
    expect(await bank.balances(victim.address)).to.equal(VICTIM_DEPOSIT);

    await expect(bank.connect(victim).withdraw()).to.not.be.reverted;
    expect(await bank.balances(victim.address)).to.equal(0n);
    expect(await ethers.provider.getBalance(await bank.getAddress())).to.equal(0n);
  });
});
