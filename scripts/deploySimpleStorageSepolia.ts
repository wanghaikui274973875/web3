import { ethers } from "hardhat";

/**
 * 将 SimpleStorage 部署到 Sepolia，并校验 getNum / setNum。
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
  console.log("Deployer:", deployer.address);

  const SimpleStorage = await ethers.getContractFactory("SimpleStorage");
  const storage = await SimpleStorage.deploy();
  await storage.waitForDeployment();

  const addr = await storage.getAddress();
  console.log("SimpleStorage deployed to:", addr);

  const before = await storage.getNum();
  console.log("getNum before:", before.toString());

  const testValue = 42n;
  const tx = await storage.setNum(testValue);
  await tx.wait();
  const after = await storage.getNum();
  console.log("getNum after setNum(42):", after.toString());

  if (after !== testValue) {
    throw new Error("链上验证失败：setNum 后 getNum 与预期不一致");
  }

  console.log("Sepolia 验证通过。请将上述合约地址写入前端 .env：VITE_SIMPLE_STORAGE_ADDRESS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
