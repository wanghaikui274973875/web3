// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title SimpleStorage
 * @dev 链上存储单个 uint256；通过 getNum 读取、setNum 写入。
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
