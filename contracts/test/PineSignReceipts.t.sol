// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PineSignReceipts} from "../src/PineSignReceipts.sol";

contract PineSignReceiptsTest is Test {
    PineSignReceipts receipts;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address eve = address(0xE7E);

    bytes32 plaintextHash = keccak256("the file");
    bytes32 commitment = keccak256(abi.encode(keccak256("the file")));
    bytes32 swarmRef = keccak256("swarm-reference");

    function setUp() public {
        receipts = new PineSignReceipts();
    }

    function _send() internal returns (bytes32 id) {
        vm.prank(alice);
        id = receipts.send(bob, commitment, swarmRef);
    }

    function test_sendThenClaim() public {
        bytes32 id = _send();
        assertFalse(receipts.isDelivered(id));

        vm.prank(bob);
        receipts.claim(id, plaintextHash);

        assertTrue(receipts.isDelivered(id));
        (,,,, bytes32 revealed,,) = receipts.transfers(id);
        assertEq(revealed, plaintextHash, "claim reveals the plaintext hash");
    }

    function test_idIsDerivedFromTheTransfer() public {
        bytes32 id = _send();
        assertEq(id, receipts.transferId(alice, bob, commitment));
    }

    function test_onlyRecipientCanClaim() public {
        bytes32 id = _send();
        vm.prank(eve);
        vm.expectRevert(PineSignReceipts.NotRecipient.selector);
        receipts.claim(id, plaintextHash);
    }

    /// The point of the commitment: the hash is not public until the recipient
    /// reveals it, so claiming requires actually having decrypted the file.
    function test_claimRequiresThePreimage() public {
        bytes32 id = _send();
        vm.prank(bob);
        vm.expectRevert(PineSignReceipts.BadPreimage.selector);
        receipts.claim(id, keccak256("a guess"));
    }

    function test_claimIsWriteOnce() public {
        bytes32 id = _send();
        vm.startPrank(bob);
        receipts.claim(id, plaintextHash);
        vm.expectRevert(PineSignReceipts.AlreadyClaimed.selector);
        receipts.claim(id, plaintextHash);
        vm.stopPrank();
    }

    function test_sendIsWriteOnce() public {
        _send();
        vm.prank(alice);
        vm.expectRevert(PineSignReceipts.AlreadySent.selector);
        receipts.send(bob, commitment, swarmRef);
    }

    function test_cannotClaimUnknownTransfer() public {
        vm.prank(bob);
        vm.expectRevert(PineSignReceipts.UnknownTransfer.selector);
        receipts.claim(keccak256("nothing"), plaintextHash);
    }

    /// Nobody can occupy an id they could not have constructed.
    function testFuzz_idsAreUniquePerTransfer(address s, address r, bytes32 c) public view {
        vm.assume(s != alice || r != bob || c != commitment);
        assertTrue(receipts.transferId(s, r, c) != receipts.transferId(alice, bob, commitment));
    }
}
