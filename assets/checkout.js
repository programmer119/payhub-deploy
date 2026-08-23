(() => {
  const API_BASE = String(window.PAYHUB_CONFIG?.apiBase || '').replace(/\/$/, '');
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session_id') || '';
  const title = document.querySelector('#title');
  const summary = document.querySelector('#summary');
  const providerSection = document.querySelector('#providerSection');
  const providers = document.querySelector('#providers');
  const paymentStage = document.querySelector('#paymentStage');
  const paymentMethods = document.querySelector('#paymentMethods');
  const paymentAgreement = document.querySelector('#paymentAgreement');
  const payButton = document.querySelector('#payButton');
  const message = document.querySelector('#message');
  const buildVersion = document.querySelector('#buildVersion');
  let session = null;
  let tossWidgets = null;
  let paymentMethodWidget = null;
  let agreementWidget = null;
  let activeProvider = '';

  if (buildVersion) {
    const build = String(window.PAYHUB_CONFIG?.buildId || 'local');
    const commit = String(window.PAYHUB_CONFIG?.sourceCommit || 'local');
    buildVersion.textContent = build === 'local' ? 'PayHub · local' : `PayHub · ${build} · ${commit.slice(0, 8)}`;
  }

  const api = (path, options={}) => fetch(API_BASE + path, options);
  const money = (amount, currency) => new Intl.NumberFormat(undefined, {style:'currency',currency}).format(amount / (['KRW','JPY'].includes(currency) ? 1 : 100));
  const setBusy = busy => [...document.querySelectorAll('button')].forEach(x => x.disabled = busy);

  async function load() {
    if (!API_BASE) throw new Error('API 설정이 없습니다.');
    if (!sessionId) throw new Error('결제 세션이 없습니다.');
    if (params.get('cancelled') === '1') message.textContent = '결제가 취소되었습니다. 다른 결제수단을 선택할 수 있습니다.';
    const r = await api(`/api/public/sessions/${encodeURIComponent(sessionId)}`);
    if (!r.ok) throw new Error(await r.text());
    session = await r.json();
    title.textContent = session.description || '결제';
    document.querySelector('#order').textContent = session.order_id;
    document.querySelector('#country').textContent = `${session.country} · ${session.currency}`;
    document.querySelector('#amount').textContent = money(session.amount, session.currency);
    summary.classList.remove('hidden');
    providers.innerHTML = '';
    if (session.status === 'PAID') { message.textContent = '이미 결제가 완료된 주문입니다.'; return; }
    if (!Array.isArray(session.providers) || session.providers.length === 0) { message.textContent = '현재 사용할 수 있는 결제수단이 없습니다. 판매처에 문의하세요.'; return; }
    providerSection.classList.remove('hidden');
    for (const name of session.providers) {
      const b = document.createElement('button');
      b.className = 'provider';
      b.dataset.provider = name;
      b.innerHTML = providerLabel(name, session.country);
      b.onclick = () => chooseProvider(name, b);
      providers.appendChild(b);
    }
    if (session.providers.length === 1) {
      const only = providers.querySelector('button');
      await chooseProvider(session.providers[0], only);
    }
  }

  function providerLabel(name, country) {
    if (name === 'toss') return '<span class="provider-mark toss-mark">T</span><span><strong>토스페이먼츠</strong><small>카드 · 앱카드 · 간편결제 · 계좌이체 등</small></span>';
    if (name === 'stripe') return `<span class="provider-mark">S</span><span><strong>Stripe</strong><small>${country === 'KR' ? '글로벌 카드 결제' : 'Card / local payment'}</small></span>`;
    if (name === 'mock') return '<span class="provider-mark">M</span><span><strong>테스트 결제</strong><small>Mock provider</small></span>';
    return `<span class="provider-mark">•</span><span><strong>${escapeHtml(name)}</strong></span>`;
  }

  function escapeHtml(value) {
    const e = document.createElement('span'); e.textContent = value; return e.innerHTML;
  }

  async function chooseProvider(name, button) {
    if (!session || activeProvider === name && name === 'toss' && tossWidgets) return;
    setBusy(true);
    message.textContent = '결제수단을 불러오고 있습니다.';
    providers.querySelectorAll('.provider').forEach(x => x.classList.toggle('selected', x === button));
    try {
      const r = await api(`/api/public/sessions/${encodeURIComponent(sessionId)}/providers/${encodeURIComponent(name)}/prepare`, {method:'POST'});
      const p = await r.json();
      if (!r.ok) throw new Error(p.error || 'prepare failed');
      activeProvider = name;
      if (p.mode === 'redirect') { location.href = p.url; return; }
      if (p.mode === 'toss_sdk') { await renderTossMethods(p); return; }
      throw new Error('지원하지 않는 결제 준비 모드입니다.');
    } catch (e) {
      activeProvider = '';
      message.textContent = e.message || String(e);
      setBusy(false);
    }
  }

  async function destroyTossWidgets() {
    try { await paymentMethodWidget?.destroy?.(); } catch {}
    try { await agreementWidget?.destroy?.(); } catch {}
    paymentMethodWidget = null; agreementWidget = null; tossWidgets = null;
    paymentMethods.innerHTML = ''; paymentAgreement.innerHTML = '';
  }

  async function renderTossMethods(p) {
    if (!window.TossPayments) throw new Error('TossPayments SDK를 불러오지 못했습니다.');
    await destroyTossWidgets();
    paymentStage.classList.remove('hidden');
    payButton.classList.add('hidden');
    const toss = TossPayments(p.client_key);
    tossWidgets = toss.widgets({customerKey: TossPayments.ANONYMOUS});
    await tossWidgets.setAmount({currency:p.payload.currency, value:p.payload.amount});
    paymentMethodWidget = await tossWidgets.renderPaymentMethods({selector:'#paymentMethods', variantKey:'DEFAULT'});
    agreementWidget = await tossWidgets.renderAgreement({selector:'#paymentAgreement', variantKey:'AGREEMENT'}).catch(async () => tossWidgets.renderAgreement({selector:'#paymentAgreement'}));
    payButton.textContent = `${money(p.payload.amount, p.payload.currency)} 결제하기`;
    payButton.onclick = async () => {
      if (!tossWidgets) return;
      payButton.disabled = true;
      message.textContent = '선택한 결제수단으로 결제창을 열고 있습니다.';
      try {
        await tossWidgets.requestPayment({
          orderId:p.payload.orderId,
          orderName:p.payload.orderName,
          customerName:p.payload.customerName,
          successUrl:p.payload.successUrl,
          failUrl:p.payload.failUrl,
        });
      } catch (e) {
        if (String(e?.code || '').toUpperCase().includes('USER_CANCEL')) message.textContent = '결제가 취소되었습니다. 다른 결제수단을 선택할 수 있습니다.';
        else message.textContent = e.message || String(e);
        payButton.disabled = false;
      }
    };
    payButton.classList.remove('hidden');
    message.textContent = '아래에서 결제수단을 선택하세요.';
    setBusy(false);
  }

  load().catch(e => { title.textContent='결제를 열 수 없습니다'; message.textContent=e.message || String(e); });
})();
