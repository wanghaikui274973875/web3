import { run } from "hardhat";

/**
 * 在 Sepolia Etherscan 验证 DutchAuction（验证后才有 Read/Write Contract 界面）
 *
 * 前置：
 *   .env 中 ETHERSCAN_API_KEY（https://etherscan.io/myapikey 申请，Sepolia 通用）
 *
 * 用法（把参数换成你部署时的实际值）：
 *   npx hardhat run scripts/verifyDutchAuctionSepolia.ts --network sepolia
 *
 * 或直接用 hardhat verify：
 *   npx hardhat verify --network sepolia <拍卖合约地址> <nft地址> 0 0x000... 10000000000000000 1000000000000000 <startTime> <endTime>
 */

const AUCTION = "0x59612abAF66964d9a2B544649d5a97a91Cb13fE2";
const NFT = "0x89AB7D349B894Ba6DdE2a4AB9d32F872be2df5a3";
const TOKEN_ID = 0;
const PAYMENT_TOKEN = "0x0000000000000000000000000000000000000000";
const START_PRICE = "10000000000000000"; // 0.01 ETH
const END_PRICE = "1000000000000000"; // 0.001 ETH
// 部署日志里的 unix 时间戳，请按你实际部署输出修改：
const START_TIME = "1780643390";
const END_TIME = "1781248190";

async function main() {
  if (!process.env.ETHERSCAN_API_KEY?.trim()) {
    throw new Error("请在 .env 中设置 ETHERSCAN_API_KEY");
  }

  console.log("验证 DutchAuction:", AUCTION);
  await run("verify:verify", {
    address: AUCTION,
    constructorArguments: [
      NFT,
      TOKEN_ID,
      PAYMENT_TOKEN,
      START_PRICE,
      END_PRICE,
      START_TIME,
      END_TIME
    ]
  });
  console.log("验证成功！刷新 Etherscan Contract 页可见 Read/Write");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
