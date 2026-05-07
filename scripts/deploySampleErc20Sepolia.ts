import { ethers } from "hardhat";

/**
 * 将 SampleERC20 部署到 Sepolia（全部供应量 mint 给部署者）。
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

  const supply = ethers.parseEther("1000000");
  const SampleERC20 = await ethers.getContractFactory("SampleERC20");
  const token = await SampleERC20.deploy("Sample Token", "SMPL", 18, supply);
  await token.waitForDeployment();

  const addr = await token.getAddress();
  console.log("SampleERC20 deployed to:", addr);
  console.log("Symbol:", await token.symbol(), "Decimals:", await token.decimals());
  console.log("Deployer balance:", ethers.formatEther(await token.balanceOf(deployer.address)), "SMPL");
  console.log("前端 .env：VITE_SAMPLE_ERC20_ADDRESS=", addr);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
