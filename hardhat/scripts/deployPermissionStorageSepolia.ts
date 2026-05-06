import { ethers } from "hardhat";

/**
 * Day17：部署 PermissionStorage 到 Sepolia，并做一次链上读写验证。
 *
 * 前置：在项目根目录创建 .env（参考 .env.example），填写 SEPOLIA_RPC_URL 与 SEPOLIA_PRIVATE_KEY。
 */
async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL?.trim();
  const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
  if (!rpc) {
    throw new Error("缺少环境变量 SEPOLIA_RPC_URL");
  }
  if (!pk) {
    throw new Error("缺少环境变量 SEPOLIA_PRIVATE_KEY");
  }

  const [deployer] = await ethers.getSigners();
  const testTargetEnv = process.env.SEPOLIA_PERMISSION_TEST_ADDRESS?.trim();
  const testTarget = testTargetEnv && ethers.isAddress(testTargetEnv) ? testTargetEnv : deployer.address;

  console.log("Deployer:", deployer.address);

  const PermissionStorage = await ethers.getContractFactory("PermissionStorage");
  const storage = await PermissionStorage.deploy();
  await storage.waitForDeployment();

  const addr = await storage.getAddress();
  console.log("PermissionStorage deployed to:", addr);

  const before = await storage.getPermission(testTarget);
  console.log("getPermission before:", testTarget, "=>", before);

  const tx = await storage.setPermission(testTarget, true);
  await tx.wait();
  const after = await storage.getPermission(testTarget);
  console.log("getPermission after:", testTarget, "=>", after);

  if (after !== true) {
    throw new Error("链上验证失败：setPermission 后仍为 false");
  }

  console.log("Sepolia 验证通过。");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
