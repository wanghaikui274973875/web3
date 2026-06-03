// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {BoxV1} from "./BoxV1.sol";
// 引入 V1：V2 必须继承 V1，保证 storage 布局前若干槽位与 V1 完全一致

/**
 * @title BoxV2
 * @dev 升级后的逻辑合约：保留 V1 存储布局，追加 `label` 与 `increment`。
 *      升级后通过 `reinitializer(2)` 调用 `initializeV2` 初始化新增状态。
 */
contract BoxV2 is BoxV1 {
    // V2 继承 V1：slot0=value、slot1=_owner 顺序不变，升级后旧数据仍可读

    string public label;
    // 新增状态：字符串标签；必须追加在 V1 变量之后，不可插入中间 slot

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // V2 实现合约部署时执行；同样禁止他人直接 initialize 实现地址
        _disableInitializers();
        // 锁定 V2 实现合约本身（不影响已部署的代理）
    }

    function initializeV2(string calldata newLabel) external reinitializer(2) {
        // 升级后的补充初始化；reinitializer(2) 表示版本 2 的初始化步骤，且只能执行一次
        // calldata：只读参数区，string 较大时比 memory 省 gas

        label = newLabel;
        // 写入新字段；仅在升级交易里随 upgradeToAndCall 的 data 一并执行
    }

    function increment() external {
        // V2 新增业务：将 value 加 1
        value += 1;
        // 读写继承自 V1 的 value；经代理 delegatecall 仍操作代理 storage
    }

    function version() external pure override returns (string memory) {
        // 覆盖 V1 的 version；override 表示重写父合约 virtual 函数
        return "V2";
        // 升级完成后前端/测试可通过 version() 判断是否已是 V2
    }
}
