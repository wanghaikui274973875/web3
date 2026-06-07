import { ethers } from "hardhat";

async function main() {
  const nftAddr = "0x5b0e17F96869dbBDf007491261aeA834D9Bfb7cF";
  const houseAddr = "0x29324168Df39a65764aB4743C5298554eC01dc91";
  const erc20Addr = "0xe007444cc40F1C2193EF42a9b48962561E9f4a5C";

  console.log("=== 链上检查 Sepolia .env 地址 ===\n");

  for (const [label, addr] of [
    ["GameItem", nftAddr],
    ["House", houseAddr],
    ["SampleERC20", erc20Addr]
  ] as const) {
    const code = await ethers.provider.getCode(addr);
    console.log(`${label} ${addr}`);
    console.log(`  bytecode: ${code.length > 2 ? "有合约" : "无合约/EOA"}`);
  }

  const gi = await ethers.getContractAt("GameItem", nftAddr);
  console.log("\n--- GameItem ---");
  console.log("name:", await gi.name());
  console.log("symbol:", await gi.symbol());
  console.log("totalMinted:", (await gi.totalMinted()).toString());
  for (const id of [0n, 1n, 2n]) {
    try {
      console.log(`ownerOf(${id}):`, await gi.ownerOf(id));
    } catch {
      console.log(`ownerOf(${id}): 不存在`);
    }
  }

  const house = await ethers.getContractAt("EnglishAuctionHouse", houseAddr);
  console.log("\n--- EnglishAuctionHouse ---");
  const rc = await house.roundCounter();
  console.log("roundCounter:", rc.toString());
  for (let i = 0n; i < rc && i < 5n; i++) {
    const r = await house.getRound(i);
    const now = BigInt(Math.floor(Date.now() / 1000));
    console.log(`round #${i}:`, {
      seller: r.seller,
      nft: r.nft,
      tokenId: r.tokenId.toString(),
      paymentToken: r.paymentToken,
      itemDeposited: r.itemDeposited,
      state: Number(r.state),
      startTime: Number(r.startTime),
      endTime: Number(r.endTime),
      started: now >= r.startTime,
      biddable: await house.isBiddable(i)
    });
    const nftMatch = String(r.nft).toLowerCase() === nftAddr.toLowerCase();
    console.log(`  nft 与 .env GameItem 一致: ${nftMatch}`);
    if (r.tokenId < 100n) {
      try {
        const owner = await gi.ownerOf(r.tokenId);
        console.log(`  ownerOf(tokenId): ${owner}`);
        const approved = await gi.getApproved(r.tokenId);
        const all = await gi.isApprovedForAll(r.seller, houseAddr);
        console.log(`  getApproved: ${approved}, approvedForAll: ${all}`);
      } catch {
        console.log(`  ownerOf(tokenId): 不存在`);
      }
    }
  }

  const token = await ethers.getContractAt("SampleERC20", erc20Addr);
  console.log("\n--- SampleERC20 ---");
  console.log("name:", await token.name());
  console.log("symbol:", await token.symbol());
  console.log("maxSupply:", ethers.formatEther(await token.maxSupply()));
}

main().catch(console.error);
