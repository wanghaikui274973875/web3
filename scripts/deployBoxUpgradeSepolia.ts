/**
 * Sepolia 部署：UUPS + Transparent 两套 Box 代理演示
 *
 * 命令：npm run deploy:sepolia:box
 *       （等价 hardhat run scripts/deployBoxUpgradeSepolia.ts --network sepolia）
 *
 * 前置 hardhat/.env：
 *   SEPOLIA_RPC_URL      — Sepolia JSON-RPC
 *   SEPOLIA_PRIVATE_KEY  — 部署钱包私钥（需有 Sepolia ETH）
 *
 * 可选 SEPOLIA_BOX_VERIFY_UPGRADE=1 — 部署后在脚本内自动执行一次升级到 V2
 *
 * 输出 4 个地址 → 复制到 web3-dapp/.env 后重启 npm run dev
 */

import { ethers } from "hardhat";
// Hardhat 运行时 ethers：连接 hardhat.config.ts 里配置的 sepolia 网络

import { readErc1967Admin } from "./erc1967";
// 工具函数：从代理合约 storage 读取 ProxyAdmin 地址（Transparent 用）

async function main() {
  // ── 1. 校验环境变量 ───────────────────────────────────
  const rpc = process.env.SEPOLIA_RPC_URL?.trim();
  const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
  // 从 .env 读取 RPC 与私钥；hardhat.config.ts 用私钥配置 sepolia accounts

  if (!rpc) throw new Error("缺少环境变量 SEPOLIA_RPC_URL");
  if (!pk) throw new Error("缺少环境变量 SEPOLIA_PRIVATE_KEY");
  // 缺任一项则提前失败，避免连错网络或无法签名

  const [deployer] = await ethers.getSigners();
  // 第一个 signer = SEPOLIA_PRIVATE_KEY 对应账户，即部署者与 owner

  console.log("Deployer:", deployer.address);
  // 打印部署地址，应与前端 MetaMask 升级时使用的钱包一致（UUPS owner / ProxyAdmin owner）

  const initialValue = 100n;
  // 代理 initialize 时写入的 value；BigInt 字面量

  const upgradeLabel = "sepolia-demo";
  // 可选升级验证时 initializeV2 使用的 label 字符串

  // ── 2. UUPS 方案部署 ───────────────────────────────────
  console.log("\n=== UUPS (ERC1967Proxy + BoxV1/V2) ===");

  const BoxV1 = await ethers.getContractFactory("BoxV1");
  // 加载编译产物中的 BoxV1 工厂（ABI + bytecode）

  const uupsImplV1 = await BoxV1.deploy();
  // 部署 V1 实现合约；此时未 initialize，不能直接当业务合约用

  await uupsImplV1.waitForDeployment();
  // 等待上链，确保后续 getAddress 有效

  const uupsImplV1Addr = await uupsImplV1.getAddress();
  console.log("BoxV1 implementation:", uupsImplV1Addr);
  // 实现地址：升级前 delegatecall 目标；前端日常交互不用填这个

  const BoxV2 = await ethers.getContractFactory("BoxV2");
  const uupsImplV2 = await BoxV2.deploy();
  await uupsImplV2.waitForDeployment();
  const uupsImplV2Addr = await uupsImplV2.getAddress();
  console.log("BoxV2 implementation (预部署):", uupsImplV2Addr);
  // 预部署 V2：前端 upgradeToAndCall 的目标地址 → VITE_BOX_UUPS_IMPL_V2_ADDRESS

  const uupsInitData = BoxV1.interface.encodeFunctionData("initialize", [initialValue]);
  // 编码 initialize(100) calldata，代理构造时 delegatecall 执行

  const ERC1967Proxy = await ethers.getContractFactory("ERC1967Proxy");
  const uupsProxy = await ERC1967Proxy.deploy(uupsImplV1Addr, uupsInitData);
  // 部署 UUPS 代理：写入 implementation 槽 + 初始化 storage（owner=deployer, value=100）

  await uupsProxy.waitForDeployment();
  const uupsProxyAddr = await uupsProxy.getAddress();
  console.log("UUPS proxy:", uupsProxyAddr);
  // 代理地址 → VITE_BOX_UUPS_PROXY_ADDRESS（用户/前端始终与此地址交互）

  const uupsBox = BoxV1.attach(uupsProxyAddr);
  // 用 BoxV1 ABI 绑定代理地址，便于链上读验证

  console.log("UUPS version:", await uupsBox.version());
  console.log("UUPS value:", (await uupsBox.value()).toString());
  console.log("UUPS owner:", await uupsBox.owner());
  // 部署后立即读链：应为 V1 / 100 / deployer.address

  // ── 3. Transparent 方案部署 ────────────────────────────
  console.log("\n=== Transparent (TransparentUpgradeableProxy + BoxTransparentV1/V2) ===");

  const BoxTransparentV1 = await ethers.getContractFactory("BoxTransparentV1");
  const transparentImplV1 = await BoxTransparentV1.deploy();
  await transparentImplV1.waitForDeployment();
  const transparentImplV1Addr = await transparentImplV1.getAddress();
  console.log("BoxTransparentV1 implementation:", transparentImplV1Addr);
  // Transparent 第一版实现（无 UUPS 升级函数）

  const BoxTransparentV2 = await ethers.getContractFactory("BoxTransparentV2");
  const transparentImplV2 = await BoxTransparentV2.deploy();
  await transparentImplV2.waitForDeployment();
  const transparentImplV2Addr = await transparentImplV2.getAddress();
  console.log("BoxTransparentV2 implementation (预部署):", transparentImplV2Addr);
  // 预部署 V2 → VITE_BOX_TRANSPARENT_IMPL_V2_ADDRESS

  const transparentInitData = BoxTransparentV1.interface.encodeFunctionData("initialize", [initialValue]);
  // Transparent 代理初始化 calldata

  const TransparentUpgradeableProxy = await ethers.getContractFactory("TransparentUpgradeableProxy");
  const transparentProxy = await TransparentUpgradeableProxy.deploy(
    transparentImplV1Addr,
    deployer.address,
    transparentInitData
  );
  // 参数：(逻辑合约, ProxyAdmin的initialOwner, 初始化data)
  // 构造内部会 new ProxyAdmin(deployer) 并把 admin 写入 ERC-1967 admin 槽

  await transparentProxy.waitForDeployment();
  const transparentProxyAddr = await transparentProxy.getAddress();
  console.log("Transparent proxy:", transparentProxyAddr);
  // → VITE_BOX_TRANSPARENT_PROXY_ADDRESS

  const proxyAdminAddr = await readErc1967Admin(transparentProxyAddr);
  console.log("ProxyAdmin:", proxyAdminAddr);
  // Transparent 升级需通过此 ProxyAdmin 合约；owner 为 deployer

  const transparentBox = BoxTransparentV1.attach(transparentProxyAddr);
  console.log("Transparent version:", await transparentBox.version());
  console.log("Transparent value:", (await transparentBox.value()).toString());
  console.log("Transparent owner:", await transparentBox.owner());
  // 链上验证 Transparent 初始化成功

  // ── 4. 可选：部署后立刻升级一次（冒烟测试）────────────
  console.log("\n=== 链上升级验证（可选） ===");

  const doVerify = process.env.SEPOLIA_BOX_VERIFY_UPGRADE === "1";
  // .env 设 SEPOLIA_BOX_VERIFY_UPGRADE=1 才执行，默认跳过以便前端演示 V1→V2 升级

  if (doVerify) {
    const uupsUpgradeData = BoxV2.interface.encodeFunctionData("initializeV2", [upgradeLabel]);
    const uupsUpgradeTx = await uupsBox.upgradeToAndCall(uupsImplV2Addr, uupsUpgradeData);
    // deployer 作为 owner 调用 UUPS 升级 + initializeV2

    await uupsUpgradeTx.wait();
    const uupsBoxV2 = BoxV2.attach(uupsProxyAddr);
    console.log("UUPS 升级后 version:", await uupsBoxV2.version());
    console.log("UUPS 升级后 label:", await uupsBoxV2.label());
    // 确认已是 V2 且 label 写入

    const proxyAdmin = await ethers.getContractAt("ProxyAdmin", proxyAdminAddr);
    // 绑定 ProxyAdmin 合约实例

    const transparentUpgradeData = BoxTransparentV2.interface.encodeFunctionData("initializeV2", [
      upgradeLabel
    ]);
    const transparentUpgradeTx = await proxyAdmin.upgradeAndCall(
      transparentProxyAddr,
      transparentImplV2Addr,
      transparentUpgradeData
    );
    // ProxyAdmin owner（deployer）发起 Transparent 升级

    await transparentUpgradeTx.wait();
    const transparentBoxV2 = BoxTransparentV2.attach(transparentProxyAddr);
    console.log("Transparent 升级后 version:", await transparentBoxV2.version());
    console.log("Transparent 升级后 label:", await transparentBoxV2.label());
  } else {
    console.log("跳过升级验证（设置 SEPOLIA_BOX_VERIFY_UPGRADE=1 可在部署脚本内自动升级一次）");
  }

  // ── 5. 输出前端环境变量 ────────────────────────────────
  console.log("\n=== 写入 web3-dapp/.env ===");
  console.log(`VITE_BOX_UUPS_PROXY_ADDRESS=${uupsProxyAddr}`);
  console.log(`VITE_BOX_UUPS_IMPL_V2_ADDRESS=${uupsImplV2Addr}`);
  console.log(`VITE_BOX_TRANSPARENT_PROXY_ADDRESS=${transparentProxyAddr}`);
  console.log(`VITE_BOX_TRANSPARENT_IMPL_V2_ADDRESS=${transparentImplV2Addr}`);
  console.log("\n修改 .env 后请重启 web3-dapp：npm run dev");
  // Vite 仅在启动时注入 import.meta.env，改 .env 必须重启 dev 服务
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
  // 非零退出码，便于 CI / 终端识别失败
});
