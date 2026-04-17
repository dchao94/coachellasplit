"use strict";

const assert = require("assert");
const {
  GroupExpenseService,
  buildEqualShares
} = require("../src/expense-groups");

function expectDeepEqual(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
}

function runTests() {
  testEqualShareRounding();
  testAllActiveMemberSplitAndSettlement();
  testSelectedMemberSplitAndTransactionEditing();
  testMemberRemovalPreservesHistory();
  testTransactionDeletionRecomputesBalances();
  console.log("All tests passed.");
}

function testEqualShareRounding() {
  expectDeepEqual(
    buildEqualShares(1000, ["a", "b", "c"]),
    { a: 334, b: 333, c: 333 },
    "Remainder cents should be distributed deterministically by sorted participant id."
  );
}

function testAllActiveMemberSplitAndSettlement() {
  const service = new GroupExpenseService();
  service.createGroup({ id: "group-1", name: "Trip" });
  service.addMember("group-1", { id: "alice", name: "Alice" });
  service.addMember("group-1", { id: "bob", name: "Bob" });
  service.addMember("group-1", { id: "carol", name: "Carol" });

  const snapshot = service.createTransaction("group-1", {
    id: "txn-1",
    description: "Dinner",
    totalAmountCents: 6000,
    payerMemberId: "alice",
    transactionDate: "2026-04-16",
    split: {
      type: "EVEN_ALL_ACTIVE_MEMBERS"
    }
  });

  expectDeepEqual(snapshot.transactions["txn-1"].sharesByMemberId, {
    alice: 2000,
    bob: 2000,
    carol: 2000
  });

  expectDeepEqual(snapshot.balancesByMemberId, {
    alice: 4000,
    bob: -2000,
    carol: -2000
  });

  expectDeepEqual(snapshot.settlementSuggestions, [
    { fromMemberId: "bob", toMemberId: "alice", amountCents: 2000 },
    { fromMemberId: "carol", toMemberId: "alice", amountCents: 2000 }
  ]);
}

function testSelectedMemberSplitAndTransactionEditing() {
  const service = new GroupExpenseService();
  service.createGroup({ id: "group-2", name: "Apartment" });
  service.addMember("group-2", { id: "alice", name: "Alice" });
  service.addMember("group-2", { id: "bob", name: "Bob" });
  service.addMember("group-2", { id: "carol", name: "Carol" });

  service.createTransaction("group-2", {
    id: "txn-1",
    description: "Groceries",
    totalAmountCents: 1001,
    payerMemberId: "alice",
    transactionDate: "2026-04-16",
    split: {
      type: "EVEN_SELECTED_MEMBERS",
      memberIds: ["alice", "bob", "carol"]
    }
  });

  const edited = service.editTransaction("group-2", "txn-1", {
    totalAmountCents: 1200,
    split: {
      type: "EVEN_SELECTED_MEMBERS",
      memberIds: ["alice", "bob"]
    }
  });

  expectDeepEqual(edited.transactions["txn-1"].participantMemberIds, ["alice", "bob"]);
  expectDeepEqual(edited.transactions["txn-1"].sharesByMemberId, {
    alice: 600,
    bob: 600
  });

  expectDeepEqual(edited.balancesByMemberId, {
    alice: 600,
    bob: -600,
    carol: 0
  });
}

function testMemberRemovalPreservesHistory() {
  const service = new GroupExpenseService();
  service.createGroup({ id: "group-3", name: "Weekend" });
  service.addMember("group-3", { id: "alice", name: "Alice" });
  service.addMember("group-3", { id: "bob", name: "Bob" });
  service.addMember("group-3", { id: "carol", name: "Carol" });

  service.createTransaction("group-3", {
    id: "txn-1",
    description: "Cab",
    totalAmountCents: 900,
    payerMemberId: "bob",
    transactionDate: "2026-04-16",
    split: {
      type: "EVEN_ALL_ACTIVE_MEMBERS"
    }
  });

  service.removeMember("group-3", "carol");

  const snapshot = service.createTransaction("group-3", {
    id: "txn-2",
    description: "Breakfast",
    totalAmountCents: 1000,
    payerMemberId: "alice",
    transactionDate: "2026-04-17",
    split: {
      type: "EVEN_ALL_ACTIVE_MEMBERS"
    }
  });

  assert.strictEqual(snapshot.members.carol.isActive, false);
  expectDeepEqual(snapshot.transactions["txn-1"].participantMemberIds, ["alice", "bob", "carol"]);
  expectDeepEqual(snapshot.transactions["txn-2"].participantMemberIds, ["alice", "bob"]);
  expectDeepEqual(snapshot.balancesByMemberId, {
    alice: 200,
    bob: 100,
    carol: -300
  });
}

function testTransactionDeletionRecomputesBalances() {
  const service = new GroupExpenseService();
  service.createGroup({ id: "group-4", name: "House" });
  service.addMember("group-4", { id: "alice", name: "Alice" });
  service.addMember("group-4", { id: "bob", name: "Bob" });

  service.createTransaction("group-4", {
    id: "txn-1",
    description: "Utilities",
    totalAmountCents: 5000,
    payerMemberId: "alice",
    transactionDate: "2026-04-16",
    split: {
      type: "EVEN_ALL_ACTIVE_MEMBERS"
    }
  });

  const snapshot = service.deleteTransaction("group-4", "txn-1");
  expectDeepEqual(snapshot.balancesByMemberId, {
    alice: 0,
    bob: 0
  });
  expectDeepEqual(snapshot.settlementSuggestions, []);
}

runTests();
