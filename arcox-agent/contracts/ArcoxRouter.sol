// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
}

interface ITokenMessengerV2 {
    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external;
}

contract ArcoxRouter {
    address public owner;
    address public treasury;
    uint16 public feeBps;
    address public immutable usdc;
    address public immutable tokenMessenger;
    uint32 public immutable localDomain;

    mapping(address => bool) public supportedTokens;
    mapping(uint32 => bool) public supportedDestinationDomains;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event TreasuryUpdated(address indexed treasury);
    event FeeUpdated(uint16 feeBps);
    event TokenSupportUpdated(address indexed token, bool supported);
    event DestinationDomainUpdated(uint32 indexed domain, bool supported);
    event SendWithFee(address indexed payer, address indexed token, address indexed to, uint256 amount, uint256 fee);
    event BridgeWithFee(address indexed payer, uint32 indexed destinationDomain, bytes32 mintRecipient, uint256 amount, uint256 fee);

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    constructor(
        address initialOwner,
        address initialTreasury,
        address usdc_,
        address tokenMessenger_,
        uint32 localDomain_,
        uint16 feeBps_
    ) {
        require(initialOwner != address(0), "BAD_OWNER");
        require(initialTreasury != address(0), "BAD_TREASURY");
        require(usdc_ != address(0), "BAD_USDC");
        require(tokenMessenger_ != address(0), "BAD_MESSENGER");
        require(feeBps_ <= 1_000, "FEE_TOO_HIGH");
        owner = initialOwner;
        treasury = initialTreasury;
        usdc = usdc_;
        tokenMessenger = tokenMessenger_;
        localDomain = localDomain_;
        feeBps = feeBps_;
        supportedTokens[usdc_] = true;
        emit OwnershipTransferred(address(0), initialOwner);
        emit TreasuryUpdated(initialTreasury);
        emit FeeUpdated(feeBps_);
        emit TokenSupportUpdated(usdc_, true);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "BAD_OWNER");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function setTreasury(address nextTreasury) external onlyOwner {
        require(nextTreasury != address(0), "BAD_TREASURY");
        treasury = nextTreasury;
        emit TreasuryUpdated(nextTreasury);
    }

    function setFeeBps(uint16 nextFeeBps) external onlyOwner {
        require(nextFeeBps <= 1_000, "FEE_TOO_HIGH");
        feeBps = nextFeeBps;
        emit FeeUpdated(nextFeeBps);
    }

    function setSupportedToken(address token, bool supported) external onlyOwner {
        require(token != address(0), "BAD_TOKEN");
        supportedTokens[token] = supported;
        emit TokenSupportUpdated(token, supported);
    }

    function setSupportedDestinationDomain(uint32 domain, bool supported) external onlyOwner {
        supportedDestinationDomains[domain] = supported;
        emit DestinationDomainUpdated(domain, supported);
    }

    function quoteFee(uint256 amount) public view returns (uint256 fee, uint256 netAmount) {
        fee = (amount * feeBps) / 10_000;
        netAmount = amount - fee;
    }

    function sendTokenWithFee(address token, address to, uint256 amount) external returns (uint256 fee, uint256 netAmount) {
        require(supportedTokens[token], "TOKEN_NOT_SUPPORTED");
        require(to != address(0), "BAD_TO");
        require(amount > 0, "BAD_AMOUNT");
        (fee, netAmount) = quoteFee(amount);
        require(netAmount > 0, "NET_ZERO");
        _pull(token, msg.sender, amount);
        if (fee > 0) _push(token, treasury, fee);
        _push(token, to, netAmount);
        emit SendWithFee(msg.sender, token, to, amount, fee);
    }

    function bridgeUsdcWithFee(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external returns (uint256 fee, uint256 netAmount) {
        require(supportedDestinationDomains[destinationDomain], "DOMAIN_NOT_SUPPORTED");
        require(destinationDomain != localDomain, "SAME_DOMAIN");
        require(mintRecipient != bytes32(0), "BAD_RECIPIENT");
        require(amount > 0, "BAD_AMOUNT");
        (fee, netAmount) = quoteFee(amount);
        require(netAmount > 0, "NET_ZERO");
        _pull(usdc, msg.sender, amount);
        if (fee > 0) _push(usdc, treasury, fee);
        _forceApprove(usdc, tokenMessenger, 0);
        _forceApprove(usdc, tokenMessenger, netAmount);
        ITokenMessengerV2(tokenMessenger).depositForBurn(
            netAmount,
            destinationDomain,
            mintRecipient,
            usdc,
            destinationCaller,
            maxFee,
            minFinalityThreshold
        );
        emit BridgeWithFee(msg.sender, destinationDomain, mintRecipient, amount, fee);
    }

    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        require(to != address(0), "BAD_TO");
        _push(token, to, amount);
    }

    function _pull(address token, address from, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FROM_FAILED");
    }

    function _push(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "TRANSFER_FAILED");
    }

    function _forceApprove(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "APPROVE_FAILED");
    }
}
