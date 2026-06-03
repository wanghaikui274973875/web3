// SPDX-License-Identifier: MIT
// 开源许可证：MIT，允许他人自由使用、修改与分发
pragma solidity ^0.8.30;
// 指定 Solidity 编译器版本（0.8.30 及以上，低于 0.9.0）

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
// 引入 OpenZeppelin 的可初始化基类：代理模式下用 initialize 代替 constructor

import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
// 引入 UUPS 升级基类：升级逻辑写在「实现合约」里，通过 upgradeToAndCall 换实现

/**
 * @title BoxV1
 * @dev UUPS 可升级逻辑合约 V1。部署后须通过代理调用 `initialize`；实现合约自身禁止初始化。
 */
contract BoxV1 is Initializable, UUPSUpgradeable {
    // 合约名 BoxV1；继承 Initializable（初始化保护）与 UUPSUpgradeable（可升级）

    uint256 public value;
    // 状态变量：链上存储的数值；public 会自动生成 getter value()

    address private _owner;
    // 私有变量：记录谁有权升级合约；private 不自动生成外部 getter，下面用 owner() 暴露

    error NotOwner();
    // 自定义错误：当非 owner 尝试升级时 revert，比 require 字符串更省 gas

    /// @custom:oz-upgrades-unsafe-allow constructor
    // OpenZeppelin 升级插件注解：允许在可升级合约里写 constructor（通常用于 _disableInitializers）

    constructor() {
        // 构造函数：仅在「实现合约」部署时执行一次，不会写入代理的 storage
        _disableInitializers();
        // 锁定实现合约本身，防止攻击者直接对实现地址调用 initialize 劫持逻辑
    }

    function initialize(uint256 initialValue) external initializer {
        // 初始化函数：代替 constructor；initializer 修饰符保证全局只能成功调用一次
        // external：仅从外部调用；参数 initialValue 为初始 value

        _owner = msg.sender;
        // 将调用者记为 owner；经代理 delegatecall 时 msg.sender 是发起交易的用户/工厂

        value = initialValue;
        // 写入初始数值到代理的 storage（delegatecall 时改的是代理槽位，不是实现合约）
    }

    function setValue(uint256 newValue) external {
        // 业务函数：修改 value；external 表示从外部（含代理转发）调用
        value = newValue;
        // 更新状态变量；经代理调用时修改的是代理 storage 里的 value
    }

    function owner() external view returns (address) {
        // 只读函数：返回当前 owner 地址；view 不修改状态
        return _owner;
        // 返回私有变量 _owner
    }

    function version() external pure virtual returns (string memory) {
        // 返回版本标识；pure 不读链上状态；virtual 供 V2 override
        return "V1";
        // 字符串常量，表示当前逻辑版本
    }

    function _authorizeUpgrade(address) internal view override {
        // UUPS 内部钩子：每次 upgradeToAndCall 前调用；override 实现父类抽象逻辑
        // 参数 newImplementation 此处未使用，故不写名字

        if (msg.sender != _owner) revert NotOwner();
        // 仅 owner 可发起升级；否则抛 NotOwner 错误
    }
}
