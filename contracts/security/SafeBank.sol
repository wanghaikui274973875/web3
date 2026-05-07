// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title SafeBank
 * @dev 演示 VulnerableBank 的修复版本：OpenZeppelin ReentrancyGuard + CEI（Checks-Effects-Interactions）。
 *      - Checks：require 余额 > 0
 *      - Effects：先把 balances 置零（重入时再次 withdraw 无法取到正数 amount）
 *      - Interactions：再做外部 call 转 ETH
 *      `nonReentrant` 为纵深防御：若将来有人误把状态更新挪到 call 之后，仍可阻断重入。
 */
contract SafeBank is ReentrancyGuard {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external nonReentrant {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "no balance");

        balances[msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send fail");
    }

    receive() external payable {}
}
