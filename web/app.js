"use strict";

(function bootstrap() {
  const elements = {
    groupView: document.getElementById("group-view"),
    groupTitle: document.getElementById("group-title"),
    memberCount: document.getElementById("member-count"),
    transactionCount: document.getElementById("transaction-count"),
    memberForm: document.getElementById("member-form"),
    memberNameInput: document.getElementById("member-name-input"),
    memberList: document.getElementById("member-list"),
    balanceList: document.getElementById("balance-list"),
    settlementList: document.getElementById("settlement-list"),
    transactionList: document.getElementById("transaction-list"),
    transactionForm: document.getElementById("transaction-form"),
    transactionFormTitle: document.getElementById("transaction-form-title"),
    transactionDescription: document.getElementById("transaction-description"),
    transactionAmount: document.getElementById("transaction-amount"),
    transactionPayer: document.getElementById("transaction-payer"),
    transactionDate: document.getElementById("transaction-date"),
    transactionSplitType: document.getElementById("transaction-split-type"),
    participantFieldset: document.getElementById("participant-fieldset"),
    participantCheckboxes: document.getElementById("participant-checkboxes"),
    transactionSubmitButton: document.getElementById("transaction-submit-button"),
    transactionCancelButton: document.getElementById("transaction-cancel-button")
  };

  const state = {
    group: null,
    editingTransactionId: null
  };

  attachEvents();
  refreshState();
  window.setInterval(refreshState, 10000);

  function attachEvents() {
    elements.memberForm.addEventListener("submit", handleMemberCreate);
    elements.transactionForm.addEventListener("submit", handleTransactionSubmit);
    elements.transactionSplitType.addEventListener("change", () => {
      renderParticipantSelector();
    });
    elements.transactionCancelButton.addEventListener("click", resetTransactionForm);
  }

  async function refreshState() {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const payload = await response.json();
      state.group = payload.group || null;
      render();
    } catch (error) {
      console.error(error);
    }
  }

  function render() {
    const snapshot = getSelectedGroupSnapshot();
    if (!snapshot) {
      return;
    }

    renderSummary(snapshot);
    renderMembers(snapshot);
    renderBalances(snapshot);
    renderSettlements(snapshot);
    renderTransactionForm(snapshot);
    renderTransactions(snapshot);
  }

  function renderSummary(snapshot) {
    const members = Object.values(snapshot.members);

    elements.groupTitle.textContent = snapshot.name;
    elements.memberCount.textContent = String(members.length);
    elements.transactionCount.textContent = String(Object.keys(snapshot.transactions).length);
  }

  function renderMembers(snapshot) {
    elements.memberList.innerHTML = "";

    const members = Object.values(snapshot.members).sort((left, right) => left.name.localeCompare(right.name));
    if (members.length === 0) {
      elements.memberList.innerHTML = "<p class='muted'>Add at least one member to get started.</p>";
      return;
    }

    members.forEach((member) => {
      const card = document.createElement("div");
      card.className = `member-card${member.isActive ? "" : " inactive"}`;

      const actions = member.isActive
        ? `<button type="button" class="secondary" data-action="deactivate" data-member-id="${member.id}">Remove from active group</button>`
        : "";

      card.innerHTML = `
        <div class="member-meta">
          <div>
            <strong>${escapeHtml(member.name)}</strong>
            <div class="muted">${escapeHtml(member.id)}</div>
          </div>
          <span class="pill ${member.isActive ? "active" : "inactive"}">${member.isActive ? "Active" : "Inactive"}</span>
        </div>
        <div class="transaction-actions">${actions}</div>
      `;

      const actionButton = card.querySelector("[data-action='deactivate']");
      if (actionButton) {
        actionButton.addEventListener("click", () => {
          apiPost(`/api/groups/${encodeURIComponent(snapshot.id)}/members/${encodeURIComponent(member.id)}/deactivate`).then(refreshState);
        });
      }

      elements.memberList.appendChild(card);
    });
  }

  function renderBalances(snapshot) {
    elements.balanceList.innerHTML = "";

    const entries = Object.entries(snapshot.balancesByMemberId).sort((left, right) => {
      const delta = right[1] - left[1];
      return delta !== 0 ? delta : left[0].localeCompare(right[0]);
    });

    if (entries.length === 0) {
      elements.balanceList.innerHTML = "<p class='muted'>No balances yet.</p>";
      return;
    }

    entries.forEach(([memberId, amountCents]) => {
      const member = snapshot.members[memberId];
      const card = document.createElement("div");
      card.className = "balance-card";
      card.innerHTML = `
        <div class="member-meta">
          <div>
            <strong>${escapeHtml(member.name)}</strong>
            <div class="muted">${amountCents > 0 ? "Should receive" : amountCents < 0 ? "Owes" : "Settled"}</div>
          </div>
          <strong class="${amountCents > 0 ? "money-positive" : amountCents < 0 ? "money-negative" : ""}">${formatCurrency(amountCents)}</strong>
        </div>
      `;
      elements.balanceList.appendChild(card);
    });
  }

  function renderSettlements(snapshot) {
    elements.settlementList.innerHTML = "";

    if (snapshot.settlementSuggestions.length === 0) {
      elements.settlementList.innerHTML = "<p class='muted'>Everyone is settled up.</p>";
      return;
    }

    snapshot.settlementSuggestions.forEach((settlement) => {
      const card = document.createElement("div");
      card.className = "settlement-card";
      card.innerHTML = `
        <strong>${escapeHtml(snapshot.members[settlement.fromMemberId].name)}</strong>
        <span class="muted">pays</span>
        <strong>${escapeHtml(snapshot.members[settlement.toMemberId].name)}</strong>
        <span class="money-positive">${formatCurrency(settlement.amountCents)}</span>
      `;
      elements.settlementList.appendChild(card);
    });
  }

  function renderTransactionForm(snapshot) {
    populatePayerOptions(snapshot);
    renderParticipantSelector(snapshot);

    if (!state.editingTransactionId) {
      elements.transactionFormTitle.textContent = "Add Transaction";
      elements.transactionSubmitButton.textContent = "Save Transaction";
      elements.transactionCancelButton.classList.add("hidden");
      if (!elements.transactionDate.value) {
        elements.transactionDate.value = new Date().toISOString().slice(0, 10);
      }
      return;
    }

    const transaction = snapshot.transactions[state.editingTransactionId];
    if (!transaction) {
      resetTransactionForm();
      return;
    }

    elements.transactionFormTitle.textContent = "Edit Transaction";
    elements.transactionSubmitButton.textContent = "Update Transaction";
    elements.transactionCancelButton.classList.remove("hidden");
    elements.transactionDescription.value = transaction.description;
    elements.transactionAmount.value = centsToDollarsString(transaction.totalAmountCents);
    elements.transactionPayer.value = transaction.payerMemberId;
    elements.transactionDate.value = transaction.transactionDate;
    elements.transactionSplitType.value = transaction.split.type;
    renderParticipantSelector(snapshot, transaction.participantMemberIds);
  }

  function populatePayerOptions(snapshot) {
    const members = Object.values(snapshot.members).sort((left, right) => left.name.localeCompare(right.name));

    elements.transactionPayer.innerHTML = members
      .map((member) => `<option value="${member.id}">${escapeHtml(member.name)}${member.isActive ? "" : " (inactive)"}</option>`)
      .join("");
  }

  function renderParticipantSelector(snapshot, selectedIds) {
    const resolvedSnapshot = snapshot || getSelectedGroupSnapshot();
    if (!resolvedSnapshot) {
      elements.participantFieldset.classList.add("hidden");
      elements.participantCheckboxes.innerHTML = "";
      return;
    }

    const splitType = elements.transactionSplitType.value;
    const members = Object.values(resolvedSnapshot.members).sort((left, right) => left.name.localeCompare(right.name));

    if (splitType !== "EVEN_SELECTED_MEMBERS") {
      elements.participantFieldset.classList.add("hidden");
      elements.participantCheckboxes.innerHTML = "";
      return;
    }

    elements.participantFieldset.classList.remove("hidden");
    const selectedSet = new Set(selectedIds || []);

    elements.participantCheckboxes.innerHTML = members
      .map((member) => {
        const checked = selectedIds ? selectedSet.has(member.id) : member.isActive;
        return `
          <label class="checkbox-item">
            <input type="checkbox" value="${member.id}" ${checked ? "checked" : ""} />
            <span>${escapeHtml(member.name)}${member.isActive ? "" : " (inactive)"}</span>
          </label>
        `;
      })
      .join("");
  }

  function renderTransactions(snapshot) {
    elements.transactionList.innerHTML = "";

    const transactions = Object.values(snapshot.transactions).sort((left, right) => {
      const dateCompare = right.transactionDate.localeCompare(left.transactionDate);
      if (dateCompare !== 0) {
        return dateCompare;
      }

      return right.id.localeCompare(left.id);
    });

    if (transactions.length === 0) {
      elements.transactionList.innerHTML = "<p class='muted'>No transactions yet.</p>";
      return;
    }

    transactions.forEach((transaction) => {
      const payer = snapshot.members[transaction.payerMemberId];
      const participantNames = transaction.participantMemberIds.map((memberId) => snapshot.members[memberId]?.name || memberId);
      const shareRows = transaction.participantMemberIds
        .map((memberId) => `${escapeHtml(snapshot.members[memberId].name)}: ${formatCurrency(transaction.sharesByMemberId[memberId])}`)
        .join(" · ");

      const card = document.createElement("div");
      card.className = "transaction-card";
      card.innerHTML = `
        <div class="transaction-meta">
          <div>
            <strong>${escapeHtml(transaction.description)}</strong>
            <div class="muted">${transaction.transactionDate} · Paid by ${escapeHtml(payer.name)}</div>
          </div>
          <strong>${formatCurrency(transaction.totalAmountCents)}</strong>
        </div>
        <p class="muted">Split: ${transaction.split.type === "EVEN_ALL_ACTIVE_MEMBERS" ? "All active members" : "Selected members"}.</p>
        <p class="muted">Participants: ${escapeHtml(participantNames.join(", "))}</p>
        <p class="muted">Shares: ${shareRows}</p>
        <div class="transaction-actions">
          <button type="button" class="secondary" data-action="edit" data-transaction-id="${transaction.id}">Edit</button>
          <button type="button" class="secondary" data-action="delete" data-transaction-id="${transaction.id}">Delete</button>
        </div>
      `;

      card.querySelector("[data-action='edit']").addEventListener("click", () => {
        state.editingTransactionId = transaction.id;
        render();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      card.querySelector("[data-action='delete']").addEventListener("click", () => {
        apiDelete(`/api/groups/${encodeURIComponent(snapshot.id)}/transactions/${encodeURIComponent(transaction.id)}`).then(() => {
          if (state.editingTransactionId === transaction.id) {
            state.editingTransactionId = null;
          }
          refreshState();
        });
      });

      elements.transactionList.appendChild(card);
    });
  }

  async function handleMemberCreate(event) {
    event.preventDefault();
    const snapshot = getSelectedGroupSnapshot();
    if (!snapshot) {
      return;
    }

    const name = elements.memberNameInput.value.trim();
    if (!name) {
      return;
    }

    await apiPost(`/api/groups/${encodeURIComponent(snapshot.id)}/members`, {
      id: createId(name),
      name
    });

    elements.memberForm.reset();
    await refreshState();
  }

  async function handleTransactionSubmit(event) {
    event.preventDefault();
    const snapshot = getSelectedGroupSnapshot();
    if (!snapshot) {
      return;
    }

    const amountCents = dollarsInputToCents(elements.transactionAmount.value);
    const splitType = elements.transactionSplitType.value;

    const payload = {
      description: elements.transactionDescription.value.trim(),
      totalAmountCents: amountCents,
      payerMemberId: elements.transactionPayer.value,
      transactionDate: elements.transactionDate.value,
      split: buildSplitPayload(splitType)
    };

    if (state.editingTransactionId) {
      await apiPut(
        `/api/groups/${encodeURIComponent(snapshot.id)}/transactions/${encodeURIComponent(state.editingTransactionId)}`,
        payload
      );
    } else {
      await apiPost(`/api/groups/${encodeURIComponent(snapshot.id)}/transactions`, {
        id: createId(payload.description || "transaction"),
        ...payload
      });
    }

    resetTransactionForm();
    await refreshState();
  }

  function buildSplitPayload(splitType) {
    if (splitType === "EVEN_ALL_ACTIVE_MEMBERS") {
      return { type: splitType };
    }

    const selectedMemberIds = [...elements.participantCheckboxes.querySelectorAll("input:checked")].map((input) => input.value);

    if (selectedMemberIds.length === 0) {
      throw new Error("Select at least one participant for selected-member splits.");
    }

    return {
      type: splitType,
      memberIds: selectedMemberIds
    };
  }

  function resetTransactionForm() {
    state.editingTransactionId = null;
    elements.transactionForm.reset();
    elements.transactionDate.value = new Date().toISOString().slice(0, 10);
    elements.transactionSplitType.value = "EVEN_ALL_ACTIVE_MEMBERS";
    elements.transactionCancelButton.classList.add("hidden");
    render();
  }

  function getSelectedGroupSnapshot() {
    if (!state.group) {
      return null;
    }

    return buildSnapshot(state.group);
  }

  function createId(label) {
    const base = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "item";

    return `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function dollarsInputToCents(value) {
    const normalized = String(value).trim();
    if (!normalized) {
      throw new Error("Amount is required.");
    }

    const [wholePart, decimalPart = ""] = normalized.split(".");
    const cents = `${decimalPart}00`.slice(0, 2);
    const whole = Number.parseInt(wholePart, 10);
    const fraction = Number.parseInt(cents, 10);

    if (!Number.isFinite(whole) || !Number.isFinite(fraction)) {
      throw new Error("Amount must be a valid number.");
    }

    return whole * 100 + fraction;
  }

  function centsToDollarsString(amountCents) {
    return (amountCents / 100).toFixed(2);
  }

  function formatCurrency(amountCents) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD"
    }).format(amountCents / 100);
  }

  function buildSnapshot(group) {
    const service = new window.ExpenseGroups.GroupExpenseService();
    service.groups[group.id] = JSON.parse(JSON.stringify(group));
    return service.getGroupSnapshot(group.id);
  }

  async function apiPost(url, body) {
    return apiRequest(url, "POST", body);
  }

  async function apiPut(url, body) {
    return apiRequest(url, "PUT", body);
  }

  async function apiDelete(url) {
    return apiRequest(url, "DELETE");
  }

  async function apiRequest(url, method, body) {
    const response = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Request failed.");
    }

    return payload;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  window.addEventListener("error", (event) => {
    console.error(event.error);
    window.alert(event.error?.message || "Something went wrong.");
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error(event.reason);
    window.alert(event.reason?.message || "Something went wrong.");
  });
})();
