// ===================================================================
// ===== ARTÍCULOS / INVENTARIO =====
// ===================================================================
function renderArticulos(){
  const items=state.articulos||[];
  document.getElementById('articulos-content').innerHTML=`
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div class="search-bar" style="flex:1;max-width:400px;margin:0"><span class="search-icon">🔍</span><input type="text" id="art-search" placeholder="Buscar artículo..." oninput="renderArticulosList()"></div>
      <div class="btn-group">
        <button class="btn btn-primary" onclick="openArticuloModal()">+ Nueva Prenda</button>
        <button class="btn btn-secondary btn-sm" onclick="importarDesdeCatalogo()" style="border-color:rgba(0,229,180,.3);color:var(--accent);">⬇️ Importar</button>
        <button class="btn btn-secondary btn-sm" onclick="showPage('config');setCfgTab('inventario')" title="Configurar categorías">⚙️ Categorías</button>
      </div>
    </div>
    <div class="card"><div class="card-title">CATÁLOGO DE PRENDAS (${items.length})</div>
      <div class="table-wrap"><table><thead><tr><th>Foto</th><th>Referencia</th><th>Nombre</th><th>Categoría</th><th>Título</th><th>Proveedor</th><th>P.Compra</th><th>P.Venta</th><th>Stock</th><th>Min</th><th></th></tr></thead><tbody id="art-tbody"></tbody></table></div>
    </div>`;
  renderArticulosList();
}

function renderArticulosList(){
  const search=(document.getElementById('art-search')?.value||'').toLowerCase();
  let items=(state.articulos||[]).filter(a=>(a.nombre+a.codigo+a.categoria).toLowerCase().includes(search));
  const artTbody = document.getElementById('art-tbody'); if(!artTbody) return;
  artTbody.innerHTML=items.map(a=>{
    const stock=getArticuloStock(a.id);const low=stock<=a.stockMinimo;
    const thumb = a.imagen ? `<div style="width:36px;height:36px;border-radius:8px;background:url('${a.imagen}') center/cover;border:1px solid var(--border)"></div>` : `<div style="font-size:24px">👙</div>`;
   const tituloLabel = {propia:'🏷️ Propia',contado:'💵 Contado',credito:'💳 Crédito'};
   return `<tr>
        <td style="width:50px">${thumb}</td>
        <td>${a.codigo || '—'}</td>
        <td style="font-weight:700">${a.nombre}</td>
        <td><span class="badge badge-info">${a.categoria || '—'}</span></td>
        <td>${a.tituloMercancia ? `<span class="badge badge-warn">${tituloLabel[a.tituloMercancia]||a.tituloMercancia}</span>` : '—'}</td>
        <td style="font-size:11px;color:var(--text2)">${a.proveedorNombre||'—'}</td>
        <td>${fmt(a.precioCompra)}</td>
        <td style="color:var(--accent); font-weight:700">${fmt(a.precioVenta)}</td>
        <td style="color:${low ? 'var(--red)' : 'var(--green)'}; font-weight:700">${stock}</td>
        <td>${a.stockMinimo}</td>
        <td>
          <div class="btn-group">
            <button class="btn btn-xs btn-secondary" onclick="generateProductQR('${a.id}')" title="Generar QR">📱 QR</button>
            <button class="btn btn-xs btn-secondary" onclick="openArticuloModal('${a.id}')" title="Editar">✏️</button>
            <button class="btn btn-xs btn-danger" onclick="deleteArticulo('${a.id}')" title="Eliminar">✕</button>
          </div>
        </td>
      </tr>`;
    }).join('');
}

