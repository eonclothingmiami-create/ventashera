// POS controller layer: form state sync and shipping UI behavior.
(function initPosController(global) {
  function syncFormState(state, posFormState) {
    const c = document.getElementById('pos-canal'); if (c) posFormState.canal = c.value;
    const e = document.getElementById('pos-empresa'); if (e) posFormState.empresa = e.value;
    const t = document.getElementById('pos-transportadora'); if (t) posFormState.transportadora = t.value;
    const g = document.getElementById('pos-guia');
    if (g) posFormState.guia = g.value;
    else if (posFormState.canal === 'local') posFormState.guia = '';
    const ci = document.getElementById('pos-ciudad');
    if (ci) posFormState.ciudad = ci.value;
    else if (posFormState.canal === 'local') posFormState.ciudad = '';
    const cl = document.getElementById('pos-cliente'); if (cl) posFormState.cliente = cl.value;
    const tel = document.getElementById('pos-telefono'); if (tel) posFormState.telefono = tel.value;
    const m = document.getElementById('pos-metodo-pago'); if (m) posFormState.metodo = m.value;
    const cta = document.getElementById('pos-cuenta'); if (cta) posFormState.cuenta = cta.value;
    const iva = document.getElementById('pos-apply-iva'); if (iva) posFormState.applyIva = iva.checked;
    const fleteChk = document.getElementById('pos-apply-flete');
    if (fleteChk) posFormState.applyFlete = fleteChk.checked;
    else if (posFormState.canal === 'local') posFormState.applyFlete = true;
    const fleteVal = document.getElementById('pos-flete-valor'); if (fleteVal) posFormState.flete = parseFloat(fleteVal.value) || 0;
    const tipoPagoEl = document.getElementById('pos-tipo-pago'); if (tipoPagoEl) posFormState.tipoPago = tipoPagoEl.value;
    const montoRec = document.getElementById('pos-monto-recibido'); if (montoRec) posFormState.montoRecibido = parseFloat(montoRec.value) || '';
    const mixEfe = document.getElementById('pos-mixto-efectivo');
    if (mixEfe) posFormState.mixtoEfectivo = parseFloat(mixEfe.value) || 0;
    const mixTrans = document.getElementById('pos-mixto-transferencia');
    if (mixTrans) posFormState.mixtoTransferencia = parseFloat(mixTrans.value) || 0;
    const posBod = document.getElementById('pos-bodega'); if (posBod) { posFormState.bodegaId = posBod.value; try { global.AppCajaLogic?.setPosBodegaId?.(posBod.value); } catch (e) {} }
    const posCaja = document.getElementById('pos-caja'); if (posCaja) { posFormState.cajaId = posCaja.value; try { global.AppCajaLogic?.setPosCajaId?.(posCaja.value); } catch (e) {} }
    const compEl = document.getElementById('pos-comprobante');
    if (compEl) posFormState.comprobante = compEl.value;
    const cedEl = document.getElementById('pos-cedula');
    if (cedEl) posFormState.cedula = cedEl.value;
    const dirEl = document.getElementById('pos-direccion');
    if (dirEl) posFormState.direccion = dirEl.value;
    else if (posFormState.canal !== 'inter' && posFormState.canal !== 'local') posFormState.direccion = '';
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
    else if (posFormState.canal === 'local') posFormState.applyFlete = true;
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
    const transSel = document.getElementById('pos-transportadora');
    if (!container || !empresaSel || !transSel) return;

    if (canal === 'vitrina') {
      container.style.display = 'none';
      return;
    }

    container.style.display = 'flex';
    if (canal === 'local') {
      empresaSel.innerHTML = `<option value="">— Mensajería Local —</option><option value="MensLocal" ${posFormState.empresa === 'MensLocal' ? 'selected' : ''}>Mensajería Propia</option><option value="Rappi" ${posFormState.empresa === 'Rappi' ? 'selected' : ''}>Rappi</option><option value="Picap" ${posFormState.empresa === 'Picap' ? 'selected' : ''}>Picap</option>`;
      transSel.style.display = 'none';
    } else if (canal === 'inter') {
      empresaSel.innerHTML = `<option value="">— Elija plataforma * —</option><option value="HEKA" ${posFormState.empresa === 'HEKA' ? 'selected' : ''}>HEKA</option><option value="DROPI" ${posFormState.empresa === 'DROPI' ? 'selected' : ''}>Dropi</option><option value="Directo" ${posFormState.empresa === 'Directo' ? 'selected' : ''}>Directo / Otra</option>`;
      transSel.style.display = 'block';
      if (transSel.options && transSel.options[0]) transSel.options[0].text = '— Transportadora * —';
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
