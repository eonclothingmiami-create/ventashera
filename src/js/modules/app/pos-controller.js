// POS controller layer: form state sync and shipping UI behavior.
(function initPosController(global) {
  function syncFormState(state, posFormState) {
    const c = document.getElementById('pos-canal'); if (c) posFormState.canal = c.value;
    const e = document.getElementById('pos-empresa'); if (e) posFormState.empresa = e.value;
    const t = document.getElementById('pos-transportadora'); if (t) posFormState.transportadora = t.value;
    const g = document.getElementById('pos-guia'); if (g) posFormState.guia = g.value;
    const ci = document.getElementById('pos-ciudad'); if (ci) posFormState.ciudad = ci.value;
    const cl = document.getElementById('pos-cliente'); if (cl) posFormState.cliente = cl.value;
    const tel = document.getElementById('pos-telefono'); if (tel) posFormState.telefono = tel.value;
    const m = document.getElementById('pos-metodo-pago'); if (m) posFormState.metodo = m.value;
    const cta = document.getElementById('pos-cuenta'); if (cta) posFormState.cuenta = cta.value;
    const iva = document.getElementById('pos-apply-iva'); if (iva) posFormState.applyIva = iva.checked;
    const fleteChk = document.getElementById('pos-apply-flete'); if (fleteChk) posFormState.applyFlete = fleteChk.checked;
    const fleteVal = document.getElementById('pos-flete-valor'); if (fleteVal) posFormState.flete = parseFloat(fleteVal.value) || 0;
    const tipoPagoEl = document.getElementById('pos-tipo-pago'); if (tipoPagoEl) posFormState.tipoPago = tipoPagoEl.value;
    const montoRec = document.getElementById('pos-monto-recibido'); if (montoRec) posFormState.montoRecibido = parseFloat(montoRec.value) || '';
    const posBod = document.getElementById('pos-bodega'); if (posBod) { posFormState.bodegaId = posBod.value; try { global.AppCajaLogic?.setPosBodegaId?.(posBod.value); } catch (e) {} }
    const posCaja = document.getElementById('pos-caja'); if (posCaja) { posFormState.cajaId = posCaja.value; try { global.AppCajaLogic?.setPosCajaId?.(posCaja.value); } catch (e) {} }
    (document.querySelectorAll('[data-pos-price-idx]') || []).forEach((inp) => {
      const idx = parseInt(inp.getAttribute('data-pos-price-idx'), 10);
      if (Number.isInteger(idx) && state.pos_cart && state.pos_cart[idx]) {
        state.pos_cart[idx].precio = parseFloat(inp.value) || 0;
      }
    });
  }

  function toggleIVA(posFormState, renderPOS) {
    const checkbox = document.getElementById('pos-apply-iva');
    if (checkbox) {
      posFormState.applyIva = checkbox.checked;
      renderPOS();
    }
  }

  function toggleFlete(posFormState, renderPOS) {
    const checkbox = document.getElementById('pos-apply-flete');
    if (checkbox) posFormState.applyFlete = checkbox.checked;
    const val = document.getElementById('pos-flete-valor');
    if (val) posFormState.flete = parseFloat(val.value) || 0;
    renderPOS();
  }

  function handleShippingUI(state, posFormState) {
    const canalEl = document.getElementById('pos-canal');
    if (!canalEl) return;
    const canal = canalEl.value;
    posFormState.canal = canal;
    const container = document.getElementById('pos-shipping-fields');
    const empresaSel = document.getElementById('pos-empresa');
    const liqInfo = document.getElementById('pos-liq-info');
    const transSel = document.getElementById('pos-transportadora');
    if (!container || !empresaSel || !liqInfo || !transSel) return;

    if (canal === 'vitrina') {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    if (canal === 'local') {
      empresaSel.innerHTML = `<option value="">— Mensajería Local —</option><option value="MensLocal" ${posFormState.empresa === 'MensLocal' ? 'selected' : ''}>Mensajería Propia</option><option value="Rappi" ${posFormState.empresa === 'Rappi' ? 'selected' : ''}>Rappi</option><option value="Picap" ${posFormState.empresa === 'Picap' ? 'selected' : ''}>Picap</option>`;
      transSel.style.display = 'none';
      liqInfo.textContent = '⚡ Liquidación al día siguiente hábil.';
    } else if (canal === 'inter') {
      empresaSel.innerHTML = `<option value="">— Plataforma / Directo —</option><option value="HEKA" ${posFormState.empresa === 'HEKA' ? 'selected' : ''}>HEKA</option><option value="DROPI" ${posFormState.empresa === 'DROPI' ? 'selected' : ''}>Dropi</option><option value="Directo" ${posFormState.empresa === 'Directo' ? 'selected' : ''}>Directo / Otra</option>`;
      transSel.style.display = 'block';
      liqInfo.textContent = `📦 Liquidación en ${state.diasInter} días hábiles.`;
    }
  }

  function handleEmpresa(posFormState) {
    const empresaEl = document.getElementById('pos-empresa');
    if (!empresaEl) return;
    posFormState.empresa = empresaEl.value;
  }

  global.AppPosController = {
    syncFormState,
    toggleIVA,
    toggleFlete,
    handleShippingUI,
    handleEmpresa
  };
})(window);
