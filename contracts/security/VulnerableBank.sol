// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title VulnerableBank
 * @dev 教学用脆弱合约：演示重入漏洞。生产环境严禁使用。
 *      `withdraw` 故意把外部 call 放在 balances 置零之前，使攻击者可在 receive 回调中再次 withdraw。
 */
contract VulnerableBank {
    mapping(address => uint256) public balances;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
    }

    function withdraw() external {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "no balance");

        // BAD：外部调用在状态更新之前 —— 经典重入入口
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send fail");

        balances[msg.sender] = 0;
    }

    receive() external payable {}
}