async function deleteArticulo(id){
  const art = (state.articulos || []).find(a => a.id === id);
  if(!art) return;

  if(!confirm(`¿Eliminar "${art.nombre}"? Esta acción no se puede deshacer.`)) return;

  try {
    showLoadingOverlay('connecting');

    if (_sbConnected) {
      if (!supabaseClient || typeof supabaseClient.rpc !== 'function') {
        throw new Error('Supabase client no disponible para RPC delete_product_full');
      }
      const { error } = await supabaseClient.rpc('delete_product_full', { p_product_id: id });
      if (error) throw error;
    }

    state.articulos = (state.articulos || []).filter(a => a.id !== id);
    state.pos_cart = (state.pos_cart || []).filter(i => i.articuloId !== id);
    state.inv_movimientos = (state.inv_movimientos || []).filter(m => m.articuloId !== id);
    state.inv_ajustes = (state.inv_ajustes || []).filter(a => a.articuloId !== id);
    state.inv_traslados = (state.inv_traslados || []).filter(t => t.articuloId !== id);

    renderArticulosList();
    renderDashboard();
    updateNavBadges();

    showLoadingOverlay('hide');
    notify('success', '🗑️', 'Artículo eliminado', art.nombre, { duration: 2500 });
  } catch (err) {
    showLoadingOverlay('hide');
    console.error('deleteArticulo error:', err);
    notify('danger', '⚠️', 'Error eliminando artículo', err.message || 'Revisa consola', { duration: 5000 });
  }
}
  
// ===================================================================
// ===== MAQUETADOR PRO (MODO CATÁLOGO + ERP INTEGRADO) =====
// ===================================================================

