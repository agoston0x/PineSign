// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PineSignResolver} from "../src/PineSignResolver.sol";

contract PineSignResolverTest is Test {
    PineSignResolver r;
    address server = address(0x5E4);
    address stranger = address(0xBAD);

    // namehash("abc.tx.pinesign.eth"), computed the standard way
    bytes32 node;

    function setUp() public {
        r = new PineSignResolver(server);
        node = nh("eth");
        node = keccak256(abi.encodePacked(node, keccak256("pinesign")));
        node = keccak256(abi.encodePacked(node, keccak256("tx")));
        node = keccak256(abi.encodePacked(node, keccak256("abc")));
    }

    function nh(string memory label) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(bytes32(0), keccak256(bytes(label))));
    }

    function test_operatorWrites_anyoneReads() public {
        vm.prank(server);
        r.setText(node, "sender", "alice.pinesign.eth");
        assertEq(r.text(node, "sender"), "alice.pinesign.eth");
    }

    function test_strangerCannotWrite() public {
        vm.prank(stranger);
        vm.expectRevert(PineSignResolver.NotOperator.selector);
        r.setText(node, "sender", "mallory");
    }

    function test_finalizeFreezes() public {
        string[] memory k = new string[](2);
        string[] memory v = new string[](2);
        k[0] = "recipient"; v[0] = "bob.pinesign.eth";
        k[1] = "delivered"; v[1] = "1";

        vm.startPrank(server);
        r.finalize(node, k, v);
        assertTrue(r.frozen(node));
        assertEq(r.text(node, "delivered"), "1");

        // Even the operator cannot amend a receipt afterwards.
        vm.expectRevert(PineSignResolver.NodeFrozen.selector);
        r.setText(node, "delivered", "0");
        vm.stopPrank();
    }

    /// The wildcard path: the DNS-encoded name must hash to the same node.
    function test_wildcardResolveMatchesNamehash() public {
        vm.prank(server);
        r.setText(node, "swarm", "51090af4");

        // "\x03abc\x02tx\x08pinesign\x03eth\x00"
        bytes memory dns = hex"03616263" hex"027478" hex"0870696e657369676e" hex"03657468" hex"00";
        assertEq(r.namehash(dns, 0), node, "dns encoding hashes to the node");

        bytes memory inner = abi.encodeWithSelector(r.text.selector, node, "swarm");
        bytes memory out = r.resolve(dns, inner);
        assertEq(abi.decode(out, (string)), "51090af4");
    }

    function test_setTextsWritesAllAtOnce() public {
        string[] memory k = new string[](3);
        string[] memory v = new string[](3);
        k[0] = "a"; v[0] = "1"; k[1] = "b"; v[1] = "2"; k[2] = "c"; v[2] = "3";
        vm.prank(server);
        r.setTexts(node, k, v);
        assertEq(r.text(node, "a"), "1");
        assertEq(r.text(node, "c"), "3");
        assertFalse(r.frozen(node), "setTexts does not freeze");
    }

    function test_supportsWildcardInterface() public view {
        assertTrue(r.supportsInterface(0x9061b923));
        assertTrue(r.supportsInterface(0x59d1d43c));
    }
}
