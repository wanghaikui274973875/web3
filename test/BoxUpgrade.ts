/**
 * Box UUPS 代理升级测试
 *
 * 覆盖场景：
 * 1. 通过 ERC1967Proxy 读写 V1 状态
 * 2. owner 执行 upgradeToAndCall 升级到 V2，状态保留 + 新功能
 * 3. 非 owner 升级应 revert
 * 4. BoxProxyFactory 工厂一键部署
 *
 * 运行：npx hardhat test test/BoxUpgrade.ts
 */

import { expect } from "chai";
// Chai 断言库：expect(...).to.equal(...) 等

import { ethers } from "hardhat";
// Hardhat 封装的 ethers v6：部署合约、获取签名者、发送交易

import type { BoxProxyFactory, BoxV1, BoxV2 } from "../typechain-types";
// TypeChain 生成的 TS 类型：编译后自动推断合约方法与事件类型

describe("Box UUPS 代理升级", function () {
  // describe：测试分组；function () 而非箭头函数，以便使用 Mocha 的 this.timeout 等

  /**
   * 公共 fixture：手动部署 UUPS 代理（模拟 deployBoxUpgradeSepolia 的 UUPS 部分）
   * @param initialValue initialize 时写入的 value，默认 42
   */
  async function deployProxy(initialValue = 42n) {
    // 从 Hardhat 本地网络获取测试账户：accounts[0]=owner，accounts[1]=stranger
    const [owner, stranger] = await ethers.getSigners();

    // 获取 BoxV1 合约工厂（含 bytecode + ABI），用于部署实现合约
    const BoxV1 = await ethers.getContractFactory("BoxV1");
    const implV1 = await BoxV1.deploy();
    // 部署 V1 实现合约到链上（此时尚未初始化 value/owner）

    await implV1.waitForDeployment();
    // 等待部署交易上链，后续 getAddress() 才稳定

    // 编码 initialize(initialValue) 的 calldata，供代理构造时 delegatecall
    const initData = BoxV1.interface.encodeFunctionData("initialize", [initialValue]);

    // 获取 OpenZeppelin ERC1967Proxy 工厂
    const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
    const proxy = await ERC1967Proxy.deploy(await implV1.getAddress(), initData);
    // 部署代理：构造参数 = (实现地址, 初始化 calldata)
    // 构造内部会 delegatecall 到 BoxV1.initialize，owner=部署者，value=initialValue

    await proxy.waitForDeployment();
    // 等待代理部署完成

    // attach：用 BoxV1 ABI 绑定到「代理地址」，后续调用会走 delegatecall 到当前实现
    const box = BoxV1.attach(await proxy.getAddress()) as unknown as BoxV1;
    // as unknown as BoxV1：绕过 TypeChain 对 attach 返回类型的宽泛推断

    return {
      box, // 绑定代理地址的 BoxV1 实例（用户视角的合约）
      proxy, // 代理合约实例本身
      implV1, // V1 实现地址
      owner, // 部署者 / owner 签名者
      stranger, // 无关账户，用于测权限
      BoxV1, // 工厂引用，部分用例需要
      BoxV2: await ethers.getContractFactory("BoxV2") // V2 工厂，升级用例需要
    };
  }

  it("V1 通过代理读写 value", async function () {
    // 用例 1：验证代理 + V1 的基本读写，不涉及升级

    const { box, owner } = await deployProxy(42n);
    // 部署代理，初始 value=42；owner 为 accounts[0]

    expect(await box.version()).to.equal("V1");
    // 经代理调用 version()，应返回 V1 实现里的字符串

    expect(await box.value()).to.equal(42n);
    // initialize 写入的 value 应可读；BigInt 字面量带 n 后缀

    expect(await box.owner()).to.equal(owner.address);
    // initialize 时 msg.sender=owner，故 owner 应为部署者地址

    await box.setValue(99n);
    // owner 发送 setValue 交易（经代理改 storage）

    expect(await box.value()).to.equal(99n);
    // 链上 value 应已更新为 99
  });

  it("升级到 V2 后保留状态并可用新功能", async function () {
    // 用例 2：完整 UUPS 升级流程 + 状态保留 + V2 新函数

    const { box, proxy, owner, BoxV2 } = await deployProxy(42n);
    // box 指向代理；proxy 用于 attach V2 ABI；owner 有权 upgradeToAndCall

    const implV2 = await BoxV2.deploy();
    // 单独部署 BoxV2 实现合约（仅 bytecode 部署，不初始化）

    await implV2.waitForDeployment();
    // 等待 V2 实现部署完成

    const upgradeData = BoxV2.interface.encodeFunctionData("initializeV2", ["demo-label"]);
    // 升级时附带执行的 calldata：initializeV2("demo-label")，写入 V2 新增字段 label

    await box.connect(owner).upgradeToAndCall(await implV2.getAddress(), upgradeData);
    // owner 经「代理地址」调用 upgradeToAndCall（UUPS 逻辑在 V1 实现里）
    // 效果：① 代理 implementation 槽 → V2 地址  ② delegatecall initializeV2

    const boxV2 = BoxV2.attach(await proxy.getAddress()) as unknown as BoxV2;
    // 同一代理地址，换 V2 ABI 绑定，可调用 increment / label 等 V2 方法

    expect(await boxV2.version()).to.equal("V2");
    // 实现已换为 V2，version 应变为 V2

    expect(await boxV2.value()).to.equal(42n);
    // 升级前 value=42，storage 在代理上，升级后应保留（布局兼容）

    expect(await boxV2.label()).to.equal("demo-label");
    // initializeV2 在升级交易中执行，label 应已写入

    await boxV2.increment();
    // 调用 V2 独有函数：value += 1

    expect(await boxV2.value()).to.equal(43n);
    // 42 + 1 = 43，证明 V2 逻辑生效
  });

  it("非 owner 不能升级", async function () {
    // 用例 3：权限校验 _authorizeUpgrade 仅允许 owner

    const { box, stranger, BoxV2 } = await deployProxy();
    // stranger 不是 initialize 时的 msg.sender，不是 owner

    const implV2 = await BoxV2.deploy();
    await implV2.waitForDeployment();
    // 部署 V2 实现（地址本身合法，但调用者应 revert）

    await expect(
      box.connect(stranger).upgradeToAndCall(await implV2.getAddress(), "0x")
      // stranger 尝试升级；data 用 "0x" 表示升级后不执行额外初始化（本用例只测权限）
    ).to.be.revertedWithCustomError(box, "NotOwner");
    // 应 revert 且 error 选择器为 BoxV1.NotOwner()
  });

  it("BoxProxyFactory 由工厂部署代理并完成 initialize", async function () {
    // 用例 4：验证工厂合约 create() 等价于手动部署 impl + proxy + initialize

    const Factory = await ethers.getContractFactory("BoxProxyFactory");
    const factory = (await Factory.deploy()) as unknown as BoxProxyFactory;
    await factory.waitForDeployment();
    // 部署工厂合约

    const tx = await factory.create(7n);
    // 调用 create(7)：内部 new BoxV1 + new ERC1967Proxy(..., initialize(7))

    const receipt = await tx.wait();
    // 等待交易回执，从中解析事件拿到 proxy 地址

    const parsed = receipt!.logs
      .map((log) => factory.interface.parseLog(log))
      // 逐条 log 用工厂 ABI 解析（过滤非本合约事件）
      .find((entry) => entry?.name === "BoxProxyCreated")!;
    // 找到 BoxProxyCreated 事件；! 断言非 undefined（测试里若缺失会直接抛错）

    const proxyAddr = parsed.args.proxy as string;
    // 从事件参数取出代理地址（indexed 参数在 args 里同样可访问）

    const BoxV1 = await ethers.getContractFactory("BoxV1");
    const box = BoxV1.attach(proxyAddr) as unknown as BoxV1;
    // 用 BoxV1 ABI 绑定工厂创建的代理

    expect(await box.version()).to.equal("V1");
    // 工厂路径也应正确初始化并指向 V1 逻辑

    expect(await box.value()).to.equal(7n);
    // create(7) 传入的 initialValue 应已写入
  });
});