function openArticuloModal(id){
    const art = id ? (state.articulos || []).find(a => a.id === id) : null;
    // Cargar imágenes existentes del artículo en la galería temporal
    // Load images: from state first, then from product_media if empty
    _tempGaleria = art ? [...(art.images || art.galeria || [])] : [];
    // If existing article has no images in state, try to fetch from product_media
    if(art && _tempGaleria.length === 0) {
      supabaseClient.from('product_media').select('url,is_cover').eq('product_id', art.id)
        .then(({data}) => {
          if(data && data.length > 0) {
            _tempGaleria = data.sort((a,b)=>(b.is_cover?1:0)-(a.is_cover?1:0)).map(m=>m.url);
            const artInState = state.articulos.find(a=>a.id===art.id);
            if(artInState) { artInState.images = _tempGaleria; artInState.imagen = _tempGaleria[0]||''; }
            renderGaleriaVisual();
          }
        }).catch(()=>{});
    }
    _portadaIndex = 0;
    window._galeriaModificada = false;
    // Flag para saber si es edición (preservar imágenes si no se tocan)
    window._editingArticuloId = id || null; 
    
    openModal(`
        <div class="modal-title" style="font-family:'Syne'; letter-spacing:1px;">🚀 MAQUETADOR DE PRENDA PROFESIONAL</div>
        <div style="max-height: 75vh; overflow-y: auto; padding-right: 10px; text-align:left;">
            
            <div style="background:rgba(255,255,255,0.03); padding:20px; border-radius:12px; border:1px solid var(--border); margin-bottom:20px;">
                <label class="form-label">📸 GALERÍA MULTIMEDIA</label>
                <div style="background:var(--bg); border:1px dashed var(--accent); padding:20px; text-align:center; border-radius:8px; position:relative; cursor:pointer;">
                    <span style="font-size:20px;">📤 Subir Fotos / Videos</span><br>
                    <span style="font-size:10px; opacity:0.6;">Toca la ⭐ para elegir la foto de portada.</span>
                    <input type="file" multiple accept="image/*,video/*" style="position:absolute; inset:0; opacity:0; cursor:pointer;" onchange="uploadGalleryImages(this)">
                </div>
                <div id="m-art-galeria-visual" style="display:flex; gap:10px; flex-wrap:wrap; margin-top:15px;"></div>
            </div>

            <div class="form-row">
                <div class="form-group"><label class="form-label">REFERENCIA (REF)</label><input class="form-control" id="m-art-codigo" value="${art?.codigo || ''}"></div>
                <div class="form-group"><label class="form-label">COLECCIÓN / TEMPORADA</label><input class="form-control" id="m-art-coleccion" value="${art?.coleccion || ''}" placeholder="Ej: Verano 2026"></div>
            </div>

            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">SECCIÓN WEB</label>
                    <select class="form-control" id="m-art-seccion" onchange="actualizarCatsERP()">
                        ${(state.cfg_secciones && state.cfg_secciones.length > 0
                          ? state.cfg_secciones
                          : [{nombre:'Trajes de Baño'},{nombre:'Resort & Pijamas'},{nombre:'Activewear'},{nombre:'Casual'}]
                        ).map(s => `<option value="${s.nombre}" ${art?.seccion === s.nombre ? 'selected' : ''}>${s.nombre}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group"><label class="form-label">CATEGORÍA</label><select class="form-control" id="m-art-cat"></select></div>
            </div>

            <div class="form-group"><label class="form-label">NOMBRE COMERCIAL</label><input class="form-control" id="m-art-nombre" value="${art?.nombre || ''}"></div>
            <div class="form-group"><label class="form-label">DESCRIPCIÓN (Para el Catálogo)</label><textarea class="form-control" id="m-art-desc" rows="2">${art?.descripcion || ''}</textarea></div>

            <div class="form-row">
                <div class="form-group"><label class="form-label">TALLAS</label><input class="form-control" id="m-art-tallas" value="${art?.tallas || (art ? '' : 'S, M, L, XL')}"></div>
                <div class="form-group"><label class="form-label">COLORES</label><input class="form-control" id="m-art-colores" value="${art ? (art.colores||art.colors?.join(', ')||'') : ''}"></div>
            </div>

            <div class="form-group"><label class="form-label">TÍTULO DE MERCANCÍA</label>
                    <select class="form-control" id="m-art-titulo-mercancia">
                        <option value="" ${!art?.tituloMercancia ? 'selected' : ''}>— Seleccionar —</option>
                        <option value="propia" ${art?.tituloMercancia === 'propia' ? 'selected' : ''}>🏷️ Mercancía Propia</option>
                        <option value="contado" ${art?.tituloMercancia === 'contado' ? 'selected' : ''}>💵 Mercancía de Contado</option>
                        <option value="credito" ${art?.tituloMercancia === 'credito' ? 'selected' : ''}>💳 Mercancía a Crédito</option>
                    </select>
                </div>

            <div class="card-title" style="margin-top:10px; border-top:1px solid var(--border); padding-top:15px; color:var(--accent);">💰 INVENTARIO Y PRECIOS</div>
            <div class="form-row-3">
                <div class="form-group"><label class="form-label">COSTO</label><input type="number" class="form-control" id="m-art-pc" value="${art?.precioCompra || 0}"></div>
                <div class="form-group"><label class="form-label">P. MAYORISTA</label><input type="number" class="form-control" id="m-art-pv" value="${art?.precioVenta || 0}"></div>
                <div class="form-group"><label class="form-label">IVA %</label><input type="number" class="form-control" id="m-art-iva" value="${art?.iva ?? 19}"></div>
            </div>
            <div class="form-group"><label class="form-label">🏭 PROVEEDOR</label>
                <select class="form-control" id="m-art-proveedor">
                    <option value="">— Sin proveedor —</option>
                    ${(state.usu_proveedores||[]).map(p => `<option value="${p.id}" ${art?.proveedorId === p.id ? 'selected' : ''}>${p.nombre}${p.cedula ? ' · ' + p.cedula : ''}</option>`).join('')}
                </select>
                ${(state.usu_proveedores||[]).length === 0 ? '<span style="font-size:10px;color:var(--text2)">Sin proveedores. <a onclick="closeModal();showPage(\'usu_proveedores\')" style="color:var(--accent);cursor:pointer">→ Crear proveedor</a></span>' : ''}
            </div>
            <div class="form-group" style="margin-top: 15px; padding: 10px; background: rgba(0,255,170,0.1); border-radius: 8px;">
  <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; color: var(--text1); font-weight: bold;">
    <input type="checkbox" id="art-mostrar-web" style="width: 18px; height: 18px;"> 
    🌐 Mostrar esta prenda en el Catálogo Web (Supabase)
  </label>
</div>

            <div class="form-row">
                <div class="form-group"><label class="form-label">BODEGA</label><select class="form-control" id="m-art-bodega">${(state.bodegas || []).map(b => '<option value="' + b.id + '">' + b.name + '</option>').join('')}</select></div>
                <div class="form-group">
                  <label class="form-label">${art ? 'STOCK ACTUAL' : 'STOCK INICIAL'}</label>
                  <input type="number" class="form-control" id="m-art-stock0"
                    value="${art ? (art.stock||0) : 0}"
                    ${art ? 'readonly style="opacity:0.5;cursor:not-allowed"' : 'min="0"'}>
                  ${art ? '<div style="font-size:10px;color:var(--text2);margin-top:3px">Para ajustar el stock usa: Inventario → Ajustes</div>' : ''}
                </div>
            </div>
        </div>
        <button class="btn btn-primary" style="width:100%; margin-top:15px; font-weight:800;" onclick="saveArticulo('${id || ''}')">💾 GUARDAR Y ACTUALIZAR WEB</button>
    `, true);
  setTimeout(() => { document.getElementById('art-mostrar-web').checked = art ? (art.mostrarEnWeb !== false) : true; }, 10);
    actualizarCatsERP(art?.cat);
    renderGaleriaVisual();
}

function removeMainImg(){
    document.getElementById('m-art-img-preview-container').style.display = 'none';
}

function renderGaleriaVisual(){
    const container = document.getElementById('m-art-galeria-visual');
    if(!container) return;
    container.innerHTML = _tempGaleria.map((url, idx) => {
        const esVideo = url.split('?')[0].toLowerCase().match(/\.(mp4|mov|webm|avi)$/);
        const media = esVideo 
            ? `<video src="${url}" style="width:100%; height:100%; object-fit:cover;"></video>`
            : `<img src="${url}" style="width:100%; height:100%; object-fit:cover;">`;
        return `
            <div style="position:relative; width:72px; height:96px; border-radius:6px; overflow:hidden; border:2px solid ${idx === _portadaIndex ? 'var(--accent)' : 'transparent'}; cursor:pointer;" onclick="_portadaIndex=${idx}; window._galeriaModificada=true; renderGaleriaVisual();">
                ${media}
                <button class="btn-danger" style="position:absolute; top:2px; right:2px; width:18px; height:18px; border-radius:50%; border:none; font-size:9px;" onclick="event.stopPropagation(); _tempGaleria.splice(${idx},1); window._galeriaModificada=true; if(_portadaIndex>=${idx})_portadaIndex=0; renderGaleriaVisual();">✕</button>
                <div style="position:absolute; bottom:2px; left:2px; background:${idx === _portadaIndex ? 'var(--accent)' : 'rgba(0,0,0,0.5)'}; color:#000; border-radius:50%; width:18px; height:18px; display:flex; align-items:center; justify-content:center; font-size:10px;">⭐</div>
            </div>`;
    }).join('');
}

function actualizarCatsERP(selectedCat){
    const sec = document.getElementById('m-art-seccion').value;
    const cat = document.getElementById('m-art-cat');

    // ★ Usar categorías del ERP (cfg_categorias) si están disponibles
    const cfgCats = (state.cfg_categorias || []).filter(c => c.seccion === sec);
    let opciones = [];
    if(cfgCats.length > 0) {
      opciones = cfgCats.map(c => c.nombre);
    } else {
      // Fallback hardcoded
      if(sec === 'Trajes de Baño') opciones = ['Enterizos','Bikinis','Tankinis','Asoleadores','Salidas de Baño','3 Piezas'];
      else if(sec === 'Pijamas' || sec === 'Resort & Pijamas') opciones = ['Batas','Pantalones Largos','Shorts','Sets 2 Piezas'];
      else if(sec === 'Ropa Deportiva' || sec === 'Activewear') opciones = ['Leggings','Tops','Conjuntos'];
      else opciones = ['Vestidos','Faldas','Tops','Pantalones'];
    }

    cat.innerHTML = opciones.map(o => `<option value="${o}" ${selectedCat === o ? 'selected' : ''}>${o}</option>`).join('');
}

const WEBP_QUALITY = 0.92;
const WEBP_MAX_WIDTH = null; // sin resize por defecto (premium)

async function compressToWebP(file, maxWidth = WEBP_MAX_WIDTH, quality = WEBP_QUALITY) {
  // Fallback seguro: si algo falla, retorna el archivo original (no bloquea publicación)
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;
          if (maxWidth && width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) return resolve(file);
              const newName = file.name.replace(/\.[^/.]+$/, '') + '.webp';
              resolve(new File([blob], newName, { type: 'image/webp' }));
            },
            'image/webp',
            quality,
          );
        } catch (_) {
          resolve(file);
        }
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

async function uploadGalleryImages(input) {
  const files = input.files;
  if (!files.length) return;

  showLoadingOverlay('connecting');

  try {
    let added = 0;
    for (let i = 0; i < files.length; i++) {
      if (_tempGaleria.length >= 15) break;
      let file = files[i];

      if (file.type.startsWith('image/')) {
        file = await compressToWebP(file, WEBP_MAX_WIDTH, WEBP_QUALITY);
      }

      const safeName = file.name.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
      const fileName = `products/temp/${Date.now()}_${safeName}`;

      const { error: uploadError } = await supabaseClient.storage
        .from('Catalog-media')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabaseClient.storage
        .from('Catalog-media')
        .getPublicUrl(fileName);

      _tempGaleria.push(publicUrl);
      window._galeriaModificada = true;
      added++;
    }

    renderGaleriaVisual();
    showLoadingOverlay('hide');
    notify('success', '📸', 'Completado', `Subidos ${added} archivos.`);

  } catch (e) {
    showLoadingOverlay('hide');
    notify('danger', '⚠️', 'Error', e.message);
  }
}
async function saveArticulo(existingId) {
    const nombre = document.getElementById('m-art-nombre').value.trim();
    const refID = document.getElementById('m-art-codigo').value.trim().toUpperCase();
    
    if(!nombre || !refID) return alert('Nombre y Referencia son obligatorios.');

    // Preparamos el objeto EXACTO para la tabla 'products' de Supabase
    const tituloMercancia = document.getElementById('m-art-titulo-mercancia')?.value || '';
    const proveedorId = document.getElementById('m-art-proveedor')?.value || null;
    const proveedorObj = proveedorId ? (state.usu_proveedores||[]).find(p=>p.id===proveedorId) : null;

    const productData = {
        id: existingId || crypto.randomUUID(),
        ref: refID,
        name: nombre,
        seccion: document.getElementById('m-art-seccion').value,
        categoria: document.getElementById('m-art-cat').value,
        description: document.getElementById('m-art-desc').value.trim(),
        price: parseFloat(document.getElementById('m-art-pv').value) || 0,
        cost: parseFloat(document.getElementById('m-art-pc').value) || 0,
        // Nuevo producto: usa el stock inicial del formulario
        // Producto existente: mantiene el stock actual (no sobreescribir)
        stock: existingId
          ? ((state.articulos||[]).find(a=>a.id===existingId)?.stock || 0)
          : (parseInt(document.getElementById('m-art-stock0').value) || 0),
        active: true,
        visible: document.getElementById('art-mostrar-web').checked,
        titulo_mercancia: tituloMercancia || null,
        proveedor_id: proveedorId || null,
        proveedor_nombre: proveedorObj?.nombre || null,
        updated_at: new Date().toISOString()
    };

    const productId = productData.id;

    try {
        showLoadingOverlay('connecting');
        
        // 1. UPSERT del producto
        const { error } = await supabaseClient
            .from('products')
            .upsert(productData, { onConflict: 'id' });
        if (error) throw error;

        // 1b. Solo en alta: stock inicial → un inv_ajuste. En edición el stock del modal es solo lectura.
        const stockInicial = parseInt(document.getElementById('m-art-stock0')?.value)||0;
        if (!existingId && stockInicial > 0) {
          const ajId = uid();
          try {
            await supabaseClient.from('inv_ajustes').insert({
              id: ajId, articulo_id: productId, bodega_id: 'bodega_main',
              tipo: 'entrada', cantidad: stockInicial,
              motivo: 'Stock inicial al crear artículo',
              fecha: today()
            });
            if(!state.inv_ajustes) state.inv_ajustes = [];
            state.inv_ajustes.push({id:ajId, articuloId:productId, bodegaId:'bodega_main',
              tipo:'entrada', cantidad:stockInicial,
              motivo: 'Stock inicial', fecha:today()});
            if(!state.inv_movimientos) state.inv_movimientos = [];
            state.inv_movimientos.push({id:'aj_'+ajId, articuloId:productId,
              bodegaId:'bodega_main', cantidad:stockInicial, tipo:'ajuste_entrada',
              fecha:today(), referencia:'Ajuste', nota:'Stock inicial'});
          } catch(e) { console.warn('inv_ajuste stock error:', e.message); }
        }

        // 2. MANEJAR IMÁGENES en product_media - solo si hubo cambios reales
        if(window._galeriaModificada || !existingId) {
          // Obtener imágenes actuales en BD
          const { data: existingMedia } = await supabaseClient
            .from('product_media')
            .select('id, url, is_cover')
            .eq('product_id', productId);

          const existingUrls = (existingMedia||[]).map(m => m.url);
          const newUrls = _tempGaleria;

          // Eliminar las que ya no están en _tempGaleria
          const toDelete = (existingMedia||[]).filter(m => !newUrls.includes(m.url));
          for(const m of toDelete) {
            await supabaseClient.from('product_media').delete().eq('id', m.id);
          }

          // Insertar las nuevas (que no existían antes)
          const toInsert = newUrls.filter(url => !existingUrls.includes(url));
          for(let i = 0; i < toInsert.length; i++) {
            const url = toInsert[i];
            const isCover = newUrls.indexOf(url) === _portadaIndex;
            await supabaseClient.from('product_media').insert({
              product_id: productId,
              url: url,
              is_cover: isCover
            });
          }

          // Actualizar is_cover si cambió la portada
          if(existingMedia && existingMedia.length > 0) {
            const coverUrl = newUrls[_portadaIndex];
            for(const m of existingMedia) {
              const shouldBeCover = m.url === coverUrl;
              if(m.is_cover !== shouldBeCover) {
                await supabaseClient.from('product_media')
                  .update({ is_cover: shouldBeCover })
                  .eq('id', m.id);
              }
            }
          }
        }

        // 3. GUARDAR TALLAS en product_sizes
        const tallasStr = document.getElementById('m-art-tallas')?.value || '';
        if(tallasStr.trim()) {
          // Borrar tallas anteriores
          await supabaseClient.from('product_sizes').delete().eq('product_id', productId);
          // Insertar nuevas
          for(const tallaLabel of tallasStr.split(',').map(t=>t.trim()).filter(Boolean)) {
            let { data: size } = await supabaseClient.from('sizes').select('id').eq('label', tallaLabel).single();
            if(!size) {
              const { data: ns } = await supabaseClient.from('sizes').insert([{label: tallaLabel}]).select().single();
              size = ns;
            }
            if(size) await supabaseClient.from('product_sizes').insert([{product_id: productId, size_id: size.id}]);
          }
        }

        // 4. GUARDAR COLORES en product_colors
        const coloresStr = document.getElementById('m-art-colores')?.value || '';
        if(coloresStr.trim()) {
          // Borrar colores anteriores
          await supabaseClient.from('product_colors').delete().eq('product_id', productId);
          // Insertar nuevos
          for(const colorLabel of coloresStr.split(',').map(c=>c.trim()).filter(Boolean)) {
            let { data: color } = await supabaseClient.from('colors').select('id').eq('label', colorLabel).single();
            if(!color) {
              const { data: nc } = await supabaseClient.from('colors').insert([{code: colorLabel.toLowerCase().replace(/\s+/g,'_'), label: colorLabel}]).select().single();
              color = nc;
            }
            if(color) await supabaseClient.from('product_colors').insert([{product_id: productId, color_id: color.id}]);
          }
        }

        // 5. Actualizar state local inmediatamente
        const artIdx = state.articulos.findIndex(a => a.id === productId);
        const artLocal = {
          id: productId, codigo: refID, ref: refID, nombre: nombre, name: nombre,
          categoria: productData.categoria, seccion: productData.seccion,
          descripcion: productData.description,
          precioVenta: productData.price, price: productData.price,
          precioCompra: productData.cost,
          tallas: tallasStr, sizes: tallasStr,
          colores: coloresStr, colors: coloresStr.split(',').map(c=>c.trim()).filter(Boolean),
          images: window._galeriaModificada ? _tempGaleria : (existingId ? ((state.articulos.find(a=>a.id===productId)||{}).images || _tempGaleria) : _tempGaleria),
          imagen: window._galeriaModificada ? (_tempGaleria[_portadaIndex]||_tempGaleria[0]||'') : (existingId ? ((state.articulos.find(a=>a.id===productId)||{}).imagen || _tempGaleria[0] || '') : (_tempGaleria[_portadaIndex]||_tempGaleria[0]||'')),
          stock: productData.stock, stockMinimo: 0,
          activo: true, mostrarEnWeb: productData.visible,
          tituloMercancia: tituloMercancia,
          proveedorId: proveedorId||null, proveedorNombre: proveedorObj?.nombre||''
        };
        if(artIdx >= 0) state.articulos[artIdx] = artLocal;
        else state.articulos.push(artLocal);

        // 6. Publicación profesional: ERP → Catálogo mayoristas → Push FCM (solo si sync ok y cambio relevante)
        try {
          if (productData.visible && typeof window.mayoristasPublishCatalogProduct === 'function') {
            const res = await window.mayoristasPublishCatalogProduct({
              product: {
                id: productData.id,
                ref: productData.ref,
                name: productData.name,
                description: productData.description,
                price: productData.price,
                stock: productData.stock,
                seccion: productData.seccion,
                categoria: productData.categoria,
                visible: !!productData.visible,
                active: productData.active !== false,
                updated_at: productData.updated_at,
              },
              images: (window._galeriaModificada || !existingId) ? _tempGaleria : (artLocal.images || _tempGaleria),
              notifyTitle: 'Nueva Colección 🌊',
              notifyBody: `"${productData.name}" ya está disponible en el catálogo.`,
              notifyLink: window.location.origin + window.location.pathname,
              notifyImage: ((window._galeriaModificada || !existingId) ? (_tempGaleria[_portadaIndex] || _tempGaleria[0] || '') : (artLocal.imagen || '')),
            });
            if (!res?.ok) {
              console.warn('[Mayoristas publish]', res?.error || 'unknown_error', res);
            }
          }
        } catch (err) {
          console.warn('[Mayoristas publish] exception:', err?.message || String(err));
        }

        closeModal();
        renderArticulos();
        showLoadingOverlay('hide');
        notify('success', '✅', 'Guardado', `${refID} guardado con tallas y colores.`);

    } catch(e) {
        showLoadingOverlay('hide');
        alert("Error al guardar: " + e.message);
    }
}
  
