// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
// 可初始化基类：Transparent 实现合约同样用 initialize 而非 constructor 写 storage

/**
 * @title BoxTransparentV1
 * @dev Transparent 代理的逻辑合约 V1：升级由 ProxyAdmin 触发，实现层不含 UUPS 升级入口。
 */
contract BoxTransparentV1 is Initializable {
    // 仅继承 Initializable，不继承 UUPSUpgradeable
    // Transparent 模式下升级在 ProxyAdmin + 代理层完成，实现合约保持「纯业务」

    uint256 public value;
    // 与 BoxV1 相同的第一个状态槽：数值存储

    address private _owner;
    // 第二个状态槽：业务 owner（注意：升级权限在 ProxyAdmin owner，可与 _owner 相同或不同）

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // 实现合约构造函数
        _disableInitializers();
        // 防止攻击者直接对实现地址 initialize
    }

    function initialize(uint256 initialValue) external initializer {
        // 代理部署后首次初始化；只能成功调用一次
        _owner = msg.sender;
        // 记录初始化调用者为业务 owner
        value = initialValue;
        // 设置初始 value
    }

    function setValue(uint256 newValue) external {
        // 修改 value 的业务函数
        value = newValue;
        // 写入新值到代理 storage
    }

    function owner() external view returns (address) {
        // 查询业务 owner
        return _owner;
        // 返回 _owner
    }

    function version() external pure virtual returns (string memory) {
        // 版本标识，供 V2 覆盖
        return "Transparent-V1";
        // 与 UUPS 的 "V1" 区分，便于前端判断是哪种代理体系
    }
}
