(() => {
  const API_BASE = String(window.PAYHUB_CONFIG?.apiBase || '').replace(/\/$/, '');
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session_id') || '';
  const $ = (selector) => document.querySelector(selector);

  const els = {
    title: $('#checkoutTitle'), summaryDescription: $('#summaryDescription'), summary: $('#summary'), order: $('#order'), country: $('#country'),
    totalBlock: $('#totalBlock'), amount: $('#amount'), loadingState: $('#loadingState'), paidState: $('#paidState'),
    providerChooser: $('#providerChooser'), providerOptions: $('#providerOptions'), providerHint: $('#providerHint'),
    tossCheckout: $('#tossCheckout'), tossPayButton: $('#tossPayButton'), tossPayButtonLabel: $('#tossPayButtonLabel'),
    hostedCheckout: $('#hostedCheckout'), hostedProviderName: $('#hostedProviderName'), hostedCheckoutCopy: $('#hostedCheckoutCopy'), hostedPayButton: $('#hostedPayButton'),
    errorBox: $('#errorBox'), infoBox: $('#infoBox'), buildVersion: $('#buildVersion'),
  };

  let session = null;
  let providerOptions = [];
  let activeProvider = '';
  let tossWidgets = null;
  let busy = false;

  const api = (path, options = {}) => fetch(API_BASE + path, options);
  const hide = (el) => el?.classList.add('hidden');
  const show = (el) => el?.classList.remove('hidden');

  function money(amount, currency) {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency', currency,
      maximumFractionDigits: ['KRW', 'JPY'].includes(currency) ? 0 : 2,
    }).format(amount / (['KRW', 'JPY'].includes(currency) ? 1 : 100));
  }

  function setBuildVersion() {
    if (!els.buildVersion) return;
    const build = String(window.PAYHUB_CONFIG?.buildId || 'local');
    const commit = String(window.PAYHUB_CONFIG?.sourceCommit || 'local');
    els.buildVersion.textContent = build === 'local' ? 'local' : `${build} · ${commit.slice(0, 8)}`;
  }

  function showError(message) { els.errorBox.textContent = message; show(els.errorBox); }
  function clearError() { els.errorBox.textContent = ''; hide(els.errorBox); }
  function showInfo(message) { els.infoBox.textContent = message; show(els.infoBox); }

  function paymentErrorMessage(code) {
    const messages = {
      PAY_PROCESS_CANCELED: '결제가 취소되었습니다. 결제수단을 다시 선택해 주세요.',
      PAY_PROCESS_ABORTED: '결제가 중단되었습니다. 다른 결제수단을 선택하거나 다시 시도해 주세요.',
      REJECT_CARD_COMPANY: '결제 승인이 거절되었습니다. 다른 카드 또는 결제수단을 선택해 주세요.',
      USER_CANCEL: '결제가 취소되었습니다. 결제수단을 다시 선택해 주세요.',
    };
    return messages[code] || '결제가 완료되지 않았습니다. 결제수단을 다시 선택해 주세요.';
  }

  function renderReturnState() {
    const code = params.get('payment_error') || '';
    const cancelled = params.get('cancelled') === '1';
    if (code) showInfo(paymentErrorMessage(code));
    else if (cancelled) showInfo('결제가 취소되었습니다. 결제수단을 다시 선택해 주세요.');
  }

  function renderSummary(s) {
    els.title.textContent = s.description || '결제';
    els.summaryDescription.textContent = '주문 정보를 확인하고 결제수단을 선택해 주세요.';
    els.order.textContent = s.order_id;
    els.country.textContent = `${s.country} · ${s.currency}`;
    els.amount.textContent = money(s.amount, s.currency);
    els.tossPayButtonLabel.textContent = `${money(s.amount, s.currency)} 결제하기`;
    show(els.summary); show(els.totalBlock);
  }

  function normalizeProviderOptions(s) {
    const labels = { toss: 'TossPayments', stripe: 'Stripe', mock: 'PayHub Test' };
    const flows = { toss: 'embedded', stripe: 'hosted', mock: 'test' };
    if (Array.isArray(s.provider_options) && s.provider_options.length) {
      return s.provider_options.map((p) => ({
        id: String(p.id || '').toLowerCase(),
        name: String(p.name || labels[p.id] || p.id),
        mode: String(p.mode || 'test').toLowerCase(),
        flow: String(p.flow || flows[p.id] || 'hosted').toLowerCase(),
      })).filter((p) => p.id);
    }
    return (Array.isArray(s.providers) ? s.providers : []).map((id) => ({
      id, name: labels[id] || id, mode: 'test', flow: flows[id] || 'hosted',
    }));
  }

  function providerMeta(id) {
    if (id === 'toss') return { title: 'TossPayments', detail: '국내 카드 · 앱카드 · 간편결제' };
    if (id === 'stripe') return { title: 'Stripe', detail: '해외 카드 · 현지 결제수단' };
    if (id === 'mock') return { title: 'PayHub Test', detail: '내부 결제완료 흐름 시뮬레이션' };
    return { title: id, detail: '등록된 결제사' };
  }

  function renderProviderChooser() {
    els.providerOptions.innerHTML = '';
    const hasRealProvider = providerOptions.some((p) => p.id !== 'mock');
    els.providerHint.textContent = hasRealProvider
      ? '등록되어 있고 현재 국가·통화에서 사용 가능한 결제사입니다.'
      : '현재 이 프로젝트에는 실제 결제사가 없습니다. TossPayments 또는 Stripe 테스트 키를 연결하면 공식 테스트 결제 UI가 표시됩니다.';

    for (const option of providerOptions) {
      const meta = providerMeta(option.id);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `provider-option${option.id === 'mock' ? ' provider-option-test' : ''}`;
      button.dataset.provider = option.id;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', option.id === activeProvider ? 'true' : 'false');
      button.innerHTML = `
        <span class="provider-radio" aria-hidden="true"></span>
        <span class="provider-option-copy">
          <strong class="provider-wordmark provider-wordmark-${escapeHTML(option.id)}">${escapeHTML(meta.title)}</strong>
          <small>${escapeHTML(meta.detail)}</small>
        </span>
        <span class="provider-mode ${escapeHTML(option.mode)}">${escapeHTML(option.mode === 'live' ? 'LIVE' : 'TEST')}</span>`;
      button.addEventListener('click', () => selectProvider(option.id));
      els.providerOptions.appendChild(button);
    }
    show(els.providerChooser);
  }

  function updateProviderSelection() {
    els.providerOptions.querySelectorAll('[data-provider]').forEach((button) => {
      const selected = button.dataset.provider === activeProvider;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-checked', selected ? 'true' : 'false');
    });
  }

  async function prepare(name) {
    const r = await api(`/api/public/sessions/${encodeURIComponent(sessionId)}/providers/${encodeURIComponent(name)}/prepare`, { method: 'POST' });
    let payload = {};
    try { payload = await r.json(); } catch {}
    if (!r.ok) throw new Error(payload.error || `결제 준비에 실패했습니다. (${r.status})`);
    return payload;
  }

  async function mountToss(s) {
    hide(els.hostedCheckout); show(els.tossCheckout); clearError();
    $('#toss-payment-method').innerHTML = '';
    $('#toss-agreement').innerHTML = '';
    els.tossPayButton.disabled = true;

    const prepared = await prepare('toss');
    if (prepared.mode !== 'toss_widget') throw new Error('TossPayments 주문서형 결제 설정을 확인해 주세요.');
    if (!window.TossPayments) throw new Error('TossPayments 공식 SDK를 불러오지 못했습니다.');

    const tossPayments = TossPayments(prepared.client_key);
    tossWidgets = tossPayments.widgets({ customerKey: TossPayments.ANONYMOUS });
    await tossWidgets.setAmount({ currency: prepared.payload.currency, value: prepared.payload.amount });
    await Promise.all([
      tossWidgets.renderPaymentMethods({ selector: '#toss-payment-method', variantKey: prepared.payload.paymentVariantKey || 'DEFAULT' }),
      tossWidgets.renderAgreement({ selector: '#toss-agreement', variantKey: prepared.payload.agreementVariantKey || 'AGREEMENT' }),
    ]);

    els.tossPayButton.disabled = false;
    els.tossPayButton.onclick = async () => {
      if (busy || !tossWidgets) return;
      busy = true; clearError(); els.tossPayButton.disabled = true; els.tossPayButton.setAttribute('aria-busy', 'true');
      try {
        await tossWidgets.requestPayment({
          orderId: prepared.payload.orderId, orderName: prepared.payload.orderName,
          successUrl: prepared.payload.successUrl, failUrl: prepared.payload.failUrl,
          customerName: prepared.payload.customerName || undefined,
        });
      } catch (error) {
        showError(paymentErrorMessage(String(error?.code || '')));
        els.tossPayButton.disabled = false; els.tossPayButton.removeAttribute('aria-busy'); busy = false;
      }
    };
  }

  function hostedProviderCopy(name, s) {
    if (name === 'stripe') return {
      name: 'Stripe Checkout', title: s.country === 'KR' ? '해외 카드로 결제' : '카드 · 현지 결제수단',
      copy: 'Stripe의 보안 Checkout으로 이동해 사용 가능한 카드 및 현지 결제수단을 선택합니다.', button: 'Stripe Checkout으로 이동',
    };
    if (name === 'mock') return {
      name: 'PAYHUB TEST', title: '결제 완료 흐름 테스트',
      copy: '실제 PG 승인 없이 PayHub의 완료 콜백과 주문 복귀 흐름만 확인합니다.', button: '테스트 결제 완료',
    };
    return { name, title: '결제 계속하기', copy: '결제사 화면에서 결제를 완료합니다.', button: '계속' };
  }

  function showHostedProvider(name, s) {
    hide(els.tossCheckout); show(els.hostedCheckout); clearError();
    const copy = hostedProviderCopy(name, s);
    els.hostedProviderName.textContent = copy.name;
    $('#hostedCheckoutTitle').textContent = copy.title;
    els.hostedCheckoutCopy.textContent = copy.copy;
    els.hostedPayButton.textContent = copy.button;
    els.hostedPayButton.onclick = () => startRedirectProvider(name);
  }

  async function startRedirectProvider(name) {
    if (busy) return;
    busy = true; clearError(); els.hostedPayButton.disabled = true; els.hostedPayButton.setAttribute('aria-busy', 'true');
    try {
      const prepared = await prepare(name);
      if (prepared.mode !== 'redirect' || !prepared.url) throw new Error('결제사 이동 URL을 받지 못했습니다.');
      location.assign(prepared.url);
    } catch (error) {
      showError(error.message || String(error));
      els.hostedPayButton.disabled = false; els.hostedPayButton.removeAttribute('aria-busy'); busy = false;
    }
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function tossSetupMessage(error) {
    const code = String(error?.code || '');
    if (code === 'NOT_SUPPORTED_API_INDIVIDUAL_KEY') return 'TossPayments 주문서형 결제 연동 키(Client Key: gck 계열)가 필요합니다. PayHub 프로젝트의 TossPayments 키를 확인해 주세요.';
    if (code === 'INVALID_CLIENT_KEY') return 'TossPayments Client Key가 올바르지 않습니다. PayHub 프로젝트 설정을 확인해 주세요.';
    if (code === 'NOT_REGISTERED_PAYMENT_WIDGET') return 'TossPayments 상점관리자에서 이 연동 키에 사용할 결제 UI를 먼저 추가해 주세요.';
    return error?.message || 'TossPayments 결제 UI를 불러오지 못했습니다.';
  }

  async function selectProvider(name) {
    if (busy || !providerOptions.some((p) => p.id === name)) return;
    activeProvider = name; updateProviderSelection(); clearError(); tossWidgets = null;
    if (name === 'toss') {
      show(els.loadingState); hide(els.hostedCheckout); hide(els.tossCheckout);
      try { await mountToss(session); }
      catch (error) { hide(els.tossCheckout); showError(tossSetupMessage(error)); }
      finally { hide(els.loadingState); }
      return;
    }
    hide(els.loadingState); showHostedProvider(name, session);
  }

  function preferredProvider(s) {
    const ids = providerOptions.map((p) => p.id);
    if (s.country === 'KR' && s.currency === 'KRW' && ids.includes('toss')) return 'toss';
    if (ids.includes('stripe')) return 'stripe';
    return ids[0] || '';
  }

  async function load() {
    setBuildVersion();
    if (!API_BASE) throw new Error('PayHub API 설정이 없습니다.');
    if (!sessionId) throw new Error('결제 세션이 없습니다.');

    const r = await api(`/api/public/sessions/${encodeURIComponent(sessionId)}`);
    if (!r.ok) { let body = ''; try { body = await r.text(); } catch {} throw new Error(body || '결제 세션을 불러오지 못했습니다.'); }

    session = await r.json(); renderSummary(session); renderReturnState();
    if (session.status === 'PAID') { hide(els.loadingState); hide(els.providerChooser); show(els.paidState); return; }

    providerOptions = normalizeProviderOptions(session);
    if (!providerOptions.length) { hide(els.loadingState); showError('현재 사용할 수 있는 결제수단이 없습니다. 판매처에 문의해 주세요.'); return; }

    activeProvider = preferredProvider(session);
    renderProviderChooser(); updateProviderSelection();
    await selectProvider(activeProvider);
  }

  load().catch((error) => {
    hide(els.loadingState); hide(els.providerChooser);
    els.title.textContent = '결제를 열 수 없습니다';
    els.summaryDescription.textContent = '결제 정보를 다시 확인해 주세요.';
    showError(error.message || String(error));
  });
})();
