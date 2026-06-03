// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
// ERC-1967 标准代理：storage 里固定槽位存「当前实现地址」，用户调用转发到实现

import {BoxV1} from "./BoxV1.sol";
// 本工厂部署的逻辑合约第一版

/**
 * @title BoxProxyFactory
 * @dev 教学示例：工厂合约一次性部署「实现合约 + ERC1967 代理」，并完成 `initialize`。
 */
contract BoxProxyFactory {
    // 工厂合约：演示「合约用 new 部署其它合约」

    event BoxProxyCreated(
        address indexed creator,
        // indexed：可按 creator 地址过滤日志（topics 最多 3 个 indexed）
        address indexed proxy,
        // indexed：代理地址，前端/索引服务可快速检索
        address indexed implementation,
        // indexed：V1 实现合约地址
        uint256 initialValue
        // 非 indexed：初始化传入的数值，存在 log data 里
    );

    function create(uint256 initialValue) external returns (address proxy, address implementation) {
        // 对外入口：传入初始 value，返回代理与实现两个地址
        // external：供外部账户或其它合约调用

        implementation = address(new BoxV1());
        // 部署 BoxV1 实现合约；new 会在链上创建新合约，返回其地址

        bytes memory initData = abi.encodeCall(BoxV1.initialize, (initialValue));
        // 编码 initialize(initialValue) 的 calldata，供代理构造时 delegatecall 执行

        proxy = address(new ERC1967Proxy(implementation, initData));
        // 部署 ERC1967 代理：构造时把 implementation 写入槽位，并 delegatecall initData 完成初始化

        emit BoxProxyCreated(msg.sender, proxy, implementation, initialValue);
        // 发事件：记录谁创建、代理地址、实现地址、初始值，便于链下索引
    }
}
