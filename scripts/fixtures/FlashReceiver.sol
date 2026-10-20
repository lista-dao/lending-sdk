// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
}

/**
 * Minimal flash-loan counterparty for the fork harness.
 *
 * Moolah sends the loan to `msg.sender` and calls back on it, so a flash loan
 * cannot be initiated by an EOA at all. `execute` forwards the SDK's calldata
 * verbatim from inside a contract, so what runs is exactly what the builder
 * produced; `onMoolahFlashLoan` approves the repayment.
 */
contract FlashReceiver {
    event Received(uint256 assets);

    function execute(address target, bytes calldata data) external {
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    function onMoolahFlashLoan(uint256 assets, bytes calldata data) external {
        address token = abi.decode(data, (address));
        IERC20(token).approve(msg.sender, assets);
        emit Received(assets);
    }
}
