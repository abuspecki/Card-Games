/* =========================================================
   CardGames — Owner dashboard
   Overview, players (ban / unban / adjust balances) and feedback.
   Every request is checked on the server: only owners get data.
   ========================================================= */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const session = localStorage.getItem('cg.session') || localStorage.getItem('poker.session');
  const GAME = { holdem: "Hold'em", blackjack: 'Blackjack', durak: 'Durak' };
  const MODE = { friends: "Hold'em (friends)", bots: "Hold'em (bots)", blackjack: 'Blackjack', durak: 'Durak' };
  const CAT = { bug: 'Bug report', suggestion: 'Suggestion', feature: 'Feature request', general: 'General' };

  async function api(path, body) {
    const r = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  }

  function toast(msg, bad) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : ' good');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }

  const ago = (t) => {
    t = Number(t);
    if (!t) return 'never';
    const s = (Date.now() - t) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  const date = (d) => new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

  // ---------- views ----------
  let view = 'overview';
  function show(v) {
    view = v;
    document.querySelectorAll('[data-section]').forEach((s) => s.classList.toggle('hidden', s.dataset.section !== v));
    document.querySelectorAll('#adminTabs button').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    $('detail').classList.add('hidden');
    if (v === 'tasks') loadTasks();
    if (v === 'overview') loadOverview();
    if (v === 'players') loadPlayers();
    if (v === 'feedback') loadFeedback();
    history.replaceState(null, '', '#' + v);
  }
  document.querySelectorAll('#adminTabs button').forEach((b) => { b.onclick = () => show(b.dataset.view); });

  // ---------- overview ----------
  async function loadOverview() {
    const r = await api('/api/admin/overview');
    if (!r.ok) return toast(r.data.error || 'Could not load', true);
    const { totals: t, live, activity } = r.data;
    $('fbCount').textContent = t.feedback_new;
    $('fbCount').classList.toggle('hidden', !t.feedback_new);
    const kpi = (label, value, note) => `<div class="kpi"><small>${label}</small><strong>${value}</strong><em>${note || ''}</em></div>`;
    $('kpis').innerHTML = [
      kpi('Members', fmt(t.players), `${fmt(t.new_week)} new this week`),
      kpi('Active today', fmt(t.active_day), 'seen in the last 24 hours'),
      kpi('At the tables', fmt(live.humans), `${live.bots} bot${live.bots === 1 ? '' : 's'} · ${live.tablesPlaying} table${live.tablesPlaying === 1 ? '' : 's'} in play`),
      kpi('Coins in circulation', fmt(t.coins), 'shop currency'),
      kpi('Chips in bankrolls', fmt(t.chips), `${fmt(t.in_play)} more on the tables`),
      kpi('Hands played', fmt(t.hands_total), 'by members, all time'),
      kpi('Suspended', fmt(t.banned), 'banned accounts'),
      kpi('New feedback', fmt(t.feedback_new), '<a href="#feedback" data-go="feedback">Open the inbox</a>'),
    ].join('');
    $('kpis').querySelector('[data-go]').onclick = (e) => { e.preventDefault(); show('feedback'); };
    drawChart(activity);
    $('live').innerHTML = live.tables.map((x) => `
      <div class="live-row"><span class="dot ${x.playing ? 'on' : ''}"></span><b>${esc(x.name)}</b>
      <span>${x.humans} player${x.humans === 1 ? '' : 's'}${x.bots ? ` · ${x.bots} bot${x.bots === 1 ? '' : 's'}` : ''}</span>
      <em>${x.players.filter((p) => !p.bot).map((p) => esc(p.name)).join(', ') || '—'}</em></div>`).join('');
  }

  function drawChart(rows) {
    const days = [];
    for (let i = 13; i >= 0; i--) days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
    const by = {};
    rows.forEach((r) => { by[r.day] = by[r.day] || {}; by[r.day][r.game] = r.hands; });
    const peak = Math.max(0, ...days.map((d) => Object.values(by[d] || {}).reduce((a, b) => a + b, 0)));
    const max = Math.max(4, Math.ceil(peak / 4) * 4); // whole-number gridlines
    const W = 700, H = 220, pad = 28, bw = (W - pad) / days.length;
    let svg = `<svg viewBox="0 0 ${W} ${H + 30}" role="img" aria-label="Hands per day">`;
    for (let g = 0; g <= 4; g++) {
      const y = H - (g / 4) * H;
      svg += `<line x1="${pad}" x2="${W}" y1="${y}" y2="${y}" class="gl"/><text x="${pad - 6}" y="${y + 4}" class="ax" text-anchor="end">${Math.round((g / 4) * max)}</text>`;
    }
    days.forEach((d, i) => {
      let y = H;
      for (const g of ['holdem', 'blackjack', 'durak']) {
        const v = (by[d] || {})[g] || 0;
        const hh = (v / max) * H;
        if (v) svg += `<rect x="${pad + i * bw + 4}" y="${y - hh}" width="${bw - 8}" height="${hh}" class="b ${g}"><title>${date(d)} · ${GAME[g]}: ${v}</title></rect>`;
        y -= hh;
      }
      if (i % 2 === 0 || days.length < 10) svg += `<text x="${pad + i * bw + bw / 2}" y="${H + 18}" class="ax" text-anchor="middle">${d.slice(8)}.${d.slice(5, 7)}</text>`;
    });
    $('chart').innerHTML = svg + '</svg>';
  }
  $('refresh').onclick = loadOverview;

  // ---------- players ----------
  let offset = 0;
  let total = 0;
  async function loadPlayers() {
    const q = encodeURIComponent($('search').value.trim());
    const r = await api(`/api/admin/players?search=${q}&offset=${offset}`);
    if (!r.ok) return toast(r.data.error || 'Could not load', true);
    total = r.data.total;
    const tb = $('players').querySelector('tbody');
    tb.innerHTML = r.data.players.map((p) => `
      <tr data-id="${p.id}" tabindex="0">
        <td><b>${esc(p.username)}</b>${p.isOwner ? ' <span class="tag">owner</span>' : ''}</td>
        <td>${p.banned ? '<span class="tag bad">banned</span>' : p.online ? `<span class="tag good">${p.where ? 'at ' + esc(p.where.tableName) : 'online'}</span>` : '<span class="tag">offline</span>'}</td>
        <td class="num">${fmt(p.coins)}</td><td class="num">${fmt(p.chips)}</td><td class="num">${fmt(p.in_play)}</td>
        <td class="num">${fmt(p.hands)}</td><td class="num">${p.hands ? Math.round((p.wins / p.hands) * 100) + '%' : '—'}</td>
        <td>${ago(p.last_seen)}</td><td>${date(p.created_at)}</td></tr>`).join('') || '<tr><td colspan="9" class="empty">No players found.</td></tr>';
    tb.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.onclick = () => openPlayer(Number(tr.dataset.id));
      tr.onkeydown = (e) => { if (e.key === 'Enter') openPlayer(Number(tr.dataset.id)); };
    });
    $('pageInfo').textContent = total ? `${offset + 1}–${Math.min(offset + 50, total)} of ${fmt(total)}` : '';
    $('prev').disabled = offset === 0;
    $('next').disabled = offset + 50 >= total;
  }
  $('searchForm').onsubmit = (e) => { e.preventDefault(); offset = 0; loadPlayers(); };
  $('prev').onclick = () => { offset = Math.max(0, offset - 50); loadPlayers(); };
  $('next').onclick = () => { offset += 50; loadPlayers(); };

  async function openPlayer(id) {
    const r = await api(`/api/admin/players/${id}`);
    if (!r.ok) return toast(r.data.error || 'Could not load', true);
    const { player: p, wallet: w, stats, friends } = r.data;
    const d = $('detail');
    d.classList.remove('hidden');
    d.innerHTML = `
      <button class="close" aria-label="Close">✕</button>
      <p class="eyebrow">Member file</p>
      <h2>${esc(p.username)}</h2>
      <p class="muted">${p.banned ? `<span class="tag bad">banned</span> ${esc(p.ban_reason || 'no reason given')}` : p.online ? '<span class="tag good">online</span>' : `last seen ${ago(p.last_seen)}`} · joined ${date(p.created_at)} · ${friends} friend${friends === 1 ? '' : 's'}</p>
      <div class="mini-kpis">
        <div><small>Coins</small><b>${fmt(w.coins)}</b></div><div><small>Chips</small><b>${fmt(w.chips)}</b></div>
        <div><small>At tables</small><b>${fmt(w.inPlay)}</b></div><div><small>Daily streak</small><b>${w.daily.streak}</b></div>
      </div>
      <h3>Record</h3>
      ${stats.length ? `<table class="grid small"><thead><tr><th>Game</th><th class="num">Hands</th><th class="num">Won</th><th class="num">Result</th></tr></thead><tbody>
        ${stats.map((s) => `<tr><td>${MODE[s.mode] || esc(s.mode)}</td><td class="num">${fmt(s.hands)}</td><td class="num">${s.hands ? Math.round((s.wins / s.hands) * 100) : 0}%</td><td class="num ${s.net >= 0 ? 'pos' : 'neg'}">${s.net > 0 ? '+' : ''}${fmt(s.net)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No hands played yet.</p>'}
      <h3>Adjust balances</h3>
      <form class="adjust" id="adjForm">
        <label>Coins<input type="number" name="coins" value="0" step="1"></label>
        <label>Chips<input type="number" name="chips" value="0" step="100"></label>
        <button class="btn btn-navy">Apply</button>
      </form>
      <p class="fine">Use negative numbers to remove. Balances never go below zero.</p>
      <h3>Membership</h3>
      ${p.isOwner ? '<p class="muted">Owners cannot be banned.</p>' : p.banned
    ? '<button class="btn btn-outline" id="unban">Lift the ban</button>'
    : '<form class="ban" id="banForm"><input name="reason" maxlength="200" placeholder="Reason (shown to the player)"><button class="btn danger">Ban this player</button></form>'}`;
    d.querySelector('.close').onclick = () => d.classList.add('hidden');
    d.querySelector('#adjForm').onsubmit = async (e) => {
      e.preventDefault();
      const coins = Math.trunc(Number(e.target.coins.value) || 0);
      const chips = Math.trunc(Number(e.target.chips.value) || 0);
      if (!coins && !chips) return;
      if (!confirm(`Change ${p.username}'s balance by ${coins} coins and ${chips} chips?`)) return;
      const x = await api(`/api/admin/players/${id}/adjust`, { coins, chips });
      if (!x.ok) return toast(x.data.error, true);
      toast(`Balances updated: ${fmt(x.data.coins)} coins, ${fmt(x.data.chips)} chips.`);
      openPlayer(id); loadPlayers();
    };
    const ban = d.querySelector('#banForm');
    if (ban) ban.onsubmit = async (e) => {
      e.preventDefault();
      if (!confirm(`Ban ${p.username}? They are removed from every table and signed out.`)) return;
      const x = await api(`/api/admin/players/${id}/ban`, { reason: e.target.reason.value.trim() });
      if (!x.ok) return toast(x.data.error, true);
      toast(`${p.username} has been banned.`);
      openPlayer(id); loadPlayers();
    };
    const unban = d.querySelector('#unban');
    if (unban) unban.onclick = async () => {
      const x = await api(`/api/admin/players/${id}/unban`, {});
      if (!x.ok) return toast(x.data.error, true);
      toast(`${p.username} may play again.`);
      openPlayer(id); loadPlayers();
    };
  }

  // ---------- feedback ----------
  let fbStatus = 'priority';
  async function loadFeedback() {
    $('fbSummary').innerHTML = '';
    if (fbStatus === 'priority') return loadPriorities();
    const r = await api(`/api/admin/feedback${fbStatus ? '?status=' + fbStatus : ''}`);
    if (!r.ok) return toast(r.data.error || 'Could not load', true);
    const list = $('feedback');
    if (!r.data.feedback.length) { list.innerHTML = `<p class="empty">No ${fbStatus || ''} feedback.</p>`; return; }
    list.innerHTML = r.data.feedback.map((f) => `
      <article class="fb ${f.status}" data-id="${f.id}">
        <header><span class="tag cat-${f.category}">${CAT[f.category] || esc(f.category)}</span>
          <span>${f.username ? `from <b>${esc(f.username)}</b>` : 'from a guest'} · ${new Date(f.created_at).toLocaleString()}</span>
          <span class="tag">${f.status}</span></header>
        <p class="msg"></p>
        ${f.context ? `<p class="ctx">${esc(f.context)}</p>` : ''}
        <footer>
          ${f.status !== 'read' ? '<button data-s="read" class="btn btn-outline small">Mark read</button>' : ''}
          ${f.status !== 'resolved' ? '<button data-s="resolved" class="btn btn-navy small">Resolve</button>' : '<button data-s="new" class="btn btn-outline small">Reopen</button>'}
          <button data-del class="btn danger small">Delete</button>
        </footer>
      </article>`).join('');
    // Message text is set as text (never HTML)
    list.querySelectorAll('.fb').forEach((el, i) => { el.querySelector('.msg').textContent = r.data.feedback[i].message; });
    list.querySelectorAll('[data-s]').forEach((b) => {
      b.onclick = async () => {
        const id = b.closest('.fb').dataset.id;
        const x = await api(`/api/admin/feedback/${id}`, { status: b.dataset.s });
        if (!x.ok) return toast('Could not update', true);
        loadFeedback(); refreshCount();
      };
    });
    list.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        if (!confirm('Delete this feedback for good?')) return;
        const id = b.closest('.fb').dataset.id;
        await api(`/api/admin/feedback/${id}/delete`, {});
        loadFeedback(); refreshCount();
      };
    });
  }
  document.querySelectorAll('#fbFilters button').forEach((b) => {
    b.onclick = () => {
      fbStatus = b.dataset.status;
      document.querySelectorAll('#fbFilters button').forEach((x) => x.classList.toggle('on', x === b));
      loadFeedback();
    };
  });
  async function refreshCount() {
    const r = await api('/api/admin/feedback?status=new');
    if (r.ok) { $('fbCount').textContent = r.data.feedback.length; $('fbCount').classList.toggle('hidden', !r.data.feedback.length); }
  }

  // ---------- gate ----------
  (async () => {
    const gate = $('gate');
    if (!session) {
      gate.classList.remove('hidden');
      gate.innerHTML = '<h1>Owners only</h1><p>Please <a href="/">sign in at the club</a> with an owner account, then return here.</p>';
      return;
    }
    const me = await api('/api/me');
    if (!me.ok || !me.data.isOwner) {
      gate.classList.remove('hidden');
      gate.innerHTML = `<h1>Owners only</h1><p>${me.ok ? `You are signed in as <b>${esc(me.data.username)}</b>, which is not an owner account.` : 'Your session has expired.'} <a href="/">Back to the club</a>.</p>`;
      document.querySelector('#adminTabs').classList.add('hidden');
      return;
    }
    $('who').textContent = `Signed in as ${me.data.username}`;
    const initial = (location.hash || '#tasks').slice(1);
    show(['tasks', 'overview', 'players', 'feedback'].includes(initial) ? initial : 'tasks');
    refreshCount();
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      if (view === 'overview') loadOverview();
      if (view === 'tasks' && $('detail').classList.contains('hidden')) loadTasks();
    }, 15000);
  })();
})();

