(() => {
  const $ = (s) => document.querySelector(s);
  const API_BASE = String(window.PAYHUB_CONFIG?.apiBase || '').replace(/\/$/, '');
  const els = {
    setup: $('#setupPanel'), login: $('#loginPanel'), app: $('#app'), logout: $('#logout'), publicBase: $('#publicBase'), notice: $('#notice'),
    projectList: $('#projectList'), projectForm: $('#projectForm'), projectId: $('#projectId'), projectName: $('#projectName'), projectEnabled: $('#projectEnabled'), origins: $('#origins'), webhookUrl: $('#webhookUrl'), apiKey: $('#apiKey'), webhookSecret: $('#webhookSecret'),
    tossEnabled: $('#tossEnabled'), tossMode: $('#tossMode'), tossClientKey: $('#tossClientKey'), tossSecretKey: $('#tossSecretKey'), stripeEnabled: $('#stripeEnabled'), stripeMode: $('#stripeMode'), stripeSecretKey: $('#stripeSecretKey'), mockEnabled: $('#mockEnabled'), sessionRows: $('#sessionRows')
  };
  let dashboard = null;
  let selectedId = null;

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
  function showNotice(msg) { els.notice.textContent = msg; els.notice.classList.add('show'); setTimeout(()=>els.notice.classList.remove('show'), 3500); }
  function hideAll() { els.setup.classList.add('hidden'); els.login.classList.add('hidden'); els.app.classList.add('hidden'); els.logout.classList.add('hidden'); }

  async function boot() {
    hideAll();
    const s = await api('/api/admin/status');
    els.publicBase.textContent = s.api_base_url || API_BASE;
    if (s.setup_required) { $('#setupTokenLabel').classList.toggle('hidden', !s.setup_token_required); $('#setupToken').required = !!s.setup_token_required; els.setup.classList.remove('hidden'); return; }
    if (!s.authenticated) { els.login.classList.remove('hidden'); return; }
    els.app.classList.remove('hidden'); els.logout.classList.remove('hidden'); await loadDashboard();
  }

  async function loadDashboard() {
    dashboard = await api('/api/admin/dashboard');
    $('#projectCount').textContent = dashboard.projects.length;
    $('#paidCount').textContent = dashboard.counts.PAID || 0;
    $('#processingCount').textContent = dashboard.counts.PROCESSING || 0;
    renderProjectList(); renderSessions();
    if (selectedId) {
      const p = dashboard.projects.find(x => x.id === selectedId);
      if (p) editProject(p); else newProject();
    } else if (dashboard.projects.length) editProject(dashboard.projects[0]); else newProject();
  }

  function renderProjectList() {
    els.projectList.innerHTML = '';
    for (const p of dashboard.projects) {
      const b = document.createElement('button'); b.type='button'; b.className='outline secondary' + (p.id===selectedId?' active':'');
      b.textContent = `${p.name || p.id}${p.enabled ? '' : ' · OFF'}`; b.onclick=()=>editProject(p); els.projectList.appendChild(b);
    }
  }
  function provider(p, name) { return p?.providers?.[name] || {enabled:false,mode:'test',client_key:'',secret_key:''}; }
  function editProject(p) {
    selectedId = p.id; $('#editorTitle').textContent = p.name || p.id; els.projectId.value=p.id; els.projectId.disabled=true; els.projectName.value=p.name||p.id; els.projectEnabled.checked=!!p.enabled;
    els.origins.value=(p.allowed_return_origins||[]).join('\n'); els.webhookUrl.value=p.webhook_url||''; els.apiKey.value=p.api_key||''; els.webhookSecret.value=p.webhook_secret||'';
    const t=provider(p,'toss'), st=provider(p,'stripe'), m=provider(p,'mock'); els.tossEnabled.checked=!!t.enabled; els.tossMode.value=t.mode||'test'; els.tossClientKey.value=t.client_key||''; els.tossSecretKey.value=t.secret_key||''; els.stripeEnabled.checked=!!st.enabled; els.stripeMode.value=st.mode||'test'; els.stripeSecretKey.value=st.secret_key||''; els.mockEnabled.checked=!!m.enabled;
    $('#deleteProject').disabled=false; $('#rotateApi').disabled=false; $('#rotateWebhook').disabled=false; renderProjectList();
  }
  function newProject() {
    selectedId=null; $('#editorTitle').textContent='새 프로젝트'; els.projectForm.reset(); els.projectId.disabled=false; els.projectEnabled.checked=true; els.mockEnabled.checked=true; els.tossMode.value='test'; els.stripeMode.value='test'; $('#deleteProject').disabled=true; $('#rotateApi').disabled=true; $('#rotateWebhook').disabled=true; renderProjectList();
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
  function renderSessions() {
    els.sessionRows.innerHTML='';
    for (const s of dashboard.sessions) {
      const tr=document.createElement('tr'); const amount = ['KRW','JPY'].includes(s.currency) ? s.amount : s.amount/100;
      for (const value of [new Date(s.created_at).toLocaleString(), s.project_id, s.order_id, `${amount.toLocaleString()} ${s.currency}`, s.country, s.provider||'-', s.status]) { const td=document.createElement('td'); td.textContent=value; tr.appendChild(td); }
      els.sessionRows.appendChild(tr);
    }
  }

  $('#setupForm').addEventListener('submit', async e=>{e.preventDefault(); try { await api('/api/admin/setup',{method:'POST',body:JSON.stringify({username:$('#setupUser').value,password:$('#setupPass').value,setup_token:$('#setupToken').value})}); await boot(); } catch(err){showNotice(err.message);} });
  $('#loginForm').addEventListener('submit', async e=>{e.preventDefault(); try { await api('/api/admin/login',{method:'POST',body:JSON.stringify({username:$('#loginUser').value,password:$('#loginPass').value})}); await boot(); } catch(err){showNotice(err.message);} });
  els.logout.onclick=async()=>{await api('/api/admin/logout',{method:'POST',body:'{}'});await boot();};
  $('#newProject').onclick=newProject;
  els.projectForm.addEventListener('submit', async e=>{e.preventDefault();try{const p=await api('/api/admin/projects',{method:'POST',body:JSON.stringify(payload())});selectedId=p.id;showNotice('저장되었습니다.');await loadDashboard();}catch(err){showNotice(err.message);}});
  $('#deleteProject').onclick=async()=>{if(!selectedId||!confirm('이 프로젝트 설정을 삭제할까요?'))return;try{await api(`/api/admin/projects/${encodeURIComponent(selectedId)}`,{method:'DELETE',body:'{}'});selectedId=null;showNotice('삭제되었습니다.');await loadDashboard();}catch(err){showNotice(err.message);}};
  $('#rotateApi').onclick=async()=>{if(!selectedId||!confirm('기존 API Key는 즉시 무효화됩니다. 재발급할까요?'))return;try{const x=await api(`/api/admin/projects/${encodeURIComponent(selectedId)}/rotate-api-key`,{method:'POST',body:'{}'});els.apiKey.value=x.api_key;showNotice('API Key가 재발급되었습니다.');await loadDashboard();}catch(err){showNotice(err.message);}};
  $('#rotateWebhook').onclick=async()=>{if(!selectedId||!confirm('Webhook Secret을 재발급할까요?'))return;try{const x=await api(`/api/admin/projects/${encodeURIComponent(selectedId)}/rotate-webhook-secret`,{method:'POST',body:'{}'});els.webhookSecret.value=x.webhook_secret;showNotice('Webhook Secret이 재발급되었습니다.');await loadDashboard();}catch(err){showNotice(err.message);}};
  $('#showSecrets').onclick=()=>{for(const e of [els.apiKey,els.webhookSecret,els.tossClientKey,els.tossSecretKey,els.stripeSecretKey]) e.type=e.type==='password'?'text':'password';};
  boot().catch(err=>showNotice(err.message));
})();
