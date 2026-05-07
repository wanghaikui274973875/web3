// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title MemoStorage
 * @dev 每个地址拥有独立备忘录：仅本人可写入/更新/删除；任何人可读任意地址的备忘录。
 */
contract MemoStorage {
    mapping(address => string) private _memo;

    event MemoUpdated(address indexed author, string content);
    event MemoDeleted(address indexed author);

    function getMemo(address account) external view returns (string memory) {
        return _memo[account];
    }

    /** 当前调用者设置或覆盖自己的备忘录 */
    function setMyMemo(string calldata content) external {
        _memo[msg.sender] = content;
        emit MemoUpdated(msg.sender, content);
    }

    /** 仅本人可删除自己的备忘录 */
    function deleteMyMemo() external {
        delete _memo[msg.sender];
        emit MemoDeleted(msg.sender);
    }
}
