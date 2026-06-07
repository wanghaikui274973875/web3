import { ethers } from "hardhat";

async function main() {
  const [seller, b1, b2] = await ethers.getSigners();
  const GameItem = await ethers.getContractFactory("GameItem");
  const nft = await GameItem.deploy();
  await nft.waitForDeployment();
  const SampleERC20 = await ethers.getContractFactory("SampleERC20");
  const token = await SampleERC20.deploy("Gas", "GAS", 18, ethers.parseUnits("1000000", 18));
  await token.waitForDeployment();

  const House = await ethers.getContractFactory("EnglishAuctionHouse");
  const house = await House.deploy();
  await house.waitForDeployment();
  const ha = await house.getAddress();

  await nft.connect(seller).mint("ipfs://gas-1");
  await nft.connect(seller).approve(ha, 0n);

  const now = (await ethers.provider.getBlock("latest"))!.timestamp;
  const start = now + 60;
  const end = start + 3600;

  const gas = async (label: string, p: Promise<{ wait: () => Promise<{ gasUsed: bigint } | null> }>) => {
    const tx = await p;
    const rc = await tx.wait();
    console.log(`${label}: ${rc?.gasUsed ?? 0n}`);
  };

  await gas("createRound", house.connect(seller).createRound(await nft.getAddress(), 0n, ethers.ZeroAddress, start, end, ethers.parseEther("0.01"), ethers.parseEther("0.001")));
  await gas("depositItem", house.connect(seller).depositItem(0n));
  await ethers.provider.send("evm_increaseTime", [61]);
  await ethers.provider.send("evm_mine", []);
  const b01 = ethers.parseEther("0.01");
  const b011 = ethers.parseEther("0.011");
  await gas("bid (first)", house.connect(b1).bid(0n, b01, { value: b01 }));
  await gas("bid (outbid)", house.connect(b2).bid(0n, b011, { value: b011 }));
  await ethers.provider.send("evm_increaseTime", [3600]);
  await ethers.provider.send("evm_mine", []);
  await gas("finalizeRound", house.finalizeRound(0n));
  await gas("claimRefund", house.connect(b1).claimRefund(0n));
  await gas("claimProceeds", house.connect(seller).claimProceeds(0n));
  await gas("claimItem", house.connect(b2).claimItem(0n));

  const tok = await token.getAddress();
  await nft.connect(seller).mint("ipfs://gas-2");
  await nft.connect(seller).approve(ha, 1n);
  const now2 = (await ethers.provider.getBlock("latest"))!.timestamp;
  const start2 = now2 + 120;
  const end2 = start2 + 3600;
  await gas("createRound ERC20", house.connect(seller).createRound(await nft.getAddress(), 1n, tok, start2, end2, ethers.parseUnits("10", 18), ethers.parseUnits("1", 18)));
  await gas("depositItem #1", house.connect(seller).depositItem(1n));
  await token.connect(seller).transfer(b1.address, ethers.parseUnits("100", 18));
  await token.connect(seller).transfer(b2.address, ethers.parseUnits("100", 18));
  await token.connect(b1).approve(ha, ethers.parseUnits("100", 18));
  await token.connect(b2).approve(ha, ethers.parseUnits("100", 18));
  await ethers.provider.send("evm_increaseTime", [121]);
  await ethers.provider.send("evm_mine", []);
  await gas("bidWithToken (first)", house.connect(b1).bidWithToken(1n, ethers.parseUnits("10", 18)));
  await gas("bidWithToken (outbid)", house.connect(b2).bidWithToken(1n, ethers.parseUnits("11", 18)));
}

main().catch(console.error);
