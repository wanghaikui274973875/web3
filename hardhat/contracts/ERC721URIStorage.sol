// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev OpenZeppelin v5 已移除 Counters，用 uint256 自增即可。
contract GameItem is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    constructor() ERC721("GameItem", "ITM") Ownable(msg.sender) {}

    function awardItem(address player, string memory tokenURI) public onlyOwner returns (uint256) {
        uint256 newItemId = _nextTokenId;
        _nextTokenId++;
        _mint(player, newItemId);
        _setTokenURI(newItemId, tokenURI);
        return newItemId;
    }
}
