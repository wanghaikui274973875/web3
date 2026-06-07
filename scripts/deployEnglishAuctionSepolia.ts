/**
 * Sepolia 部署 EnglishAuctionHouse（逐行注释版）
 * 命令：npm run deploy:sepolia:english-auction
 */

import { ethers } from "hardhat";

async function main() {
  const rpc = process.env.SEPOLIA_RPC_URL?.trim();
  // 读取 RPC
  const pk = process.env.SEPOLIA_PRIVATE_KEY?.trim();
  // 读取私钥（hardhat.config 用于 accounts）
  if (!rpc) throw new Error("缺少环境变量 SEPOLIA_RPC_URL");
  if (!pk) throw new Error("缺少环境变量 SEPOLIA_PRIVATE_KEY");

  const [deployer] = await ethers.getSigners();
  // 部署账户
  console.log("Deployer:", deployer.address);

  const House = await ethers.getContractFactory("EnglishAuctionHouse");
  const house = await House.deploy();
  await house.waitForDeployment();
  // 部署 House 合约
  const houseAddr = await house.getAddress();
  console.log("EnglishAuctionHouse:", houseAddr);

  const demoNft = process.env.SEPOLIA_ENGLISH_AUCTION_DEMO_NFT?.trim();
  const demoTokenId = process.env.SEPOLIA_ENGLISH_AUCTION_DEMO_TOKEN_ID?.trim();

  if (demoNft && demoTokenId !== undefined && demoTokenId !== "") {
    const tokenId = BigInt(demoTokenId);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const startTime = now + 120n;
    const endTime = startTime + 3600n;
    const minBid = ethers.parseEther("0.01");
    const minIncrement = ethers.parseEther("0.001");

    const tx = await house.createRound(
      demoNft,
      tokenId,
      ethers.ZeroAddress,
      startTime,
      endTime,
      minBid,
      minIncrement
    );
    await tx.wait();
    // 创建 ETH 演示轮次
    const roundId = (await house.roundCounter()) - 1n;
    console.log("Demo roundId:", roundId.toString());

    const nft = await ethers.getContractAt("IERC721", demoNft);
    await (await nft.approve(houseAddr, tokenId)).wait();
    // 授权 House
    await (await house.depositItem(roundId)).wait();
    // 托管 NFT
    console.log("Demo round deposited NFT", demoNft, "tokenId", tokenId.toString());
  } else {
    console.log("跳过演示轮次（可选 SEPOLIA_ENGLISH_AUCTION_DEMO_NFT + SEPOLIA_ENGLISH_AUCTION_DEMO_TOKEN_ID）");
  }

  console.log("\n写入 web3-dapp/.env：");
  console.log(`VITE_ENGLISH_AUCTION_HOUSE_ADDRESS=${houseAddr}`);
  console.log("\n修改 .env 后请重启 web3-dapp：npm run dev");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
