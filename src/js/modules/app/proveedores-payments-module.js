// Pagos proveedores — reconstrucción (v1 esqueleto; sin escrituras ni cálculo de deuda legacy).
(function initProveedoresPaymentsModule(global) {
  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function render(ctx, mountEl) {
    const el = mountEl || document.getElementById('tes-pagos-prov-rebuild-body');
    if (!el) return;
    const state = (ctx && ctx.state) || global.state || {};
    const provs = state.usu_proveedores || [];

    el.innerHTML = `
    <div class="card" style="margin:0">
      <div class="card-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>Proveedores</span>
        <div class="btn-group">
          <button type="button" class="btn btn-secondary btn-sm" disabled title="Disponible en la siguiente fase de reconstrucción">+ Nuevo cargo</button>
          <button type="button" class="btn btn-primary btn-sm" disabled title="Disponible en la siguiente fase de reconstrucción">+ Nuevo abono</button>
        </div>
      </div>
      <p style="font-size:12px;color:var(--text2);margin:0 0 12px;line-height:1.45">Listado de referencia. Los saldos se calcularán de nuevo con el modelo simplificado (cargos − abonos).</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Proveedor</th><th style="text-align:right">Saldo</th><th>Estado</th></tr></thead>
          <tbody>
            ${
              provs.length === 0
                ? '<tr><td colspan="3" style="text-align:center;color:var(--text2);padding:20px">Sin proveedores registrados</td></tr>'
                : provs
                    .map(
                      (p) => `<tr>
                <td style="font-weight:700">${esc(p.nombre || '—')}</td>
                <td style="text-align:right;color:var(--text2)">—</td>
                <td><span class="badge badge-pend">Pendiente de reconstrucción</span></td>
              </tr>`
                    )
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </div>`;
  }

  global.AppProveedoresPayments = { render };
})(window);
