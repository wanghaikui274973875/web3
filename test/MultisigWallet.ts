import { expect } from "chai";
import { ethers } from "hardhat";
import type { MultisigWallet, MultisigWalletFactory, SampleERC20 } from "../typechain-types";

describe("MultisigWallet", function () {
  const THRESHOLD = 2;

  async function deployMultisig(signers = 3) {
    const accounts = await ethers.getSigners();
    const owners = accounts.slice(0, signers).map((s) => s.address);
    const FactoryContract = await ethers.getContractFactory("MultisigWalletFactory");
    const factory = (await FactoryContract.deploy()) as unknown as MultisigWalletFactory;
    await factory.waitForDeployment();

    const salt = await factory.computeSalt(owners, THRESHOLD);
    const tx = await factory.createWallet(owners, THRESHOLD, salt);
    await tx.wait();
    const walletAddr = await factory.walletOf(salt);
    const wallet = (await ethers.getContractAt("MultisigWallet", walletAddr)) as unknown as MultisigWallet;

    return { wallet, owners, accounts, factory, salt };
  }

  /** 按 owner 地址升序收集 EIP-712 签名（合约要求 signer 地址严格递增） */
  async function signTxSorted(
    wallet: MultisigWallet,
    signers: Awaited<ReturnType<typeof ethers.getSigners>>,
    to: string,
    value: bigint,
    data: string,
    nonce: bigint,
    deadline: bigint
  ) {
    const sorted = [...signers].sort((a, b) =>
      a.address.toLowerCase() < b.address.toLowerCase() ? -1 : 1
    );
    const sigs: string[] = [];
    for (const s of sorted) {
      sigs.push(await signTx(wallet, s, to, value, data, nonce, deadline));
    }
    return sigs;
  }

  async function signTx(
    wallet: MultisigWallet,
    signer: Awaited<ReturnType<typeof ethers.getSigners>>[number],
    to: string,
    value: bigint,
    data: string,
    nonce: bigint,
    deadline: bigint
  ) {
    return signer.signTypedData(
      {
        name: "MultisigWallet",
        version: "1",
        chainId: (await ethers.provider.getNetwork()).chainId,
        verifyingContract: await wallet.getAddress()
      },
      {
        WalletTransaction: [
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "dataHash", type: "bytes32" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" }
        ]
      },
      {
        to,
        value,
        dataHash: ethers.keccak256(data),
        nonce,
        deadline
      }
    );
  }

  it("部署：threshold 与 owners 正确", async function () {
    const { wallet, owners } = await deployMultisig();
    expect(await wallet.threshold()).to.equal(THRESHOLD);
    expect(await wallet.getOwners()).to.deep.equal(owners);
    expect(await wallet.isOwner(owners[0])).to.equal(true);
  });

  it("部署：无效 threshold 应 revert", async function () {
    const [a, b] = await ethers.getSigners();
    const owners = [a.address, b.address];
    const FactoryContract = await ethers.getContractFactory("MultisigWalletFactory");
    const WalletContract = await ethers.getContractFactory("MultisigWallet");
    const factory = (await FactoryContract.deploy()) as unknown as MultisigWalletFactory;
    await factory.waitForDeployment();

    const salt0 = await factory.computeSalt(owners, 0);
    await expect(factory.createWallet(owners, 0, salt0)).to.be.revertedWithCustomError(
      WalletContract,
      "InvalidThreshold"
    );

    const saltBad = await factory.computeSalt([a.address], 2);
    await expect(factory.createWallet([a.address], 2, saltBad)).to.be.revertedWithCustomError(
      WalletContract,
      "InvalidThreshold"
    );
  });

  it("CREATE2：部署前可向预测地址转入 ETH", async function () {
    const { accounts, factory, owners } = await deployMultisig();
    const amount = ethers.parseEther("0.25");

    const otherOwners = accounts.slice(3, 6).map((s) => s.address);
    const salt = await factory.computeSalt(otherOwners, 2);
    const predicted = await factory.predictAddress(salt);

    await accounts[0].sendTransaction({ to: predicted, value: amount });
    expect(await ethers.provider.getBalance(predicted)).to.equal(amount);

    await factory.createWallet(otherOwners, 2, salt);
    expect(await ethers.provider.getBalance(predicted)).to.equal(amount);
    expect(await factory.walletOf(salt)).to.equal(predicted);
  });

  it("链上多签：submit → confirm → execute 转 ETH", async function () {
    const { wallet, accounts } = await deployMultisig();
    const walletAddr = await wallet.getAddress();
    const recipient = accounts[9].address;
    const amount = ethers.parseEther("1");

    await accounts[0].sendTransaction({ to: walletAddr, value: amount });
    expect(await ethers.provider.getBalance(walletAddr)).to.equal(amount);

    const tx = await wallet.connect(accounts[0]).submitTransaction(recipient, amount, "0x", 0);
    await tx.wait();
    const txId = 0n;

    await wallet.connect(accounts[0]).confirmTransaction(txId);
    await wallet.connect(accounts[1]).confirmTransaction(txId);

    const before = await ethers.provider.getBalance(recipient);
    await expect(wallet.connect(accounts[2]).executeTransaction(txId)).to.not.be.reverted;

    expect(await ethers.provider.getBalance(recipient)).to.equal(before + amount);
    expect(await ethers.provider.getBalance(walletAddr)).to.equal(0n);

    const stored = await wallet.getTransaction(txId);
    expect(stored.executed).to.equal(true);
  });

  it("链上多签：确认不足不能执行", async function () {
    const { wallet, accounts } = await deployMultisig();
    await wallet.connect(accounts[0]).submitTransaction(accounts[9].address, 0n, "0x", 0);
    await wallet.connect(accounts[0]).confirmTransaction(0);
    await expect(wallet.connect(accounts[0]).executeTransaction(0)).to.be.revertedWithCustomError(
      wallet,
      "TxNotConfirmed"
    );
  });

  it("链上多签：revoke 后确认数下降", async function () {
    const { wallet, accounts } = await deployMultisig();
    await wallet.connect(accounts[0]).submitTransaction(accounts[9].address, 0n, "0x", 0);
    await wallet.connect(accounts[0]).confirmTransaction(0);
    await wallet.connect(accounts[1]).confirmTransaction(0);
    await wallet.connect(accounts[1]).revokeConfirmation(0);
    await expect(wallet.connect(accounts[0]).executeTransaction(0)).to.be.revertedWithCustomError(
      wallet,
      "TxNotConfirmed"
    );
  });

  it("链上多签：过期交易不能 confirm/execute", async function () {
    const { wallet, accounts } = await deployMultisig();
    const past = BigInt(Math.floor(Date.now() / 1000) - 60);
    await wallet.connect(accounts[0]).submitTransaction(accounts[9].address, 0n, "0x", past);
    await expect(wallet.connect(accounts[0]).confirmTransaction(0)).to.be.revertedWithCustomError(
      wallet,
      "TxExpired"
    );
  });

  it("链上多签：proposer 可取消；非 proposer 未过期不能取消", async function () {
    const { wallet, accounts } = await deployMultisig();
    await wallet.connect(accounts[0]).submitTransaction(accounts[9].address, 0n, "0x", 0);
    await expect(wallet.connect(accounts[1]).cancelTransaction(0)).to.be.revertedWithCustomError(
      wallet,
      "NotProposer"
    );
    await wallet.connect(accounts[0]).cancelTransaction(0);
    expect((await wallet.getTransaction(0)).executed).to.equal(true);
  });

  it("EIP-712：executeWithSignatures 一次上链转 ETH", async function () {
    const { wallet, accounts } = await deployMultisig();
    const walletAddr = await wallet.getAddress();
    const recipient = accounts[9].address;
    const amount = ethers.parseEther("0.5");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

    await accounts[0].sendTransaction({ to: walletAddr, value: amount });

    const nonce = await wallet.walletNonce();
    const data = "0x";
    const before = await ethers.provider.getBalance(recipient);
    const sigs = await signTxSorted(
      wallet,
      [accounts[0], accounts[1]],
      recipient,
      amount,
      data,
      nonce,
      deadline
    );

    await wallet.executeWithSignatures(recipient, amount, data, deadline, sigs);

    expect(await ethers.provider.getBalance(recipient)).to.equal(before + amount);
    expect(await wallet.walletNonce()).to.equal(nonce + 1n);
  });

  it("EIP-712：签名地址未递增应 revert（防重复计数）", async function () {
    const { wallet, accounts } = await deployMultisig();
    const recipient = accounts[9].address;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const nonce = await wallet.walletNonce();
    const data = "0x";

    const sigs = await signTxSorted(
      wallet,
      [accounts[0], accounts[1]],
      recipient,
      0n,
      data,
      nonce,
      deadline
    );

    await expect(
      wallet.executeWithSignatures(recipient, 0n, data, deadline, [sigs[1], sigs[0]])
    ).to.be.revertedWithCustomError(wallet, "UnorderedSigners");
  });

  it("治理：通过多签 addOwner 并提高 threshold", async function () {
    const { wallet, accounts } = await deployMultisig();
    const newOwner = accounts[3].address;
    const walletAddr = await wallet.getAddress();

    const data = wallet.interface.encodeFunctionData("addOwner", [newOwner]);
    await wallet.connect(accounts[0]).submitTransaction(walletAddr, 0n, data, 0);
    await wallet.connect(accounts[0]).confirmTransaction(0);
    await wallet.connect(accounts[1]).confirmTransaction(0);
    await wallet.connect(accounts[0]).executeTransaction(0);

    expect(await wallet.isOwner(newOwner)).to.equal(true);

    const data2 = wallet.interface.encodeFunctionData("changeThreshold", [3]);
    await wallet.connect(accounts[0]).submitTransaction(walletAddr, 0n, data2, 0);
    await wallet.connect(accounts[0]).confirmTransaction(1);
    await wallet.connect(accounts[1]).confirmTransaction(1);
    await wallet.connect(accounts[0]).executeTransaction(1);

    expect(await wallet.threshold()).to.equal(3);
  });

  it("治理：removeOwner 会清理其在待执行交易上的确认", async function () {
    const { wallet, accounts } = await deployMultisig();
    const walletAddr = await wallet.getAddress();
    const victim = accounts[9].address;

    await wallet.connect(accounts[0]).submitTransaction(victim, 0n, "0x", 0);
    await wallet.connect(accounts[0]).confirmTransaction(0);
    await wallet.connect(accounts[1]).confirmTransaction(0);

    const removeData = wallet.interface.encodeFunctionData("removeOwner", [accounts[1].address]);
    await wallet.connect(accounts[0]).submitTransaction(walletAddr, 0n, removeData, 0);
    await wallet.connect(accounts[0]).confirmTransaction(1);
    await wallet.connect(accounts[2]).confirmTransaction(1);
    await wallet.connect(accounts[0]).executeTransaction(1);

    expect(await wallet.isOwner(accounts[1].address)).to.equal(false);
    expect((await wallet.getTransaction(0)).confirmationCount).to.equal(1n);

    await expect(wallet.connect(accounts[0]).executeTransaction(0)).to.be.revertedWithCustomError(
      wallet,
      "TxNotConfirmed"
    );
  });

  it("执行失败应 bubbling revert", async function () {
    const { wallet, accounts } = await deployMultisig();
    const Token = await ethers.getContractFactory("SampleERC20");
    const token = (await Token.deploy("T", "T", 18, ethers.parseEther("1"))) as unknown as SampleERC20;
    await token.waitForDeployment();
    // 多签钱包余额为 0，transfer 应失败
    const data = token.interface.encodeFunctionData("transfer", [
      accounts[9].address,
      ethers.parseEther("1")
    ]);

    await wallet.connect(accounts[0]).submitTransaction(await token.getAddress(), 0n, data, 0);
    await wallet.connect(accounts[0]).confirmTransaction(0);
    await wallet.connect(accounts[1]).confirmTransaction(0);

    await expect(wallet.connect(accounts[0]).executeTransaction(0)).to.be.reverted;
  });

  it("非 owner 不能 submit", async function () {
    const { wallet, accounts } = await deployMultisig();
    await expect(
      wallet.connect(accounts[9]).submitTransaction(accounts[9].address, 0n, "0x", 0)
    ).to.be.revertedWithCustomError(wallet, "NotOwner");
  });

  it("合约调用：多签向 ERC20 转账", async function () {
    const { wallet, accounts } = await deployMultisig();
    const walletAddr = await wallet.getAddress();

    const Token = await ethers.getContractFactory("SampleERC20");
    const token = (await Token.deploy(
      "Test",
      "TST",
      18,
      ethers.parseEther("1000")
    )) as unknown as SampleERC20;
    await token.waitForDeployment();
    await token.transfer(walletAddr, ethers.parseEther("100"));

    const recipient = accounts[9].address;
    const transferAmount = ethers.parseEther("10");
    const data = token.interface.encodeFunctionData("transfer", [recipient, transferAmount]);

    await wallet.connect(accounts[0]).submitTransaction(await token.getAddress(), 0n, data, 0);
    await wallet.connect(accounts[0]).confirmTransaction(0);
    await wallet.connect(accounts[1]).confirmTransaction(0);
    await wallet.connect(accounts[0]).executeTransaction(0);

    expect(await token.balanceOf(recipient)).to.equal(transferAmount);
  });
});
