// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title SimpleStorage
 * @dev 链上存储单个 uint256；通过 getNum 读取、setNum 写入。
 *
 * 安全说明（有意设计）：`setNum` 无访问控制，任意账户均可覆盖 `num`，仅适用于教学/演示「公开可写状态」。
 * 生产环境若需单管理员或白名单写入，应使用 OpenZeppelin `Ownable`/`AccessControl` 等模式。
 */
contract SimpleStorage {
    uint256 private num;

    event NumUpdated(uint256 newValue);

    function getNum() external view returns (uint256) {
        return num;
    }

    function setNum(uint256 _num) external {
        num = _num;
        emit NumUpdated(_num);
    }
}
