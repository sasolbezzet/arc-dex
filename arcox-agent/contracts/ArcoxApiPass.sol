// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ArcoxApiPass {
    error Soulbound();
    error Unauthorized();
    error InvalidOwner();
    error TokenNotFound();
    error ApiKeyAlreadyBound();

    string public constant name = "ARCOX API Pass";
    string public constant symbol = "ARX-PASS";

    uint256 private _nextTokenId = 1;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => bytes32) private _apiKeyHashes;
    mapping(uint256 => string) private _tokenUris;
    mapping(bytes32 => uint256) public tokenIdByApiKeyHash;
    mapping(uint256 => mapping(address => bool)) private _sessionDelegates;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Locked(uint256 tokenId);
    event ApiPassMinted(address indexed owner, uint256 indexed tokenId, bytes32 indexed apiKeyIdHash);
    event ApiPassBurned(address indexed owner, uint256 indexed tokenId, bytes32 indexed apiKeyIdHash);
    event SessionDelegateUpdated(uint256 indexed tokenId, address indexed delegate, bool allowed);

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 || interfaceId == 0x80ac58cd || interfaceId == 0x5b5e139f || interfaceId == 0xb45a3c0e;
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert InvalidOwner();
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) public view returns (address owner) {
        owner = _owners[tokenId];
        if (owner == address(0)) revert TokenNotFound();
    }

    function tokenURI(uint256 tokenId) external view returns (string memory) {
        ownerOf(tokenId);
        return _tokenUris[tokenId];
    }

    function locked(uint256 tokenId) external view returns (bool) {
        ownerOf(tokenId);
        return true;
    }

    function mintApiPass(address owner, bytes32 apiKeyIdHash, string calldata metadataURI) external returns (uint256 tokenId) {
        if (owner == address(0) || msg.sender != owner) revert Unauthorized();
        if (tokenIdByApiKeyHash[apiKeyIdHash] != 0) revert ApiKeyAlreadyBound();
        tokenId = _nextTokenId++;
        _owners[tokenId] = owner;
        _balances[owner] += 1;
        _apiKeyHashes[tokenId] = apiKeyIdHash;
        _tokenUris[tokenId] = metadataURI;
        tokenIdByApiKeyHash[apiKeyIdHash] = tokenId;
        emit Transfer(address(0), owner, tokenId);
        emit Locked(tokenId);
        emit ApiPassMinted(owner, tokenId, apiKeyIdHash);
    }

    function burnApiPass(uint256 tokenId) external {
        address owner = ownerOf(tokenId);
        if (msg.sender != owner) revert Unauthorized();
        bytes32 apiKeyIdHash = _apiKeyHashes[tokenId];
        delete _owners[tokenId];
        delete _apiKeyHashes[tokenId];
        delete _tokenUris[tokenId];
        delete tokenIdByApiKeyHash[apiKeyIdHash];
        _balances[owner] -= 1;
        emit Transfer(owner, address(0), tokenId);
        emit ApiPassBurned(owner, tokenId, apiKeyIdHash);
    }

    function getApiPass(uint256 tokenId) external view returns (address owner, bytes32 apiKeyIdHash, string memory metadataURI, bool exists) {
        owner = _owners[tokenId];
        return (owner, _apiKeyHashes[tokenId], _tokenUris[tokenId], owner != address(0));
    }

    function setSessionDelegate(uint256 tokenId, address delegate, bool allowed) external {
        if (msg.sender != ownerOf(tokenId) || delegate == address(0)) revert Unauthorized();
        _sessionDelegates[tokenId][delegate] = allowed;
        emit SessionDelegateUpdated(tokenId, delegate, allowed);
    }

    function isSessionDelegate(uint256 tokenId, address delegate) external view returns (bool) {
        ownerOf(tokenId);
        return _sessionDelegates[tokenId][delegate];
    }

    function approve(address, uint256) external pure { revert Soulbound(); }
    function setApprovalForAll(address, bool) external pure { revert Soulbound(); }
    function getApproved(uint256 tokenId) external view returns (address) { ownerOf(tokenId); return address(0); }
    function isApprovedForAll(address, address) external pure returns (bool) { return false; }
    function transferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256) external pure { revert Soulbound(); }
    function safeTransferFrom(address, address, uint256, bytes calldata) external pure { revert Soulbound(); }
}
