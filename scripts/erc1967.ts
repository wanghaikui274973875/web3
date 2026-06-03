/**
 * ERC-1967 代理 storage 工具
 *
 * Transparent 代理的 ProxyAdmin 地址存在固定 storage slot，
 * 但 IERC1967 接口只有事件、没有 admin() view 函数，故用 eth_getStorageAt 读取。
 *
 * 参考：EIP-1967 — slot = keccak256("eip1967.proxy.admin") - 1
 */

import { ethers } from "hardhat";
// 使用 Hardhat 默认 provider 读链上 storage

/** ERC-1967 标准 admin 槽位（与 OpenZeppelin ERC1967Utils.ADMIN_SLOT 一致） */
const ERC1967_ADMIN_SLOT =
  "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103";

/**
 * 读取代理合约当前的 ProxyAdmin 地址
 * @param proxyAddress TransparentUpgradeableProxy 地址
 * @returns 校验和格式的 ProxyAdmin 地址
 */
export async function readErc1967Admin(proxyAddress: string): Promise<string> {
  const raw = await ethers.provider.getStorage(proxyAddress, ERC1967_ADMIN_SLOT);
  // raw 为 32 字节 hex；低 20 字节为 address

  return ethers.getAddress(`0x${raw.slice(-40)}`);
  // slice(-40) 取后 40 个 hex 字符 = 20 字节地址；getAddress 转为 EIP-55 校验和
}