/* ---------- task board, feedback priorities, developer access ---------- */
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const session = localStorage.getItem('cg.session') || localStorage.getItem('poker.session');
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session }, body: body ? JSON.stringify(body) : undefined });
    return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
  }
  function toast(msg, bad) {
    const t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : ' good');
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }
  const LEVEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  const when = (d) => {
    if (!d) return '';
    const s = (Date.now() - new Date(d).getTime()) / 1000;
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(d).toLocaleDateString([], { day: 'numeric', month: 'short' });
  };

  // ----- board (GitHub Issues, read through /api/admin/tasks) -----
  const PRIO_DE = { 1: 'Höchste', 2: 'Hoch', 3: 'Mittel', 4: 'Niedrig' };
  const card = (t) => `
    <a class="tcard p${t.priority}${t.lane === 'done' ? ' done' : ''}" href="${esc(t.url)}" target="_blank" rel="noopener">
      <header><span class="prio p${t.priority}">#${t.number} · ${PRIO_DE[t.priority]}</span>${t.area ? `<span class="tag">${esc(t.area)}</span>` : ''}</header>
      <h3>${esc(t.title)}</h3>
      ${t.summary ? `<p class="task-sum">${esc(t.summary.length > 160 ? t.summary.slice(0, 157) + '…' : t.summary)}</p>` : ''}
      <footer><span>${t.lane === 'done' ? 'erledigt ' + when(t.closed_at) : 'aktualisiert ' + when(t.updated_at)}</span><span>${t.comments ? `${t.comments} Kommentar${t.comments === 1 ? '' : 'e'}` : ''}</span></footer>
    </a>`;
  window.loadTasks = async function loadTasks() {
    const r = await api('/api/admin/tasks');
    const links = r.data.links || {};
    if (links.newTask) { $('tbNew').href = links.newTask; $('tbList').href = links.list; }
    if (!r.ok) { $('tbFoot').textContent = r.data.error || 'GitHub ist gerade nicht erreichbar.'; return; }
    const { question, doing, queue, done } = r.data;
    const open = question.length + doing.length + queue.length;
    $('taskCount').textContent = open;
    $('taskCount').classList.toggle('hidden', !open);
    const q = $('tbQuestion');
    q.classList.toggle('hidden', !question.length);
    q.innerHTML = question.length ? `<h2>Claude wartet auf deine Antwort</h2>${question.map(card).join('')}<p class="fine">Öffne die Aufgabe und antworte dort mit einem Kommentar.</p>` : '';
    $('cntDoing').textContent = doing.length || '';
    $('cntQueue').textContent = queue.length || '';
    $('cntDone').textContent = done.length || '';
    $('colDoing').innerHTML = doing.map(card).join('') || '<p class="empty">Gerade wird nichts bearbeitet.</p>';
    $('colQueue').innerHTML = queue.map(card).join('') || '<p class="empty">Keine offenen Aufgaben – leg eine neue an.</p>';
    $('colDone').innerHTML = done.map(card).join('') || '<p class="empty">Noch nichts erledigt.</p>';
    $('tbFoot').textContent = `Aufgaben aus github.com/${r.data.repo}${r.data.stale ? ' (zwischengespeichert)' : ''} · Stand ${new Date(r.data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  };

  // ----- feedback by importance -----
  window.loadPriorities = async function loadPriorities() {
    const r = await api('/api/admin/feedback/overview');
    if (!r.ok) return toast(r.data.error || 'Could not load', true);
    const { summary, clusters } = r.data;
    $('fbSummary').innerHTML = `
      <div class="fs-levels">${['critical', 'high', 'medium', 'low'].map((l) => `<span class="lvl ${l}"><b>${summary.byLevel[l] || 0}</b>${LEVEL[l]}</span>`).join('')}</div>
      <p class="fine">${summary.total} message${summary.total === 1 ? '' : 's'} · ${summary.open} open · grouped into ${summary.clusters} topic${summary.clusters === 1 ? '' : 's'} (similar reports are merged).
      ${Object.entries(summary.byTopic).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}</p>`;
    const list = $('feedback');
    if (!clusters.length) { list.innerHTML = '<p class="empty">No feedback yet.</p>'; return; }
    let html = '';
    for (const level of ['critical', 'high', 'medium', 'low']) {
      const group = clusters.filter((c) => c.level === level && c.open);
      if (!group.length) continue;
      html += `<h2 class="lvl-head ${level}">${LEVEL[level]} <span>${group.length}</span></h2>`;
      html += group.map((c, i) => `
        <article class="fbc ${level}" data-k="${level}-${i}">
          <header><span class="tag">${esc(c.topicLabel)}</span><span class="score" title="Importance score">${c.score}</span>
            <span>${c.count} report${c.count === 1 ? '' : 's'} from ${c.reporters} ${c.reporters === 1 ? 'person' : 'people'} · latest ${when(c.latest)}</span></header>
          <h3></h3>
          <details><summary>Show ${c.count === 1 ? 'the message' : `all ${c.count} messages`}</summary><ul></ul></details>
          <footer><button class="btn btn-navy small" data-totask="${c.ids.join(',')}">Als Aufgabe anlegen</button></footer>
        </article>`).join('');
    }
    const resolved = clusters.filter((c) => !c.open).length;
    if (resolved) html += `<p class="fine">${resolved} resolved topic${resolved === 1 ? '' : 's'} hidden — see the Resolved filter.</p>`;
    list.innerHTML = html || '<p class="empty">All feedback is resolved. 🎉</p>';
    // texts as text
    for (const level of ['critical', 'high', 'medium', 'low']) {
      clusters.filter((c) => c.level === level && c.open).forEach((c, i) => {
        const el = list.querySelector(`[data-k="${level}-${i}"]`);
        el.querySelector('h3').textContent = c.title;
        const ul = el.querySelector('ul');
        c.items.forEach((it) => {
          const li = document.createElement('li');
          li.innerHTML = '<b></b> <time></time><p></p>';
          li.querySelector('b').textContent = it.username || 'guest';
          li.querySelector('time').textContent = `${when(it.created_at)} · ${it.category} · ${it.status}`;
          li.querySelector('p').textContent = it.message;
          ul.appendChild(li);
        });
      });
    }
    list.querySelectorAll('[data-totask]').forEach((b) => {
      b.onclick = async () => {
        const win = window.open('', '_blank');
        const x = await api('/api/admin/feedback/totask', { ids: b.dataset.totask.split(',').map(Number) });
        if (!x.ok) { if (win) win.close(); return toast(x.data.error, true); }
        if (win) win.location = x.data.url; else location.href = x.data.url;
        toast('Das Aufgaben-Formular ist auf GitHub vorausgefüllt – nur noch Priorität wählen und absenden.');
        loadPriorities();
      };
    });
  };
})();
