import { ethers } from "hardhat";

/**
 * 将 GameItem（ERC721）部署到 Sepolia。
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

  const GameItem = await ethers.getContractFactory("GameItem");
  const nft = await GameItem.deploy();
  await nft.waitForDeployment();

  const addr = await nft.getAddress();
  console.log("GameItem deployed to:", addr);
  console.log("Name:", await nft.name(), "Symbol:", await nft.symbol());
  console.log("前端 .env：VITE_GAME_ITEM_NFT_ADDRESS=", addr);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
