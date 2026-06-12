// SPDX-License-Identifier: MIT
// 开源许可证 MIT
pragma solidity ^0.8.30;
// Solidity 编译器版本

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
// OpenZeppelin 标准 ERC20 实现

/// @title WETH
/// @notice 将原生 ETH 包装成 ERC20（WETH），便于 DEX / 借贷等协议统一接口调用。
/// @dev 经典 WETH9 模式：deposit 铸币、withdraw 销币并返还 ETH；总量与合约 ETH 余额 1:1。
contract WETH is ERC20 {
    // 继承 ERC20，名称符号在 constructor 中固定为 Wrapped Ether / WETH

    /// @notice 用户存入 ETH 并铸造等量 WETH 时触发
    /// @param dst 接收 WETH 的地址（deposit 时为 msg.sender）
    /// @param wad 存入数量（wei）
    event Deposit(address indexed dst, uint256 wad);

    /// @notice 用户销毁 WETH 并取回 ETH 时触发
    /// @param src 销毁 WETH 的地址（withdraw 时为 msg.sender）
    /// @param wad 取回数量（wei）
    event Withdrawal(address indexed src, uint256 wad);

    /// @dev 提现 ETH 转账失败（接收方拒绝或 gas 不足等）
    error EthTransferFailed();

    /// @dev 部署 WETH，decimals 固定为 18，与 ETH 最小单位 wei 对齐
    constructor() ERC20("Wrapped Ether", "WETH") {}

    /// @notice 存入 ETH，按 1:1 铸造 WETH 给调用者
    /// @dev payable：msg.value 即存入量；先铸币再 emit，符合 CEI 中「状态变更在前」
    function deposit() public payable {
        _mint(msg.sender, msg.value);
        // 按存入 wei 数量铸造 WETH（1 ETH = 1e18 WETH）
        emit Deposit(msg.sender, msg.value);
        // 记录存款事件，供索引器追踪
    }

    /// @notice 销毁调用者持有的 WETH，并按 1:1 返还等量 ETH
    /// @dev 先 _burn 再转账 ETH，防止重入时重复提现（checks-effects-interactions）
    /// @param wad 要取回的 ETH 数量（wei），须不超过 balanceOf(msg.sender)
    function withdraw(uint256 wad) public {
        _burn(msg.sender, wad);
        // 先销毁 WETH，扣减余额与 totalSupply
        (bool ok, ) = payable(msg.sender).call{value: wad}("");
        // 用 call 发送 ETH（比 transfer 兼容合约接收方）
        if (!ok) revert EthTransferFailed();
        // 转账失败则回滚整笔交易
        emit Withdrawal(msg.sender, wad);
        // 记录提现事件
    }

    /// @notice 直接向合约发送 ETH 时，自动走 deposit 逻辑
    /// @dev 等价于 deposit()，铸造 WETH 给 msg.sender
    receive() external payable {
        deposit();
        // 裸转 ETH 也会得到 WETH，避免资金锁死
    }
}
