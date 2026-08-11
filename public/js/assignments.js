// public/js/assignments.js — Punchlist assignment UI and API

const CURRENT_USER_ID = window.APP_USER_ID || 1;
const CURRENT_COMPANY_ID = window.APP_COMPANY_ID || 1;

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
    body: JSON.stringify({ userIds, assignedBy: CURRENT_USER_ID }),
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

  fetchCompanyUsers(CURRENT_COMPANY_ID).then(users => {
    picker.innerHTML = '';
    users.forEach(u => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'assign-picker-option';
      btn.textContent = `${u.name} (${u.email})`;
      btn.addEventListener('click', async () => {
        await assignUsers(punchItemId, [u.id]);
        closeUserPicker();
        const container = document.querySelector(`.assigned-users[data-punch-id="${punchItemId}"]`);
        if (container) await initAssignmentUI(punchItemId, container);
      });
      picker.appendChild(btn);
    });
  }).catch(err => {
    picker.innerHTML = `<em style="color: red;">Error: ${err.message}</em>`;
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
        await unassignUser(punchItemId, a.user_id);
        renderAssignedUsers(punchItemId, containerEl);
      });
      chip.appendChild(x);
      containerEl.appendChild(chip);
    });
  } catch (err) {
    containerEl.innerHTML = `<em style="color: red;">Error: ${err.message}</em>`;
  }
}

async function initAssignmentUI(punchItemId, containerEl) {
  containerEl.classList.add('assigned-users');
  containerEl.dataset.punchId = punchItemId;
  await renderAssignedUsers(punchItemId, containerEl);
}
