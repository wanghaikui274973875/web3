// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {TransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
// Transparent 代理：Admin 调用走升级通道，普通用户调用转发到实现（避免函数选择器冲突）

import {BoxTransparentV1} from "./BoxTransparentV1.sol";
// 要挂载在代理后的第一版逻辑合约

/**
 * @title BoxTransparentProxyFactory
 * @dev 部署 Transparent 代理：实现合约 + TransparentUpgradeableProxy（内置 ProxyAdmin）。
 */
contract BoxTransparentProxyFactory {
    // 工厂：一次交易部署 Transparent 整套结构

    event BoxTransparentProxyCreated(
        address indexed creator,
        // 创建者地址（indexed 便于链上检索）
        address indexed proxy,
        // Transparent 代理地址：用户日常交互用这个地址
        address indexed implementation,
        // BoxTransparentV1 实现地址
        uint256 initialValue
        // 初始化时写入的 value
    );

    function create(uint256 initialValue) external returns (address proxy, address implementation) {
        // 创建 Transparent 代理并完成 initialize

        implementation = address(new BoxTransparentV1());
        // 部署 V1 逻辑实现合约

        bytes memory initData = abi.encodeCall(BoxTransparentV1.initialize, (initialValue));
        // 编码 initialize 调用数据

        proxy = address(new TransparentUpgradeableProxy(implementation, msg.sender, initData));
        // 部署 Transparent 代理：
        // - implementation：初始逻辑合约地址
        // - msg.sender：作为 ProxyAdmin 的 initialOwner，有权 upgradeAndCall
        // - initData：构造时 delegatecall 初始化代理 storage
        // 构造内部还会 new ProxyAdmin(initialOwner)，Admin 地址存在 ERC-1967 admin 槽

        emit BoxTransparentProxyCreated(msg.sender, proxy, implementation, initialValue);
        // 记录创建事件
    }
}
