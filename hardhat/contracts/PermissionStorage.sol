// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/**
 * @title PermissionStorage
 * @dev Day16 示例：链上存储「某地址是否被授权」，仅 owner 可改。
 */
contract PermissionStorage {
    address public owner;

    mapping(address => bool) private _allowed;

    event PermissionUpdated(address indexed account, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setPermission(address account, bool allowed) external onlyOwner {
        _allowed[account] = allowed;
        emit PermissionUpdated(account, allowed);
    }

    function getPermission(address account) external view returns (bool) {
        return _allowed[account];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
