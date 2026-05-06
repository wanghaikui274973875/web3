import { ethers } from "hardhat";

async function main() {
  const SampleERC20 = await ethers.getContractFactory("SampleERC20");
  const token = await SampleERC20.deploy("TestToken", "TST", 18, 1000);
  await token.waitForDeployment();

  console.log(`SampleERC20 deployed to: ${await token.getAddress()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
