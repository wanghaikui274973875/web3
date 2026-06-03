// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoxTransparentV1} from "./BoxTransparentV1.sol";
// 继承 Transparent V1，保持 storage 布局兼容

/**
 * @title BoxTransparentV2
 * @dev Transparent 代理升级后的逻辑合约。
 */
contract BoxTransparentV2 is BoxTransparentV1 {
    // V2 逻辑：替换代理指向的实现地址后，代理 storage 中 V1 数据保留

    string public label;
    // 新增字段：追加在 V1 变量之后，符合可升级 storage 规范

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // V2 实现合约部署时执行
        _disableInitializers();
        // 禁止直接初始化 V2 实现地址
    }

    function initializeV2(string calldata newLabel) external reinitializer(2) {
        // 升级后初始化新状态；版本号 2，仅可执行一次
        label = newLabel;
        // 设置 label 字符串
    }

    function increment() external {
        // V2 新增：value 自增 1
        value += 1;
        // 使用继承自 V1 的 value
    }

    function version() external pure override returns (string memory) {
        // 覆盖版本号
        return "Transparent-V2";
        // 标识已是 Transparent 第二版
    }
}
