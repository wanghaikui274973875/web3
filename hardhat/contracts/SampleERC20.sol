// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SampleERC20
 * @dev Create a sample ERC20 standard token
 */
contract SampleERC20 is ERC20 {
    uint8 private immutable _tokenDecimals;

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _decimals,
        uint256 _totalSupply
    )
        ERC20(_name, _symbol)
    {
        _tokenDecimals = uint8(_decimals);
        _mint(msg.sender, _totalSupply);
    }

    function decimals() public view override returns (uint8) {
        return _tokenDecimals;
    }
}