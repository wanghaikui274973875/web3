import { ethers } from "hardhat";

/**
 * 将 MemoStorage 部署到 Sepolia，并做一次链上读写校验。
 *
 * 前置：.env 中 SEPOLIA_RPC_URL、SEPOLIA_PRIVATE_KEY。
 */
async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL?.trim();
  const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
  if (!rpc) throw new Error("缺少环境变量 SEPOLIA_RPC_URL");
  if (!pk) throw new Error("缺少环境变量 SEPOLIA_PRIVATE_KEY");

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const MemoStorage = await ethers.getContractFactory("MemoStorage");
  const memo = await MemoStorage.deploy();
  await memo.waitForDeployment();

  const addr = await memo.getAddress();
  console.log("MemoStorage deployed to:", addr);

  const test = "deploy script check";
  const tx = await memo.setMyMemo(test);
  await tx.wait();
  const read = await memo.getMemo(deployer.address);
  if (read !== test) throw new Error("链上验证失败");
  console.log("Sepolia 验证通过。前端 .env：VITE_MEMO_STORAGE_ADDRESS=", addr);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
