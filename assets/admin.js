(() => {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const API_BASE = String(window.PAYHUB_CONFIG?.apiBase || '').replace(/\/$/, '');
  const els = {
    setup: $('#setupPanel'), login: $('#loginPanel'), app: $('#app'), logout: $('#logout'), notice: $('#notice'),
    navProjects: $('#navProjects'), navSessions: $('#navSessions'), navProjectCount: $('#navProjectCount'), apiHealthLink: $('#apiHealthLink'),
    homeView: $('#homeView'), projectsView: $('#projectsView'), sessionsView: $('#sessionsView'),
    projectList: $('#projectList'), projectListCount: $('#projectListCount'), projectForm: $('#projectForm'), projectId: $('#projectId'), projectName: $('#projectName'), projectEnabled: $('#projectEnabled'), projectSourceHint: $('#projectSourceHint'), origins: $('#origins'), webhookUrl: $('#webhookUrl'), apiKey: $('#apiKey'), webhookSecret: $('#webhookSecret'),
    tossEnabled: $('#tossEnabled'), tossMode: $('#tossMode'), tossClientKey: $('#tossClientKey'), tossSecretKey: $('#tossSecretKey'), stripeEnabled: $('#stripeEnabled'), stripeMode: $('#stripeMode'), stripeSecretKey: $('#stripeSecretKey'), mockEnabled: $('#mockEnabled'),
    homeProjectCards: $('#homeProjectCards'), homeProjectSummary: $('#homeProjectSummary'), homeSessionRows: $('#homeSessionRows'), sessionRows: $('#sessionRows'), sessionFilters: $('#sessionFilters'),
    editorTitle: $('#editorTitle'), editorState: $('#editorState'), saveProject: $('#saveProject')
  };
  let dashboard = null;
  let selectedId = null;
  let monitorProjects = [];
  let currentView = 'home';
  let sessionFilter = 'ALL';
  let noticeTimer = null;

  function renderBuildVersion() {
    const el = $('#buildVersion');
    if (!el) return;
    const build = String(window.PAYHUB_CONFIG?.buildId || 'local');
    const commit = String(window.PAYHUB_CONFIG?.sourceCommit || 'local');
    el.textContent = build === 'local' ? 'PayHub · local' : `PayHub · ${build} · ${commit.slice(0, 8)}`;
  }
  renderBuildVersion();

  async function api(path, options={}) {
    const r = await fetch(API_BASE + path, {credentials:'include', headers:{'Content-Type':'application/json', ...(options.headers||{})}, ...options});
    let body = null; try { body = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`);
    return body;
  }

  function showNotice(msg, type='success') {
    clearTimeout(noticeTimer);
    els.notice.textContent = msg;
    els.notice.className = `notice show ${type}`;
    noticeTimer = setTimeout(()=>{ els.notice.className='notice'; }, 4200);
  }
  function hideAll() {
    els.setup.classList.add('hidden'); els.login.classList.add('hidden'); els.app.classList.add('hidden'); els.logout.classList.add('hidden'); els.navProjects.classList.add('hidden'); els.navSessions.classList.add('hidden');
  }
  function setBusy(button, busy, busyText='처리 중...') {
    if (!button) return;
    if (busy) { button.dataset.label = button.textContent; button.disabled = true; button.textContent = busyText; }
    else { button.disabled = false; if (button.dataset.label) button.textContent = button.dataset.label; delete button.dataset.label; }
  }

  function normalizeView(raw) {
    const v = String(raw || '').replace(/^#/, '').toLowerCase();
    if (v.startsWith('projects')) return 'projects';
    if (v.startsWith('sessions')) return 'sessions';
    return 'home';
  }
  function showView(view, {push=true, filter}={}) {
    currentView = normalizeView(view);
    if (filter) sessionFilter = filter;
    els.homeView.classList.toggle('hidden', currentView !== 'home');
    els.projectsView.classList.toggle('hidden', currentView !== 'projects');
    els.sessionsView.classList.toggle('hidden', currentView !== 'sessions');
    els.navProjects.classList.toggle('active', currentView === 'projects');
    els.navSessions.classList.toggle('active', currentView === 'sessions');
    if (currentView === 'sessions') renderSessions();
    if (push) {
      const hash = `#${currentView}`;
      if (location.hash !== hash) history.pushState(null, '', hash);
    }
    window.scrollTo({top:0, behavior:'smooth'});
  }

  async function boot() {
    hideAll();
    const s = await api('/api/admin/status');
    if (els.apiHealthLink) els.apiHealthLink.href = (s.api_base_url || API_BASE) + '/healthz';
    if (s.setup_required) { $('#setupTokenLabel').classList.toggle('hidden', !s.setup_token_required); $('#setupToken').required = !!s.setup_token_required; els.setup.classList.remove('hidden'); return; }
    if (!s.authenticated) { els.login.classList.remove('hidden'); return; }
    els.app.classList.remove('hidden'); els.logout.classList.remove('hidden'); els.navProjects.classList.remove('hidden'); els.navSessions.classList.remove('hidden');
    await loadMonitorProjects();
    await loadDashboard();
    showView(normalizeView(location.hash), {push:false});
  }

  async function loadMonitorProjects() {
    try {
      const x = await api('/api/admin/monitor-projects');
      monitorProjects = Array.isArray(x.projects) ? x.projects : [];
      els.projectSourceHint.textContent = monitorProjects.length
        ? `Monitor 등록 프로젝트 ${monitorProjects.length}개 · Project ID(pNN) 기준`
        : 'Monitor에 등록된 프로젝트가 없습니다.';
    } catch (err) {
      monitorProjects = [];
      els.projectSourceHint.textContent = `Monitor 프로젝트 목록 연결 대기 · ${err.message}`;
      return false;
    }
    return true;
  }

  function monitorProject(id) { return monitorProjects.find(x => x.project_id === id) || null; }
  function payhubProject(id) { return dashboard?.projects?.find(x => x.id === id) || null; }
  function applyHubBridge(projectId, fallback='') {
    const mp = monitorProject(projectId);
    if (mp?.hub_bridge_url) {
      els.webhookUrl.value = mp.hub_bridge_url;
      els.webhookUrl.readOnly = true;
      els.webhookHint.textContent = '공통 Hub Bridge 규칙으로 자동 설정 · 각 Hub 이벤트는 /api/hub/events에서 수신';
      return;
    }
    els.webhookUrl.value = fallback || '';
    els.webhookUrl.readOnly = true;
    els.webhookHint.textContent = projectId ? 'Monitor 미등록 기존 설정입니다. 기존 Webhook 값은 보존합니다.' : 'Monitor 프로젝트 선택 시 공개 URL + /api/hub/events로 자동 설정합니다.';
  }
  function projectName(id) { return payhubProject(id)?.name || monitorProject(id)?.name || id; }
  function provider(p, name) { return p?.providers?.[name] || {enabled:false,mode:'test',client_key:'',secret_key:''}; }
  function enabledProviderNames(p) {
    const labels = {toss:'Toss', stripe:'Stripe', mock:'Mock'};
    return Object.entries(p?.providers || {}).filter(([,v])=>v?.enabled).map(([k])=>labels[k] || k);
  }
  function statusLabel(status) {
    return {PAID:'완료',PROCESSING:'처리 중',FAILED:'실패',CANCELLED:'취소',CREATED:'생성'}[status] || status || '-';
  }
  function statusClass(status) { return String(status || '').toLowerCase(); }
  function amountText(s) {
    const amount = ['KRW','JPY'].includes(s.currency) ? s.amount : s.amount/100;
    return `${Number(amount).toLocaleString()} ${s.currency}`;
  }
  function formatTime(raw) { try { return new Date(raw).toLocaleString(); } catch (_) { return raw || '-'; } }

  function renderProjectOptions(current='') {
    const wanted = String(current || '');
    els.projectId.innerHTML = '';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = monitorProjects.length ? 'Monitor 프로젝트 선택' : 'Monitor 프로젝트 목록 없음';
    els.projectId.appendChild(blank);
    for (const mp of monitorProjects) {
      const o = document.createElement('option');
      o.value = mp.project_id;
      o.textContent = `${mp.label || `${mp.name || mp.project_id} (${mp.project_id})`}${payhubProject(mp.project_id) ? ' · PayHub 등록됨' : ''}${mp.enabled ? '' : ' · OFF'}`;
      if (!mp.enabled && !payhubProject(mp.project_id)) o.disabled = true;
      els.projectId.appendChild(o);
    }
    if (wanted && !monitorProject(wanted)) {
      const currentPayhub = payhubProject(wanted);
      const o = document.createElement('option');
      o.value = wanted;
      o.textContent = `${currentPayhub?.name || wanted} · ${wanted} · 기존 PayHub 설정 · Monitor 미등록`;
      els.projectId.appendChild(o);
    }
    els.projectId.value = wanted;
  }

  async function loadDashboard() {
    dashboard = await api('/api/admin/dashboard');
    const projects = dashboard.projects || [];
    $('#projectCount').textContent = projects.length;
    $('#paidCount').textContent = dashboard.counts.PAID || 0;
    $('#processingCount').textContent = dashboard.counts.PROCESSING || 0;
    els.navProjectCount.textContent = projects.length;
    els.projectListCount.textContent = `${projects.length}개`;
    renderProjectList(); renderHomeProjects(); renderHomeSessions(); renderSessionFilterCounts(); renderSessions();
    if (selectedId) {
      const p = payhubProject(selectedId);
      if (p) editProject(p, {stay:true}); else newProject({stay:true});
    } else if (!els.projectId.value) {
      const canonical = projects.find(p => monitorProject(p.id));
      if (canonical) editProject(canonical, {stay:true}); else newProject({stay:true});
    }
  }

  function renderHomeProjects() {
    const projects = dashboard?.projects || [];
    els.homeProjectSummary.textContent = projects.length ? `${projects.length}개 연결됨` : '아직 연결된 프로젝트 없음';
    els.homeProjectCards.innerHTML = '';
    if (!projects.length) {
      const box = document.createElement('div'); box.className='empty-state';
      box.innerHTML='<strong>연결된 프로젝트가 없습니다.</strong><span>Monitor 프로젝트를 선택해 PayHub에 연결하세요.</span>';
      const b=document.createElement('button'); b.type='button'; b.textContent='첫 프로젝트 연결'; b.onclick=()=>{newProject(); showView('projects');}; box.appendChild(b); els.homeProjectCards.appendChild(box); return;
    }
    for (const p of projects.slice(0,6)) {
      const b=document.createElement('button'); b.type='button'; b.className='home-project-card';
      const canonical=!!monitorProject(p.id); const providers=enabledProviderNames(p);
      const head=document.createElement('div'); head.className='project-card-head';
      const name=document.createElement('strong'); name.textContent=p.name || p.id;
      const id=document.createElement('span'); id.className='project-item-id'; id.textContent=p.id;
      head.append(name,id);
      const meta=document.createElement('div'); meta.className='project-card-meta';
      meta.append(chip(p.enabled?'API ON':'API OFF',p.enabled?'on':'off'), chip(canonical?'Monitor 연결':'Monitor 미등록',canonical?'on':'off'));
      for(const label of providers.slice(0,3)) meta.append(chip(label,'on'));
      if(!providers.length) meta.append(chip('PG 미설정','off'));
      b.append(head,meta); b.onclick=()=>{editProject(p);showView('projects');}; els.homeProjectCards.appendChild(b);
    }
  }
  function chip(text, cls='') { const s=document.createElement('span'); s.className=`mini-chip ${cls}`.trim(); s.textContent=text; return s; }

  function renderProjectList() {
    const projects = dashboard?.projects || [];
    els.projectList.innerHTML = '';
    if (!projects.length) {
      const box=document.createElement('div'); box.className='empty-state'; box.innerHTML='<strong>PayHub 프로젝트 없음</strong><span>오른쪽에서 Monitor 프로젝트를 선택해 연결하세요.</span>'; els.projectList.appendChild(box); return;
    }
    for (const p of projects) {
      const b=document.createElement('button'); b.type='button'; b.className='project-item' + (p.id===selectedId?' active':'');
      const canonical=!!monitorProject(p.id); const providers=enabledProviderNames(p);
      const head=document.createElement('span'); head.className='project-item-head';
      const name=document.createElement('strong'); name.textContent=p.name || p.id;
      const id=document.createElement('span'); id.className='project-item-id'; id.textContent=p.id;
      head.append(name,id);
      const meta=document.createElement('span'); meta.className='project-item-meta';
      meta.append(chip(p.enabled?'ON':'OFF',p.enabled?'on':'off'), chip(canonical?'Monitor':'미등록',canonical?'on':'off'));
      if(providers.length) meta.append(chip(providers.join(' · '),'on')); else meta.append(chip('PG 미설정','off'));
      b.append(head,meta); b.onclick=()=>editProject(p); els.projectList.appendChild(b);
    }
  }

  function editProject(p, {stay=false}={}) {
    selectedId = p.id;
    els.editorTitle.textContent = p.name || p.id;
    els.editorState.textContent = p.enabled ? '활성' : '비활성'; els.editorState.className=`state-chip ${p.enabled?'on':'off'}`;
    renderProjectOptions(p.id); els.projectName.value=p.name||p.id; els.projectEnabled.checked=!!p.enabled;
    els.origins.value=(p.allowed_return_origins||[]).join('\n'); applyHubBridge(p.id,p.webhook_url||''); els.apiKey.value=p.api_key||''; els.webhookSecret.value=p.webhook_secret||'';
    const t=provider(p,'toss'), st=provider(p,'stripe'), m=provider(p,'mock');
    els.tossEnabled.checked=!!t.enabled; els.tossMode.value=t.mode||'test'; els.tossClientKey.value=t.client_key||''; els.tossSecretKey.value=t.secret_key||'';
    els.stripeEnabled.checked=!!st.enabled; els.stripeMode.value=st.mode||'test'; els.stripeSecretKey.value=st.secret_key||''; els.mockEnabled.checked=!!m.enabled;
    $('#deleteProject').disabled=false; $('#rotateApi').disabled=false; $('#rotateWebhook').disabled=false; renderProjectList();
    if(!stay) showView('projects');
  }
  function resetNewForm() {
    els.projectForm.reset(); els.projectEnabled.checked=true; els.mockEnabled.checked=true; els.tossMode.value='test'; els.stripeMode.value='test'; applyHubBridge('');
    $('#deleteProject').disabled=true; $('#rotateApi').disabled=true; $('#rotateWebhook').disabled=true;
  }
  function newProject({stay=false}={}) {
    selectedId=null; els.editorTitle.textContent='새 프로젝트'; els.editorState.textContent='신규'; els.editorState.className='state-chip'; resetNewForm(); renderProjectOptions(''); renderProjectList();
    if(!stay) showView('projects');
  }
  function newProjectFromMonitor(id) {
    const mp = monitorProject(id); if (!mp) return;
    selectedId = null; resetNewForm(); renderProjectOptions(id); els.projectId.value=id;
    els.editorTitle.textContent = mp.name || id; els.editorState.textContent='신규'; els.editorState.className='state-chip';
    els.projectName.value = mp.name || id; els.origins.value = mp.return_origin || ''; applyHubBridge(id); renderProjectList();
  }
  function payload() {
    return {
      id: els.projectId.value.trim(), name: els.projectName.value.trim(), enabled: els.projectEnabled.checked, api_key: els.apiKey.value.trim(), webhook_url: els.webhookUrl.value.trim(), webhook_secret: els.webhookSecret.value.trim(),
      allowed_return_origins: els.origins.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),
      providers: {
        toss: {enabled:els.tossEnabled.checked,mode:els.tossMode.value,client_key:els.tossClientKey.value.trim(),secret_key:els.tossSecretKey.value.trim()},
        stripe: {enabled:els.stripeEnabled.checked,mode:els.stripeMode.value,secret_key:els.stripeSecretKey.value.trim()},
        mock: {enabled:els.mockEnabled.checked,mode:'test'}
      }
    };
  }

  function sessionRows(filter='ALL', limit=0) {
    const all = dashboard?.sessions || [];
    const rows = filter==='ALL' ? all : all.filter(s=>s.status===filter);
    return limit ? rows.slice(0,limit) : rows;
  }
  function appendSessionRow(tbody, s, compact=false) {
    const tr=document.createElement('tr');
    const values=compact ? [formatTime(s.created_at),projectName(s.project_id),amountText(s)] : [formatTime(s.created_at),projectName(s.project_id),s.order_id,amountText(s),s.country,s.provider||'-'];
    for(const value of values){const td=document.createElement('td');td.textContent=value;tr.appendChild(td);}
    const statusTd=document.createElement('td'); const badge=document.createElement('span'); badge.className=`session-status ${statusClass(s.status)}`; badge.textContent=statusLabel(s.status); statusTd.appendChild(badge); tr.appendChild(statusTd); tbody.appendChild(tr);
  }
  function appendEmptyRow(tbody, colspan, text) { const tr=document.createElement('tr'); const td=document.createElement('td'); td.colSpan=colspan; td.className='empty-state'; td.textContent=text; tr.appendChild(td); tbody.appendChild(tr); }
  function renderHomeSessions() {
    els.homeSessionRows.innerHTML=''; const rows=sessionRows('ALL',5);
    if(!rows.length){appendEmptyRow(els.homeSessionRows,4,'아직 결제 세션이 없습니다.');return;}
    rows.forEach(s=>appendSessionRow(els.homeSessionRows,s,true));
  }
  function renderSessionFilterCounts() {
    const all=dashboard?.sessions||[]; const count=s=>all.filter(x=>x.status===s).length;
    $('#filterAllCount').textContent=all.length; $('#filterPaidCount').textContent=count('PAID'); $('#filterProcessingCount').textContent=count('PROCESSING'); $('#filterFailedCount').textContent=count('FAILED'); $('#filterCancelledCount').textContent=count('CANCELLED'); $('#filterCreatedCount').textContent=count('CREATED');
  }
  function renderSessions() {
    if(!els.sessionRows || !dashboard) return;
    els.sessionRows.innerHTML='';
    $$('#sessionFilters button').forEach(b=>b.classList.toggle('active',b.dataset.status===sessionFilter));
    const rows=sessionRows(sessionFilter);
    if(!rows.length){appendEmptyRow(els.sessionRows,7,sessionFilter==='ALL'?'아직 결제 세션이 없습니다.':'해당 상태의 결제 세션이 없습니다.');return;}
    rows.forEach(s=>appendSessionRow(els.sessionRows,s,false));
  }

  $('#setupForm').addEventListener('submit', async e=>{e.preventDefault();const b=e.submitter;try{setBusy(b,true,'생성 중...');await api('/api/admin/setup',{method:'POST',body:JSON.stringify({username:$('#setupUser').value,password:$('#setupPass').value,setup_token:$('#setupToken').value})});await boot();}catch(err){showNotice(err.message,'error');}finally{setBusy(b,false);}});
  $('#loginForm').addEventListener('submit', async e=>{e.preventDefault();const b=e.submitter;try{setBusy(b,true,'로그인 중...');await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:$('#loginUser').value,password:$('#loginPass').value})});await boot();}catch(err){showNotice(err.message,'error');}finally{setBusy(b,false);}});
  els.logout.onclick=async()=>{try{await api('/api/admin/logout',{method:'POST',body:'{}'});history.replaceState(null,'','#home');await boot();}catch(err){showNotice(err.message,'error');}};

  $('#homeLink').onclick=e=>{if(!els.app.classList.contains('hidden')){e.preventDefault();showView('home');}};
  els.navProjects.onclick=()=>showView('projects'); els.navSessions.onclick=()=>{sessionFilter='ALL';showView('sessions');};
  $('#metricProjects').onclick=()=>showView('projects'); $('#metricPaid').onclick=()=>showView('sessions',{filter:'PAID'}); $('#metricProcessing').onclick=()=>showView('sessions',{filter:'PROCESSING'});
  $('#homeAllProjects').onclick=()=>showView('projects'); $('#homeAddProject').onclick=()=>newProject(); $('#homeAllSessions').onclick=()=>{sessionFilter='ALL';showView('sessions');};
  $('#newProject').onclick=()=>newProject(); $('#newProjectTop').onclick=()=>newProject();
  $('#refreshMonitor').onclick=async e=>{const b=e.currentTarget;try{setBusy(b,true,'새로고침 중...');const ok=await loadMonitorProjects();await loadDashboard();if(ok)showNotice(`Monitor 프로젝트 ${monitorProjects.length}개를 다시 불러왔습니다.`);else showNotice('Monitor 프로젝트 목록을 불러오지 못했습니다. 기존 PayHub 설정은 그대로 유지됩니다.','error');}catch(err){showNotice(err.message,'error');}finally{setBusy(b,false);}};

  els.projectId.addEventListener('change', ()=>{
    const id=els.projectId.value.trim(); if (!id) { newProject({stay:true}); return; }
    const existing=payhubProject(id); if (existing) editProject(existing,{stay:true}); else newProjectFromMonitor(id);
  });
  els.projectForm.addEventListener('submit', async e=>{
    e.preventDefault(); const pld=payload();
    if(!pld.id){showNotice('Monitor 프로젝트를 먼저 선택하세요.','error');return;}
    try{setBusy(els.saveProject,true,'저장 중...');const p=await api('/api/admin/projects',{method:'POST',body:JSON.stringify(pld)});selectedId=p.id;await loadDashboard();editProject(payhubProject(p.id)||p,{stay:true});showNotice(`${p.name || p.id} 저장 완료 · 프로젝트 목록에 반영했습니다.`);}catch(err){showNotice(err.message,'error');}finally{setBusy(els.saveProject,false);}
  });
  $('#deleteProject').onclick=async()=>{if(!selectedId||!confirm('이 프로젝트의 PayHub 설정을 삭제할까요? Monitor 프로젝트 자체는 삭제되지 않습니다.'))return;try{await api(`/api/admin/projects/${encodeURIComponent(selectedId)}`,{method:'DELETE',body:'{}'});selectedId=null;await loadDashboard();newProject({stay:true});showNotice('PayHub 프로젝트 설정을 삭제했습니다.');}catch(err){showNotice(err.message,'error');}};
  $('#rotateApi').onclick=async()=>{if(!selectedId||!confirm('기존 PayHub API Secret은 즉시 무효화됩니다. 재발급할까요?'))return;try{const x=await api(`/api/admin/projects/${encodeURIComponent(selectedId)}/rotate-api-key`,{method:'POST',body:'{}'});els.apiKey.value=x.api_key;showNotice('PayHub API Secret을 재발급했습니다.');await loadDashboard();}catch(err){showNotice(err.message,'error');}};
  $('#rotateWebhook').onclick=async()=>{if(!selectedId||!confirm('Webhook Secret을 재발급할까요?'))return;try{const x=await api(`/api/admin/projects/${encodeURIComponent(selectedId)}/rotate-webhook-secret`,{method:'POST',body:'{}'});els.webhookSecret.value=x.webhook_secret;showNotice('Webhook Secret을 재발급했습니다.');await loadDashboard();}catch(err){showNotice(err.message,'error');}};
  $('#showSecrets').onclick=()=>{for(const e of [els.apiKey,els.webhookSecret,els.tossClientKey,els.tossSecretKey,els.stripeSecretKey]) e.type=e.type==='password'?'text':'password';};
  els.sessionFilters.addEventListener('click',e=>{const b=e.target.closest('button[data-status]');if(!b)return;sessionFilter=b.dataset.status||'ALL';renderSessions();});
  window.addEventListener('hashchange',()=>{if(!els.app.classList.contains('hidden'))showView(normalizeView(location.hash),{push:false});});

  boot().catch(err=>showNotice(err.message,'error'));
})();
