// public/js/assignments.js — Punchlist assignment UI and API

function getCurrentUserInfo() {
  try {
    if (window.AlignAuth && window.AlignAuth.getActiveUser) {
      var u = window.AlignAuth.getActiveUser();
      if (u) return { id: u.id || 1, companyId: u.company_id || 1 };
    }
  } catch(e) {}
  return { id: 1, companyId: 1 };
}

var CURRENT_USER = getCurrentUserInfo();

async function fetchCompanyUsers(companyId) {
  const res = await fetch(`/api/users?companyId=${companyId}`);
  if (!res.ok) throw new Error('Failed to load users');
  return res.json();
}

async function fetchAssignments(punchItemId) {
  const res = await fetch(`/api/punchlist/${punchItemId}/assignments`);
  if (!res.ok) throw new Error('Failed to load assignments');
  return res.json();
}

async function assignUsers(punchItemId, userIds) {
  const res = await fetch(`/api/punchlist/${punchItemId}/assignments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds, assignedBy: CURRENT_USER.id }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Assign failed');
  return res.json();
}

async function unassignUser(punchItemId, userId) {
  const res = await fetch(`/api/punchlist/${punchItemId}/assignments/${userId}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error('Unassign failed');
}

function openUserPicker(punchItemId, anchorEl) {
  closeUserPicker();
  const picker = document.createElement('div');
  picker.className = 'assign-picker';
  picker.innerHTML = '<em>Loading…</em>';
  anchorEl.insertAdjacentElement('afterend', picker);

  fetchCompanyUsers(CURRENT_USER.companyId).then(users => {
    picker.innerHTML = '';
    if (users.length === 0) {
      picker.innerHTML = '<em style="color: var(--muted); display: block; padding: 8px;">No other users in company</em>';
      return;
    }
    users.forEach(u => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'assign-picker-option';
      btn.textContent = `${u.name} (${u.email})`;
      btn.addEventListener('click', async () => {
        try {
          await assignUsers(punchItemId, [u.id]);
          closeUserPicker();
          const container = document.querySelector(`.assigned-users[data-punch-id="${punchItemId}"]`);
          if (container) await renderAssignedUsers(punchItemId, container);
        } catch (err) {
          alert('Assignment failed: ' + err.message);
        }
      });
      picker.appendChild(btn);
    });
  }).catch(err => {
    picker.innerHTML = `<em style="color: #ef4444; display: block; padding: 8px;">Error: ${err.message}</em>`;
  });
}

function closeUserPicker() {
  document.querySelectorAll('.assign-picker').forEach(el => el.remove());
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.assign-picker') && !e.target.closest('.assign-btn')) closeUserPicker();
});

async function renderAssignedUsers(punchItemId, containerEl) {
  try {
    const assignments = await fetchAssignments(punchItemId);
    containerEl.innerHTML = '';
    assignments.forEach(a => {
      const chip = document.createElement('span');
      chip.className = 'assignee-chip';
      chip.textContent = a.name;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = 'Remove assignment';
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await unassignUser(punchItemId, a.user_id);
          renderAssignedUsers(punchItemId, containerEl);
        } catch (err) {
          alert('Remove failed: ' + err.message);
        }
      });
      chip.appendChild(x);
      containerEl.appendChild(chip);
    });
    // Init UI after render completes
    if (assignments.length > 0) {
      containerEl.style.display = 'flex';
    }
  } catch (err) {
    containerEl.innerHTML = `<em style="color: #ef4444; font-size: 0.8rem;">Error loading assignments</em>`;
  }
}

async function initAssignmentUI(punchItemId, containerEl) {
  containerEl.classList.add('assigned-users');
  containerEl.dataset.punchId = punchItemId;
  await renderAssignedUsers(punchItemId, containerEl);
}

// Export to global scope
window.openUserPicker = openUserPicker;
window.renderAssignedUsers = renderAssignedUsers;
window.initAssignmentUI = initAssignmentUI;
