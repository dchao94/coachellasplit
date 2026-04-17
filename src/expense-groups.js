"use strict";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeMoneyCents(amountCents) {
  assert(Number.isInteger(amountCents), "Money amounts must be stored as integer cents.");
  return amountCents;
}

function getMemberOrThrow(group, memberId) {
  const member = group.members[memberId];
  assert(member, `Member "${memberId}" does not exist in group "${group.id}".`);
  return member;
}

function determineParticipantIds(group, split) {
  if (split.type === "EVEN_ALL_ACTIVE_MEMBERS") {
    return sortStrings(
      Object.values(group.members)
        .filter((member) => member.isActive)
        .map((member) => member.id)
    );
  }

  if (split.type === "EVEN_SELECTED_MEMBERS") {
    assert(
      Array.isArray(split.memberIds) && split.memberIds.length > 0,
      "Selected-member splits require at least one participant."
    );

    const uniqueIds = new Set(split.memberIds);
    assert(
      uniqueIds.size === split.memberIds.length,
      "Selected-member splits cannot contain duplicate participants."
    );

    return sortStrings(
      split.memberIds.map((memberId) => {
        getMemberOrThrow(group, memberId);
        return memberId;
      })
    );
  }

  throw new Error(`Unsupported split type "${split.type}".`);
}

function buildEqualShares(amountCents, participantIds) {
  assert(participantIds.length > 0, "Transactions require at least one participant.");

  const baseShare = Math.floor(amountCents / participantIds.length);
  const remainder = amountCents % participantIds.length;
  const shares = {};

  participantIds.forEach((memberId, index) => {
    shares[memberId] = baseShare + (index < remainder ? 1 : 0);
  });

  return shares;
}

function buildTransactionLedgerEntry(group, input) {
  const amountCents = normalizeMoneyCents(input.totalAmountCents);
  assert(amountCents > 0, "Transaction amount must be greater than zero.");
  getMemberOrThrow(group, input.payerMemberId);

  const participantIds = determineParticipantIds(group, input.split);
  const sharesByMemberId = buildEqualShares(amountCents, participantIds);

  return {
    id: input.id,
    description: input.description,
    totalAmountCents: amountCents,
    payerMemberId: input.payerMemberId,
    transactionDate: input.transactionDate,
    split: clone(input.split),
    participantMemberIds: participantIds,
    sharesByMemberId
  };
}

function calculateTransactionEffects(transaction) {
  const effectsByMemberId = {};
  effectsByMemberId[transaction.payerMemberId] = transaction.totalAmountCents;

  transaction.participantMemberIds.forEach((memberId) => {
    effectsByMemberId[memberId] = (effectsByMemberId[memberId] || 0) - transaction.sharesByMemberId[memberId];
  });

  return effectsByMemberId;
}

function calculateGroupBalances(group) {
  const balancesByMemberId = {};

  Object.keys(group.members).forEach((memberId) => {
    balancesByMemberId[memberId] = 0;
  });

  Object.values(group.transactions).forEach((transaction) => {
    const effectsByMemberId = calculateTransactionEffects(transaction);

    Object.entries(effectsByMemberId).forEach(([memberId, amountCents]) => {
      balancesByMemberId[memberId] = (balancesByMemberId[memberId] || 0) + amountCents;
    });
  });

  return balancesByMemberId;
}

function buildSettlementSuggestions(balancesByMemberId) {
  const creditors = [];
  const debtors = [];

  Object.entries(balancesByMemberId).forEach(([memberId, amountCents]) => {
    if (amountCents > 0) {
      creditors.push({ memberId, remainingCents: amountCents });
    } else if (amountCents < 0) {
      debtors.push({ memberId, remainingCents: -amountCents });
    }
  });

  creditors.sort((left, right) => {
    if (right.remainingCents !== left.remainingCents) {
      return right.remainingCents - left.remainingCents;
    }

    return left.memberId.localeCompare(right.memberId);
  });

  debtors.sort((left, right) => {
    if (right.remainingCents !== left.remainingCents) {
      return right.remainingCents - left.remainingCents;
    }

    return left.memberId.localeCompare(right.memberId);
  });

  const settlements = [];
  let creditorIndex = 0;
  let debtorIndex = 0;

  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex];
    const debtor = debtors[debtorIndex];
    const amountCents = Math.min(creditor.remainingCents, debtor.remainingCents);

    settlements.push({
      fromMemberId: debtor.memberId,
      toMemberId: creditor.memberId,
      amountCents
    });

    creditor.remainingCents -= amountCents;
    debtor.remainingCents -= amountCents;

    if (creditor.remainingCents === 0) {
      creditorIndex += 1;
    }

    if (debtor.remainingCents === 0) {
      debtorIndex += 1;
    }
  }

  return settlements;
}

class GroupExpenseService {
  constructor() {
    this.groups = {};
  }

  createGroup({ id, name }) {
    assert(id, "Group id is required.");
    assert(name, "Group name is required.");
    assert(!this.groups[id], `Group "${id}" already exists.`);

    const group = {
      id,
      name,
      members: {},
      transactions: {}
    };

    this.groups[id] = group;
    return this.getGroupSnapshot(id);
  }

  addMember(groupId, { id, name }) {
    const group = this.#getGroup(groupId);
    assert(id, "Member id is required.");
    assert(name, "Member name is required.");
    assert(!group.members[id], `Member "${id}" already exists in group "${groupId}".`);

    group.members[id] = {
      id,
      name,
      isActive: true
    };

    return this.getGroupSnapshot(groupId);
  }

  removeMember(groupId, memberId) {
    const group = this.#getGroup(groupId);
    const member = getMemberOrThrow(group, memberId);
    member.isActive = false;
    return this.getGroupSnapshot(groupId);
  }

  createTransaction(groupId, input) {
    const group = this.#getGroup(groupId);
    assert(input.id, "Transaction id is required.");
    assert(!group.transactions[input.id], `Transaction "${input.id}" already exists.`);

    group.transactions[input.id] = buildTransactionLedgerEntry(group, input);
    return this.getGroupSnapshot(groupId);
  }

  editTransaction(groupId, transactionId, updates) {
    const group = this.#getGroup(groupId);
    const current = group.transactions[transactionId];
    assert(current, `Transaction "${transactionId}" does not exist.`);

    group.transactions[transactionId] = buildTransactionLedgerEntry(group, {
      ...current,
      ...clone(updates),
      id: transactionId
    });

    return this.getGroupSnapshot(groupId);
  }

  deleteTransaction(groupId, transactionId) {
    const group = this.#getGroup(groupId);
    assert(group.transactions[transactionId], `Transaction "${transactionId}" does not exist.`);
    delete group.transactions[transactionId];
    return this.getGroupSnapshot(groupId);
  }

  getGroupSnapshot(groupId) {
    const group = this.#getGroup(groupId);
    const balancesByMemberId = calculateGroupBalances(group);
    const settlementSuggestions = buildSettlementSuggestions(balancesByMemberId);

    return {
      ...clone(group),
      balancesByMemberId,
      settlementSuggestions
    };
  }

  #getGroup(groupId) {
    const group = this.groups[groupId];
    assert(group, `Group "${groupId}" does not exist.`);
    return group;
  }
}

const exportedApi = {
  GroupExpenseService,
  buildEqualShares,
  buildSettlementSuggestions,
  calculateGroupBalances,
  calculateTransactionEffects
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = exportedApi;
}

if (typeof window !== "undefined") {
  window.ExpenseGroups = exportedApi;
}
