// SPDX-License-Identifier: MIT
// 开源许可证 MIT
pragma solidity ^0.8.30;
// Solidity 编译器版本

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// OpenZeppelin 标准 ERC20 实现

import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
// 扩展：持有者销毁自己的代币

import {ERC20Pausable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol";
// 扩展：紧急暂停一切转账

import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
// 扩展：EIP-2612 链下签名授权

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
// 单 owner 权限（pause / unpause）

/// @title SampleERC20
/// @notice 生产级固定总量 ERC20：Permit + 可销毁 + 可暂停，部署时一次性 mint。
/// @dev 无增发接口；maxSupply 等于 constructor 传入的 totalSupply_。
contract SampleERC20 is ERC20, ERC20Burnable, ERC20Pausable, ERC20Permit, Ownable {
    // 继承：核心 ERC20 + 三大扩展 +  Ownable

    uint8 private immutable _tokenDecimals;
    // 私有不可变：小数位数

    uint256 public immutable maxSupply;
    // 公开不可变：总量硬顶（= 首次 mint）

    /// @dev 自定义错误（省 gas、语义清晰）
    error InvalidDecimals();
    // decimals 参数非法（>18 或 >255）
    error ZeroSupply();
    // 总供应量为 0
    error ExceedsMaxSupply();
    // mint 后总量将超过 maxSupply

    /// @notice 部署代币并将全部供应量 mint 给 msg.sender
    /// @dev owner 初始为部署者；可通过 OpenZeppelin renounceOwnership 放弃管理权
    /// @param name_ ERC20 名称（如 "Sample Token"）
    /// @param symbol_ ERC20 符号（如 "SMPL"）
    /// @param decimals_ 小数位，生产环境建议 0~18
    /// @param totalSupply_ 总发行量（最小单位，如 1e18 表示 1 个代币且 decimals=18）
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 decimals_,
        uint256 totalSupply_
    ) ERC20(name_, symbol_) ERC20Permit(name_) Ownable(msg.sender) {
        // 调用父类：设置名称/符号、Permit 域名、owner=部署者
        if (decimals_ > 18) revert InvalidDecimals();
        // 限制常用精度，避免 DEX/前端兼容问题
        if (decimals_ > type(uint8).max) revert InvalidDecimals();
        // 须能安全 cast 为 uint8
        if (totalSupply_ == 0) revert ZeroSupply();
        // 禁止部署空代币

        _tokenDecimals = uint8(decimals_);
        // 写入 immutable 小数位
        maxSupply = totalSupply_;
        // 硬顶 = 初始供应
        _mint(msg.sender, totalSupply_);
        // 一次性 mint 给部署者，之后无 public mint
    }

    /// @notice 返回代币 decimals
    /// @return 小数位数（部署时固定）
    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
        // 读取 immutable
    }

    /// @notice 暂停所有转账（含 transfer / transferFrom / mint / burn 触发的 _update）
    /// @dev 仅 owner；用于安全事件应急响应
    function pause() external onlyOwner {
        _pause();
        // OpenZeppelin 内部：paused = true
    }

    /// @notice 解除暂停，恢复正常转账
    /// @dev 仅 owner
    function unpause() external onlyOwner {
        _unpause();
        // OpenZeppelin 内部：paused = false
    }

    /// @dev OZ v5 钩子：所有余额变动经此函数；合并 Pausable 与 cap 检查
    /// @param from 发送方（mint 时为 address(0)）
    /// @param to 接收方（burn 时为 address(0)）
    /// @param value 变动数量
    function _update(address from, address to, uint256 value) internal override(ERC20, ERC20Pausable) {
        if (from == address(0) && totalSupply() + value > maxSupply) {
            revert ExceedsMaxSupply();
            // mint 前检查：mint 后总量不得超过 maxSupply
        }
        super._update(from, to, value);
        // 执行转账/mint/burn；若 paused 则 revert
    }
}
