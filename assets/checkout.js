(() => {
  const API_BASE = String(window.PAYHUB_CONFIG?.apiBase || '').replace(/\/$/, '');
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session_id') || '';
  const title = document.querySelector('#title');
  const summary = document.querySelector('#summary');
  const providers = document.querySelector('#providers');
  const message = document.querySelector('#message');
  const buildVersion = document.querySelector('#buildVersion');
  if (buildVersion) {
    const build = String(window.PAYHUB_CONFIG?.buildId || 'local');
    const commit = String(window.PAYHUB_CONFIG?.sourceCommit || 'local');
    buildVersion.textContent = build === 'local' ? 'PayHub · local' : `PayHub · ${build} · ${commit.slice(0, 8)}`;
  }

  const api = (path, options={}) => fetch(API_BASE + path, options);
  const money = (amount, currency) => new Intl.NumberFormat(undefined, {style:'currency',currency}).format(amount / (['KRW','JPY'].includes(currency) ? 1 : 100));

  async function load() {
    if (!API_BASE) throw new Error('API 설정이 없습니다.');
    if (!sessionId) throw new Error('결제 세션이 없습니다.');
    if (params.get('cancelled') === '1') message.textContent = '결제가 취소되었습니다. 다른 결제수단을 선택할 수 있습니다.';
    const r = await api(`/api/public/sessions/${encodeURIComponent(sessionId)}`);
    if (!r.ok) throw new Error(await r.text());
    const s = await r.json();
    title.textContent = s.description || '결제';
    document.querySelector('#order').textContent = s.order_id;
    document.querySelector('#country').textContent = `${s.country} · ${s.currency}`;
    document.querySelector('#amount').textContent = money(s.amount, s.currency);
    summary.classList.remove('hidden');
    providers.innerHTML = '';
    if (s.status === 'PAID') { message.textContent = '이미 결제가 완료된 주문입니다.'; return; }
    if (!Array.isArray(s.providers) || s.providers.length === 0) { message.textContent = '현재 사용할 수 있는 결제수단이 없습니다. 판매처에 문의하세요.'; return; }
    for (const name of s.providers) {
      const b = document.createElement('button');
      b.className = 'provider';
      b.textContent = label(name, s.country);
      b.onclick = () => start(name, b);
      providers.appendChild(b);
    }
  }

  function label(name, country) {
    if (name === 'toss') return '카드 · 앱카드 · 간편결제';
    if (name === 'stripe') return country === 'KR' ? '글로벌 카드 결제' : 'Card / Local payment';
    if (name === 'mock') return '테스트 결제 (Mock)';
    return name;
  }

  async function start(name) {
    [...document.querySelectorAll('button')].forEach(x => x.disabled = true);
    message.textContent = '결제창을 준비하고 있습니다.';
    try {
      const r = await api(`/api/public/sessions/${encodeURIComponent(sessionId)}/providers/${encodeURIComponent(name)}/prepare`, {method:'POST'});
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || 'prepare failed');
      if (p.mode === 'redirect') { location.href = p.url; return; }
      if (p.mode === 'toss_sdk') {
        if (!window.TossPayments) throw new Error('TossPayments SDK를 불러오지 못했습니다.');
        const toss = TossPayments(p.client_key);
        const payment = toss.payment({customerKey: TossPayments.ANONYMOUS});
        await payment.requestPayment({
          method: p.payload.method,
          amount: {currency:p.payload.currency, value:p.payload.amount},
          orderId: p.payload.orderId,
          orderName: p.payload.orderName,
          customerName: p.payload.customerName,
          successUrl: p.payload.successUrl,
          failUrl: p.payload.failUrl,
        });
        return;
      }
      throw new Error('지원하지 않는 결제 준비 모드입니다.');
    } catch (e) {
      message.textContent = e.message || String(e);
      [...document.querySelectorAll('button')].forEach(x => x.disabled = false);
    }
  }

  load().catch(e => { title.textContent='결제를 열 수 없습니다'; message.textContent=e.message || String(e); });
})();
