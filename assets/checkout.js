(() => {
  const API_BASE = String(window.PAYHUB_CONFIG?.apiBase || '').replace(/\/$/, '');
  const params = new URLSearchParams(location.search);
  const sessionId = params.get('session_id') || '';

  const $ = (selector) => document.querySelector(selector);
  const els = {
    title: $('#checkoutTitle'),
    summaryDescription: $('#summaryDescription'),
    summary: $('#summary'),
    order: $('#order'),
    country: $('#country'),
    totalBlock: $('#totalBlock'),
    amount: $('#amount'),
    loadingState: $('#loadingState'),
    paidState: $('#paidState'),
    tossCheckout: $('#tossCheckout'),
    tossPayButton: $('#tossPayButton'),
    tossPayButtonLabel: $('#tossPayButtonLabel'),
    hostedCheckout: $('#hostedCheckout'),
    hostedProviderName: $('#hostedProviderName'),
    hostedCheckoutCopy: $('#hostedCheckoutCopy'),
    hostedPayButton: $('#hostedPayButton'),
    alternateSection: $('#alternateSection'),
    alternateProviders: $('#alternateProviders'),
    errorBox: $('#errorBox'),
    infoBox: $('#infoBox'),
    buildVersion: $('#buildVersion'),
  };

  let session = null;
  let tossWidgets = null;
  let primaryProvider = '';
  let busy = false;

  const api = (path, options = {}) => fetch(API_BASE + path, options);

  function money(amount, currency) {
    return new Intl.NumberFormat('ko-KR', {
      style: 'currency',
      currency,
      maximumFractionDigits: ['KRW', 'JPY'].includes(currency) ? 0 : 2,
    }).format(amount / (['KRW', 'JPY'].includes(currency) ? 1 : 100));
  }

  function setBuildVersion() {
    if (!els.buildVersion) return;
    const build = String(window.PAYHUB_CONFIG?.buildId || 'local');
    const commit = String(window.PAYHUB_CONFIG?.sourceCommit || 'local');
    els.buildVersion.textContent = build === 'local' ? 'local' : `${build} · ${commit.slice(0, 8)}`;
  }

  function hide(el) { el?.classList.add('hidden'); }
  function show(el) { el?.classList.remove('hidden'); }

  function showError(message) {
    els.errorBox.textContent = message;
    show(els.errorBox);
  }

  function clearError() {
    els.errorBox.textContent = '';
    hide(els.errorBox);
  }

  function showInfo(message) {
    els.infoBox.textContent = message;
    show(els.infoBox);
  }

  function clearInfo() {
    els.infoBox.textContent = '';
    hide(els.infoBox);
  }

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
    show(els.summary);
    show(els.totalBlock);
  }

  async function prepare(name) {
    const r = await api(`/api/public/sessions/${encodeURIComponent(sessionId)}/providers/${encodeURIComponent(name)}/prepare`, { method: 'POST' });
    let payload = {};
    try { payload = await r.json(); } catch {}
    if (!r.ok) throw new Error(payload.error || `결제 준비에 실패했습니다. (${r.status})`);
    return payload;
  }

  async function mountToss(s) {
    primaryProvider = 'toss';
    hide(els.loadingState);
    hide(els.hostedCheckout);
    show(els.tossCheckout);
    clearError();

    const prepared = await prepare('toss');
    if (prepared.mode !== 'toss_widget') throw new Error('TossPayments 주문서형 결제 설정을 확인해 주세요.');
    if (!window.TossPayments) throw new Error('TossPayments 공식 SDK를 불러오지 못했습니다.');

    const tossPayments = TossPayments(prepared.client_key);
    tossWidgets = tossPayments.widgets({ customerKey: TossPayments.ANONYMOUS });

    await tossWidgets.setAmount({
      currency: prepared.payload.currency,
      value: prepared.payload.amount,
    });

    await Promise.all([
      tossWidgets.renderPaymentMethods({
        selector: '#toss-payment-method',
        variantKey: prepared.payload.paymentVariantKey || 'DEFAULT',
      }),
      tossWidgets.renderAgreement({
        selector: '#toss-agreement',
        variantKey: prepared.payload.agreementVariantKey || 'AGREEMENT',
      }),
    ]);

    els.tossPayButton.disabled = false;
    els.tossPayButton.onclick = async () => {
      if (busy || !tossWidgets) return;
      busy = true;
      clearError();
      els.tossPayButton.disabled = true;
      els.tossPayButton.setAttribute('aria-busy', 'true');
      try {
        await tossWidgets.requestPayment({
          orderId: prepared.payload.orderId,
          orderName: prepared.payload.orderName,
          successUrl: prepared.payload.successUrl,
          failUrl: prepared.payload.failUrl,
          customerName: prepared.payload.customerName || undefined,
        });
      } catch (error) {
        const code = String(error?.code || '');
        showError(paymentErrorMessage(code));
        els.tossPayButton.disabled = false;
        els.tossPayButton.removeAttribute('aria-busy');
        busy = false;
      }
    };
  }

  function hostedProviderCopy(name, s) {
    if (name === 'stripe') {
      return {
        name: 'Stripe Checkout',
        title: s.country === 'KR' ? '해외 카드로 결제' : '카드 · 현지 결제수단',
        copy: 'Stripe가 제공하는 보안 Checkout에서 사용 가능한 카드 및 현지 결제수단을 선택합니다.',
        button: 'Stripe Checkout에서 계속',
      };
    }
    if (name === 'mock') {
      return {
        name: 'PAYHUB TEST',
        title: '테스트 결제',
        copy: '실제 결제 없이 PayHub의 결제 완료 흐름만 확인합니다.',
        button: '테스트 결제 완료',
      };
    }
    return { name, title: '결제 계속하기', copy: '결제사 화면에서 결제를 완료합니다.', button: '계속' };
  }

  function showHostedProvider(name, s) {
    primaryProvider = name;
    hide(els.loadingState);
    hide(els.tossCheckout);
    show(els.hostedCheckout);
    clearError();
    const copy = hostedProviderCopy(name, s);
    els.hostedProviderName.textContent = copy.name;
    $('#hostedCheckoutTitle').textContent = copy.title;
    els.hostedCheckoutCopy.textContent = copy.copy;
    els.hostedPayButton.textContent = copy.button;
    els.hostedPayButton.onclick = () => startRedirectProvider(name);
  }

  async function startRedirectProvider(name) {
    if (busy) return;
    busy = true;
    clearError();
    const button = name === primaryProvider ? els.hostedPayButton : document.querySelector(`[data-provider="${CSS.escape(name)}"]`);
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      const prepared = await prepare(name);
      if (prepared.mode !== 'redirect' || !prepared.url) throw new Error('결제사 이동 URL을 받지 못했습니다.');
      location.assign(prepared.url);
    } catch (error) {
      showError(error.message || String(error));
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
      busy = false;
    }
  }

  function renderAlternatives(s, providers) {
    const alternatives = providers.filter((name) => name !== primaryProvider);
    els.alternateProviders.innerHTML = '';
    if (!alternatives.length) {
      hide(els.alternateSection);
      return;
    }

    for (const name of alternatives) {
      const copy = hostedProviderCopy(name, s);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = name === 'mock' ? 'alternate-button test-provider' : 'alternate-button';
      button.dataset.provider = name;
      button.innerHTML = `<span><strong>${escapeHTML(copy.title)}</strong><small>${escapeHTML(copy.name)}</small></span><span class="alternate-arrow" aria-hidden="true">›</span>`;
      button.addEventListener('click', async () => {
        if (name === 'toss') {
          try {
            show(els.loadingState);
            hide(els.hostedCheckout);
            await mountToss(s);
            renderAlternatives(s, providers);
          } catch (error) {
            hide(els.loadingState);
            showError(tossSetupMessage(error));
          }
          return;
        }
        await startRedirectProvider(name);
      });
      els.alternateProviders.appendChild(button);
    }
    show(els.alternateSection);
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function tossSetupMessage(error) {
    const code = String(error?.code || '');
    if (code === 'NOT_SUPPORTED_API_INDIVIDUAL_KEY') {
      return 'TossPayments 주문서형 결제 연동 키(Client Key: gck 계열)가 필요합니다. PayHub 프로젝트의 TossPayments 키를 확인해 주세요.';
    }
    if (code === 'INVALID_CLIENT_KEY') {
      return 'TossPayments Client Key가 올바르지 않습니다. PayHub 프로젝트 설정을 확인해 주세요.';
    }
    if (code === 'NOT_REGISTERED_PAYMENT_WIDGET') {
      return 'TossPayments 상점관리자에서 이 연동 키에 사용할 결제 UI를 먼저 추가해 주세요.';
    }
    return error?.message || 'TossPayments 결제 UI를 불러오지 못했습니다.';
  }

  async function load() {
    setBuildVersion();
    if (!API_BASE) throw new Error('PayHub API 설정이 없습니다.');
    if (!sessionId) throw new Error('결제 세션이 없습니다.');

    const r = await api(`/api/public/sessions/${encodeURIComponent(sessionId)}`);
    if (!r.ok) {
      let body = '';
      try { body = await r.text(); } catch {}
      throw new Error(body || '결제 세션을 불러오지 못했습니다.');
    }

    session = await r.json();
    renderSummary(session);
    renderReturnState();

    if (session.status === 'PAID') {
      hide(els.loadingState);
      show(els.paidState);
      return;
    }

    const providers = Array.isArray(session.providers) ? session.providers : [];
    if (!providers.length) {
      hide(els.loadingState);
      showError('현재 사용할 수 있는 결제수단이 없습니다. 판매처에 문의해 주세요.');
      return;
    }

    const preferToss = session.country === 'KR' && session.currency === 'KRW' && providers.includes('toss');
    if (preferToss) {
      try {
        await mountToss(session);
      } catch (error) {
        hide(els.loadingState);
        hide(els.tossCheckout);
        showError(tossSetupMessage(error));
        const fallback = providers.find((name) => name !== 'toss');
        if (fallback) showHostedProvider(fallback, session);
      }
    } else {
      const primary = providers.includes('stripe') ? 'stripe' : providers[0];
      showHostedProvider(primary, session);
    }

    renderAlternatives(session, providers);
  }

  load().catch((error) => {
    hide(els.loadingState);
    els.title.textContent = '결제를 열 수 없습니다';
    els.summaryDescription.textContent = '결제 정보를 다시 확인해 주세요.';
    showError(error.message || String(error));
  });
})();
