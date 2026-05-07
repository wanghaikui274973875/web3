// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @dev OpenZeppelin v5 已移除 Counters，用 uint256 自增即可。
contract GameItem is ERC721URIStorage, Ownable {
    uint256 private _nextTokenId;

    constructor() ERC721("GameItem", "ITM") Ownable(msg.sender) {}

    /// @notice 已铸造的 token 数量（下一枚将使用的 id 等于该值；有效 id 为 0 .. totalMinted()-1）
    function totalMinted() external view returns (uint256) {
        return _nextTokenId;
    }

    function _mintWithURI(address to, string memory tokenURI) internal returns (uint256) {
        uint256 id = _nextTokenId;
        _nextTokenId++;
        _mint(to, id);
        _setTokenURI(id, tokenURI);
        return id;
    }

    /// @notice 任意地址可为本人铸造一枚 NFT（需支付 gas）
    function mint(string memory tokenURI) external returns (uint256) {
        return _mintWithURI(msg.sender, tokenURI);
    }

    /// @notice 仅 owner 可为任意地址铸造
    function awardItem(address player, string memory tokenURI) public onlyOwner returns (uint256) {
        return _mintWithURI(player, tokenURI);
    }
}
