// Submit + status check + recent records modals
const SUBMIT_ENDPOINT = '/api/public/submit';
const STATUS_ENDPOINT = '/api/public/my-submissions';
const RECENT_ENDPOINT = '/api/public/recent-accepted';
const LIST_ENDPOINT = '/data/_list.json';

// ----- score (mirrors public/js/score.js) -----
function scoreFor(rank, percent, minPercent) {
    if (rank > 75) return 0;
    let s = (-24.9975 * Math.pow(rank - 1, 0.4) + 200) *
        ((percent - (minPercent - 1)) / (100 - (minPercent - 1)));
    s = Math.max(0, s);
    if (percent !== 100) s = s - s / 3;
    return Math.max(Math.round(s * 1000) / 1000, 0);
}

// ----- shared modal helpers -----
function openModal(el) { el.style.display = 'flex'; }
function closeModal(el) { el.style.display = 'none'; }

const submitModal = document.getElementById('submit-modal');
const statusModal = document.getElementById('status-modal');
const recentModal = document.getElementById('recent-modal');

const submitForm = document.getElementById('submit-form');
const levelSelect = submitForm.querySelector('select[name="level"]');
const submitStatus = submitForm.querySelector('.submit-modal__status');
const submitBtn = submitForm.querySelector('.submit-modal__btn');

// cache list for status point calculations
let levelList = null;
async function loadList() {
    if (levelList) return levelList;
    const res = await fetch(LIST_ENDPOINT);
    levelList = await res.json();
    return levelList;
}

let levelsLoaded = false;
async function loadLevels() {
    if (levelsLoaded) return;
    try {
        const list = await loadList();
        for (const name of list) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            levelSelect.appendChild(opt);
        }
        levelsLoaded = true;
    } catch (e) {
        console.error('Failed to load levels', e);
    }
}

async function levelMeta(path) {
    try {
        const res = await fetch(`/data/${path}.json`);
        return await res.json();
    } catch { return null; }
}

// ----- delegated open/close -----
document.addEventListener('click', (e) => {
    if (e.target.closest('#open-submit-modal')) {
        e.preventDefault();
        openModal(submitModal);
        loadLevels();
        return;
    }
    if (e.target.closest('#open-status-modal')) {
        e.preventDefault();
        openModal(statusModal);
        return;
    }
    if (e.target.closest('#open-recent-modal')) {
        e.preventDefault();
        openModal(recentModal);
        loadRecent();
        return;
    }
    if (e.target.matches('.submit-modal__overlay') || e.target.matches('.submit-modal__close')) {
        const m = e.target.closest('.submit-modal');
        if (m) closeModal(m);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    [submitModal, statusModal, recentModal].forEach((m) => {
        if (m.style.display !== 'none') closeModal(m);
    });
});

// ----- submit form -----
submitForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitStatus.textContent = '';
    submitStatus.className = 'submit-modal__status';

    const data = new FormData(submitForm);
    const username = (data.get('username') || '').toString().trim();
    const level = (data.get('level') || '').toString();
    const recordLink = (data.get('record_link') || '').toString().trim();
    const rawLink = (data.get('raw_link') || '').toString().trim();
    const notes = (data.get('notes') || '').toString().trim();
    const platform = (data.get('platform') || '').toString();
    const hz = parseInt((data.get('hz') || '0').toString(), 10);

    if (!username || !level || !recordLink || !rawLink || !platform || !hz) {
        submitStatus.textContent = 'Please fill in all required fields.';
        submitStatus.classList.add('is-error');
        return;
    }

    submitBtn.disabled = true;
    try {
        const res = await fetch(SUBMIT_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                username, level, level_path: level,
                record_link: recordLink, raw_link: rawLink,
                notes: notes || null, platform, hz,
            }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || 'Submit failed');
        }
        submitForm.reset();
        submitStatus.textContent = 'Submission sent — pending moderator review';
        submitStatus.classList.add('is-success');
        setTimeout(() => closeModal(submitModal), 2000);
    } catch (err) {
        console.error(err);
        submitStatus.textContent = 'Failed to send submission';
        submitStatus.classList.add('is-error');
    } finally {
        submitBtn.disabled = false;
    }
});

// ----- status form -----
const statusForm = document.getElementById('status-form');
const statusResults = document.getElementById('status-results');

statusForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = (new FormData(statusForm).get('username') || '').toString().trim();
    if (!username) return;
    statusResults.innerHTML = 'Loading…';
    try {
        const [resp, list] = await Promise.all([
            fetch(`${STATUS_ENDPOINT}?username=${encodeURIComponent(username)}`),
            loadList(),
        ]);
        const body = await resp.json();
        const subs = body.submissions || [];
        if (!subs.length) {
            statusResults.innerHTML = '<p>No submissions found for that username.</p>';
            return;
        }
        const rows = await Promise.all(subs.map(async (s) => {
            let label;
            if (s.status === 'pending') {
                label = '<span style="color:#a16207;font-weight:700">Pending</span>';
            } else if (s.status === 'rejected') {
                label = '<span style="color:#b91c1c;font-weight:700">Rejected</span>';
            } else {
                const rank = list.indexOf(s.level_path) + 1;
                let pts = 0;
                if (rank > 0) {
                    const meta = await levelMeta(s.level_path);
                    const min = meta ? Number(meta.percentToQualify || 100) : 100;
                    pts = scoreFor(rank, 100, min);
                }
                label = `<span style="color:#15803d;font-weight:700">Accepted (+${pts} pts)</span>`;
            }
            return `<tr><td style="padding:4px 8px">${escapeHtml(s.level)}</td><td style="padding:4px 8px;text-align:right">${label}</td></tr>`;
        }));
        statusResults.innerHTML = `<table style="width:100%;border-collapse:collapse">${rows.join('')}</table>`;
    } catch (err) {
        console.error(err);
        statusResults.innerHTML = '<p style="color:#b91c1c">Failed to load.</p>';
    }
});

// ----- recent records -----
const recentResults = document.getElementById('recent-results');
async function loadRecent() {
    recentResults.innerHTML = 'Loading…';
    try {
        const res = await fetch(RECENT_ENDPOINT);
        const body = await res.json();
        const recs = body.records || [];
        if (!recs.length) {
            recentResults.innerHTML = '<p>No accepted records yet.</p>';
            return;
        }
        recentResults.innerHTML = recs.map((r) => {
            const when = r.reviewed_at ? new Date(r.reviewed_at).toLocaleDateString() : '';
            return `<div style="padding:8px 0;border-bottom:1px solid #eee">
                <div style="font-weight:700">${escapeHtml(r.username)} — ${escapeHtml(r.level)}</div>
                <div style="font-size:.85rem;color:#555">
                    ${r.hz ? r.hz + 'Hz · ' : ''}<a href="${escapeAttr(r.record_link)}" target="_blank" rel="noopener">Watch</a>
                    ${when ? ' · ' + when : ''}
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        console.error(err);
        recentResults.innerHTML = '<p style="color:#b91c1c">Failed to load.</p>';
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
