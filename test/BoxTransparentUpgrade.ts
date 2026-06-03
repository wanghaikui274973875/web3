import { expect } from "chai";
import { ethers } from "hardhat";
import { readErc1967Admin } from "../scripts/erc1967";
import type { BoxTransparentProxyFactory, BoxTransparentV1, BoxTransparentV2, ProxyAdmin } from "../typechain-types";

describe("Box Transparent 代理升级", function () {
  async function deployTransparentProxy(initialValue = 42n) {
    const [owner, stranger] = await ethers.getSigners();

    const BoxTransparentV1 = await ethers.getContractFactory("BoxTransparentV1");
    const implV1 = await BoxTransparentV1.deploy();
    await implV1.waitForDeployment();

    const initData = BoxTransparentV1.interface.encodeFunctionData("initialize", [initialValue]);
    const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy");
    const proxy = await TransparentUpgradeableProxy.deploy(
      await implV1.getAddress(),
      owner.address,
      initData
    );
    await proxy.waitForDeployment();

    const proxyAddr = await proxy.getAddress();
    const proxyAdminAddr = await readErc1967Admin(proxyAddr);
    const proxyAdmin = (await ethers.getContractAt(
      "ProxyAdmin",
      proxyAdminAddr
    )) as unknown as ProxyAdmin;

    const box = BoxTransparentV1.attach(proxyAddr) as unknown as BoxTransparentV1;
    return {
      box,
      proxy,
      implV1,
      proxyAdmin,
      proxyAdminAddr,
      owner,
      stranger,
      BoxTransparentV2: await ethers.getContractFactory("BoxTransparentV2")
    };
  }

  it("V1 通过 Transparent 代理读写 value", async function () {
    const { box, owner } = await deployTransparentProxy(42n);
    expect(await box.version()).to.equal("Transparent-V1");
    expect(await box.value()).to.equal(42n);
    expect(await box.owner()).to.equal(owner.address);
  });

  it("ProxyAdmin 升级到 V2 后保留状态", async function () {
    const { box, proxy, proxyAdmin, owner, BoxTransparentV2 } = await deployTransparentProxy(42n);

    const implV2 = await BoxTransparentV2.deploy();
    await implV2.waitForDeployment();

    const upgradeData = BoxTransparentV2.interface.encodeFunctionData("initializeV2", ["transparent-label"]);
    await proxyAdmin
      .connect(owner)
      .upgradeAndCall(await proxy.getAddress(), await implV2.getAddress(), upgradeData);

    const boxV2 = BoxTransparentV2.attach(await proxy.getAddress()) as unknown as BoxTransparentV2;
    expect(await boxV2.version()).to.equal("Transparent-V2");
    expect(await boxV2.value()).to.equal(42n);
    expect(await boxV2.label()).to.equal("transparent-label");

    await boxV2.increment();
    expect(await boxV2.value()).to.equal(43n);
  });

  it("非 ProxyAdmin owner 不能升级", async function () {
    const { proxy, proxyAdmin, stranger, BoxTransparentV2 } = await deployTransparentProxy();

    const implV2 = await BoxTransparentV2.deploy();
    await implV2.waitForDeployment();

    await expect(
      proxyAdmin
        .connect(stranger)
        .upgradeAndCall(await proxy.getAddress(), await implV2.getAddress(), "0x")
    ).to.be.revertedWithCustomError(proxyAdmin, "OwnableUnauthorizedAccount");
  });

  it("BoxTransparentProxyFactory 部署 Transparent 代理", async function () {
    const Factory = await ethers.getContractFactory("BoxTransparentProxyFactory");
    const factory = (await Factory.deploy()) as unknown as BoxTransparentProxyFactory;
    await factory.waitForDeployment();

    const tx = await factory.create(9n);
    const receipt = await tx.wait();
    const parsed = receipt!.logs
      .map((log) => factory.interface.parseLog(log))
      .find((entry) => entry?.name === "BoxTransparentProxyCreated")!;

    const proxyAddr = parsed.args.proxy as string;
    const BoxTransparentV1 = await ethers.getContractFactory("BoxTransparentV1");
    const box = BoxTransparentV1.attach(proxyAddr) as unknown as BoxTransparentV1;

    expect(await box.version()).to.equal("Transparent-V1");
    expect(await box.value()).to.equal(9n);
  });
});
