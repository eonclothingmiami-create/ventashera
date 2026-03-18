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
      await Promise.allSettled([
        supabaseClient.from('product_media').delete().eq('product_id', id),
        supabaseClient.from('product_sizes').delete().eq('product_id', id),
        supabaseClient.from('product_colors').delete().eq('product_id', id),
        supabaseClient.from('products').delete().eq('id', id)
      ]);
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

async function compressToWebP(file, maxWidth = 1080, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = event => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        // Redimensionar si es muy grande para ahorrar espacio
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          // Crear el nuevo archivo .webp
          const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
          resolve(new File([blob], newName, { type: "image/webp" }));
        }, 'image/webp', quality);
      };
      img.onerror = error => reject(error);
    };
    reader.onerror = error => reject(error);
  });
}
  
async function compressToWebP(file, maxWidth = 1080, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
          const webpFile = new File([blob], newName, { type: "image/webp" });
          resolve(webpFile);
        }, 'image/webp', quality);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
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
        file = await compressToWebP(file, 1080, 0.8);
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

        // 1b. Si hay stock, registrar ajuste de entrada en inv_ajustes
        const stockInicial = parseInt(document.getElementById('m-art-stock0')?.value)||0;
        if(stockInicial > 0) {
          const ajId = uid();
          try {
            await supabaseClient.from('inv_ajustes').insert({
              id: ajId, articulo_id: productId, bodega_id: 'bodega_main',
              tipo: 'entrada', cantidad: stockInicial,
              motivo: existingId ? 'Ajuste de stock' : 'Stock inicial al crear artículo',
              fecha: today()
            });
            if(!state.inv_ajustes) state.inv_ajustes = [];
            state.inv_ajustes.push({id:ajId, articuloId:productId, bodegaId:'bodega_main',
              tipo:'entrada', cantidad:stockInicial,
              motivo: existingId ? 'Ajuste de stock' : 'Stock inicial', fecha:today()});
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

        closeModal();
        renderArticulos();
        showLoadingOverlay('hide');
        notify('success', '✅', 'Guardado', `${refID} guardado con tallas y colores.`);

    } catch(e) {
        showLoadingOverlay('hide');
        alert("Error al guardar: " + e.message);
    }
}
  
// ===================================================================
// ===== INVENTORY TRAZABILIDAD =====
// ===================================================================
function renderInvTrazabilidad(){
  const movs=[...(state.inv_movimientos||[])].reverse();
  document.getElementById('inv_trazabilidad-content').innerHTML=`
    <div class="card"><div class="card-title">MOVIMIENTOS DE INVENTARIO (${movs.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Bodega</th><th>Tipo</th><th>Cantidad</th><th>Referencia</th><th>Nota</th></tr></thead><tbody>
    ${movs.map(m=>{const art=(state.articulos||[]).find(a=>a.id===m.articuloId);const bod=(state.bodegas||[]).find(b=>b.id===m.bodegaId);return`<tr><td>${formatDate(m.fecha)}</td><td>${art?.nombre||'—'}</td><td>${bod?.name||'—'}</td><td><span class="badge ${m.cantidad>0?'badge-ok':'badge-pend'}">${m.tipo}</span></td><td style="color:${m.cantidad>0?'var(--green)':'var(--red)'};font-weight:700">${m.cantidad>0?'+':''}${m.cantidad}</td><td>${m.referencia||'—'}</td><td style="color:var(--text2)">${m.nota||'—'}</td></tr>`}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin movimientos</td></tr>'}
    </tbody></table></div></div>`;
}

// ===================================================================
// ===== INVENTORY AJUSTES =====
// ===================================================================
function renderInvAjustes(){
  document.getElementById('inv_ajustes-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openAjusteModal()">+ Nuevo Ajuste</button>
    <div class="card"><div class="card-title">AJUSTES DE INVENTARIO</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Tipo</th><th>Cantidad</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${[...(state.inv_ajustes||[])].reverse().map(a=>{const art=(state.articulos||[]).find(x=>x.id===a.articuloId);return`<tr><td>${formatDate(a.fecha)}</td><td>${art?.nombre||'—'}</td><td><span class="badge ${a.tipo==='entrada'?'badge-ok':'badge-pend'}">${a.tipo}</span></td><td style="font-weight:700;color:${a.tipo==='entrada'?'var(--green)':'var(--red)'}">${a.tipo==='entrada'?'+':'−'}${a.cantidad}</td><td>${a.motivo||'—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarAjuste('${a.id}')">✕</button></td></tr>`}).join('')||'<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin ajustes</td></tr>'}
    </tbody></table></div></div>`;
}

async function eliminarAjuste(id) {
  if(!confirm('¿Eliminar este ajuste? El stock se revertirá automáticamente.')) return;
  const a = state.inv_ajustes.find(x => x.id === id);
  if(!a) return;

  try {
    // 1. Revertir stock en Supabase y localmente
    const art = state.articulos.find(x => x.id === a.articuloId);
    if(art) {
      const revert = a.tipo === 'entrada' ? -a.cantidad : a.cantidad;
      const newStock = Math.max(0, (art.stock||0) + revert);
      await supabaseClient.from('products').update({stock: newStock}).eq('id', a.articuloId);
      art.stock = newStock;
    }

    // 2. Borrar de inv_ajustes en Supabase
    await supabaseClient.from('inv_ajustes').delete().eq('id', id);

    // 3. Actualizar estado local
    state.inv_ajustes = state.inv_ajustes.filter(x => x.id !== id);
    const movIndex = state.inv_movimientos.findIndex(m =>
      m.articuloId === a.articuloId && m.tipo === 'ajuste_'+a.tipo && m.nota === a.motivo);
    if(movIndex !== -1) state.inv_movimientos.splice(movIndex, 1);

    renderInvAjustes();
    // Si el artículo es a crédito, actualizar pagos proveedores
    if(art?.tituloMercancia === 'credito') {
      if(document.getElementById('tes_pagos_prov-content')) renderTesPagosProv();
      updateNavBadges();
    }
    notify('success','🗑️','Ajuste eliminado',`Stock de ${art?.nombre||''} revertido.`,{duration:3000});

  } catch(err) {
    notify('danger','⚠️','Error al eliminar', err.message, {duration:5000});
    console.error('eliminarAjuste:', err);
  }
}

function openAjusteModal(){
  openModal(`
    <div class="modal-title">Nuevo Ajuste de Inventario<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">ARTÍCULO</label><select class="form-control" id="m-aj-art">${(state.articulos||[]).map(a=>'<option value="'+a.id+'">'+a.nombre+' (Stock: '+getArticuloStock(a.id)+')</option>').join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-aj-tipo"><option value="entrada">📥 Entrada</option><option value="salida">📤 Salida</option></select></div>
      <div class="form-group"><label class="form-label">CANTIDAD</label><input type="number" class="form-control" id="m-aj-cant" min="1" value="1"></div>
    </div>
    <div class="form-group"><label class="form-label">BODEGA</label><select class="form-control" id="m-aj-bod">${(state.bodegas||[]).map(b=>'<option value="'+b.id+'">'+b.name+'</option>').join('')}</select></div>
    <div class="form-group"><label class="form-label">MOTIVO</label><input class="form-control" id="m-aj-motivo" placeholder="Motivo del ajuste"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveAjusteInv()">Guardar Ajuste</button>
  `);
}

async function saveAjusteInv() {
  const artId = document.getElementById('m-aj-art').value;
  const tipo = document.getElementById('m-aj-tipo').value;
  const cant = parseInt(document.getElementById('m-aj-cant').value) || 0;
  const bodegaId = document.getElementById('m-aj-bod')?.value || 'bodega_main';
  if(!artId) { notify('warning','⚠️','Selecciona un artículo','',{duration:3000}); return; }
  if(cant <= 0) return;

  const motivo = document.getElementById('m-aj-motivo').value.trim() || 'Ajuste manual';
  const qtyFinal = tipo === 'entrada' ? cant : -cant;

  try {
    showLoadingOverlay('connecting');

    // 1. Guardar en inv_ajustes (tabla visible en el ERP)
    const ajuste = {
      id: uid(), articuloId: artId, bodegaId: bodegaId,
      tipo, cantidad: cant, motivo, fecha: today()
    };
    const { error: ajErr } = await supabaseClient.from('inv_ajustes').insert({
      id: ajuste.id, articulo_id: artId, bodega_id: bodegaId,
      tipo, cantidad: cant, motivo, fecha: today()
    });
    if(ajErr) throw ajErr;

    // 2. Actualizar stock en products
    const product = state.articulos.find(a => a.id === artId);
    if(product) {
      const newStock = Math.max(0, (product.stock||0) + qtyFinal);
      const { error: prodErr } = await supabaseClient.from('products')
        .update({ stock: newStock }).eq('id', artId);
      if(prodErr) throw prodErr;
      product.stock = newStock;
    }

    // 3. Actualizar estado local
    if(!state.inv_ajustes) state.inv_ajustes = [];
    state.inv_ajustes.push(ajuste);

    const mov = {
      id: uid(), articuloId: artId, bodegaId: bodegaId,
      cantidad: qtyFinal, tipo: 'ajuste_'+tipo,
      fecha: today(), referencia: 'Ajuste', nota: motivo
    };
    if(!state.inv_movimientos) state.inv_movimientos = [];
    state.inv_movimientos.push(mov);

    closeModal();
    renderInvAjustes();
    if(document.getElementById('art-tbody')) renderArticulosList();

    // Si el artículo es a crédito, actualizar pagos proveedores
    if(product?.tituloMercancia === 'credito') {
      if(document.getElementById('tes_pagos_prov-content')) renderTesPagosProv();
      updateNavBadges(); // actualiza alertas de deuda
    }

    showLoadingOverlay('hide');
    notify('success','✅','Ajuste guardado',
      `${tipo==='entrada'?'+':'−'}${cant} unidades · Stock actual: ${product?.stock||0}`,
      {duration:3000});

  } catch(err) {
    showLoadingOverlay('hide');
    console.error('Error ajuste:', err);
    notify('danger','⚠️','Error', err.message, {duration:5000});
  }
}
// ===================================================================
// ===== INVENTORY TRASLADOS =====
// ===================================================================
function renderInvTraslados(){
  document.getElementById('inv_traslados-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openTrasladoModal()">+ Nuevo Traslado</button>
    <div class="card"><div class="card-title">TRASLADOS</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Artículo</th><th>Origen</th><th>Destino</th><th>Cantidad</th><th>Nota</th><th></th></tr></thead><tbody>
    ${[...(state.inv_traslados||[])].reverse().map(t=>{const art=(state.articulos||[]).find(a=>a.id===t.articuloId);const o=(state.bodegas||[]).find(b=>b.id===t.origenId);const d=(state.bodegas||[]).find(b=>b.id===t.destinoId);return`<tr><td>${formatDate(t.fecha)}</td><td>${art?.nombre||'—'}</td><td>${o?.name||'—'}</td><td>${d?.name||'—'}</td><td style="font-weight:700">${t.cantidad}</td><td>${t.nota||'—'}</td><td><button class="btn btn-xs btn-danger" onclick="eliminarTraslado('${t.id}')">✕</button></td></tr>`}).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin traslados</td></tr>'}
    </tbody></table></div></div>`;
}

async function eliminarTraslado(id) {
  if(!confirm('¿Eliminar este traslado? Las prendas volverán automáticamente a su bodega de origen.')) return;
  const t = state.inv_traslados.find(x => x.id === id);
  if(!t) return;

  // Revertir la salida de la bodega origen
  const idxSalida = state.inv_movimientos.findIndex(m => m.articuloId === t.articuloId && m.bodegaId === t.origenId && m.tipo === 'traslado_salida' && m.nota === t.nota);
  if(idxSalida !== -1) state.inv_movimientos.splice(idxSalida, 1);

  // Revertir la entrada a la bodega destino
  const idxEntrada = state.inv_movimientos.findIndex(m => m.articuloId === t.articuloId && m.bodegaId === t.destinoId && m.tipo === 'traslado_entrada' && m.nota === t.nota);
  if(idxEntrada !== -1) state.inv_movimientos.splice(idxEntrada, 1);

  // Borrar registro visual
  state.inv_traslados = state.inv_traslados.filter(x => x.id !== id);
  renderInvTraslados();
  notify('success', '🗑️', 'Traslado revertido', 'Inventario actualizado.');
}

function openTrasladoModal(){
  openModal(`
    <div class="modal-title">Nuevo Traslado<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">ARTÍCULO</label><select class="form-control" id="m-tr-art">${(state.articulos||[]).map(a=>'<option value="'+a.id+'">'+a.nombre+'</option>').join('')}</select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">BODEGA ORIGEN</label><select class="form-control" id="m-tr-orig">${(state.bodegas||[]).map(b=>'<option value="'+b.id+'">'+b.name+'</option>').join('')}</select></div>
      <div class="form-group"><label class="form-label">BODEGA DESTINO</label><select class="form-control" id="m-tr-dest">${(state.bodegas||[]).map(b=>'<option value="'+b.id+'">'+b.name+'</option>').join('')}</select></div>
    </div>
    <div class="form-group"><label class="form-label">CANTIDAD</label><input type="number" class="form-control" id="m-tr-cant" min="1" value="1"></div>
    <div class="form-group"><label class="form-label">NOTA</label><input class="form-control" id="m-tr-nota" placeholder="Nota del traslado"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveTraslado()">Realizar Traslado</button>
  `);
}

async function saveTraslado(){
  const artId = document.getElementById('m-tr-art').value;
  const origId = document.getElementById('m-tr-orig').value;
  const destId = document.getElementById('m-tr-dest').value;
  const cant = parseInt(document.getElementById('m-tr-cant').value) || 0;
  
  if(cant <= 0 || origId === destId) { notify('warning','⚠️','Error','Verifica los datos.',{duration:3000}); return; }
  
  const stockOrig = getArticuloStock(artId, origId);
  if(stockOrig < cant) { notify('warning','⚠️','Sin stock','No hay suficiente stock en la bodega origen.',{duration:3000}); return; }
  
  const nota = document.getElementById('m-tr-nota').value.trim();
  const traslado = {id: uid(), articuloId: artId, origenId: origId, destinoId: destId, cantidad: cant, nota, fecha: today()};
  const movSalida = {id: uid(), articuloId: artId, bodegaId: origId, cantidad: -cant, tipo: 'traslado_salida', fecha: today(), referencia: 'Traslado', nota};
  const movEntrada = {id: uid(), articuloId: artId, bodegaId: destId, cantidad: cant, tipo: 'traslado_entrada', fecha: today(), referencia: 'Traslado', nota};
  
  state.inv_traslados.push(traslado);
  state.inv_movimientos.push(movSalida);
  state.inv_movimientos.push(movEntrada);
  
  await saveRecord('inv_traslados', traslado.id, traslado);
  // inv_movimientos no tiene tabla propia en Supabase, se reconstruye de ajustes/traslados
  
  closeModal();
  renderInvTraslados();
  notify('success','✅','Traslado realizado',`${cant} unidades movidas`,{duration:3000});
}
// ===================================================================
// ===== GENERIC DOCUMENT RENDERER (Cotizaciones, Órdenes, etc) =====
// ===================================================================
function renderDocumentList(pageId,title,collection,tipo,fields){
  const el=document.getElementById(pageId+'-content');if(!el)return;

  // Leer filtros actuales
  const q=(document.getElementById(pageId+'-search')?.value||'').toLowerCase();
  const desdeEl=document.getElementById(pageId+'-desde');
  const hastaEl=document.getElementById(pageId+'-hasta');
  const desde=desdeEl?.value||'';
  const hasta=hastaEl?.value||'';

  let items=[...(state[collection]||[])].reverse();

  // Aplicar filtros
  if(q) items=items.filter(d=>(d.numero||'').toLowerCase().includes(q)||(d.cliente||'').toLowerCase().includes(q));
  if(desde) items=items.filter(d=>d.fecha&&d.fecha>=desde);
  if(hasta) items=items.filter(d=>d.fecha&&d.fecha<=hasta);

  const total=[...(state[collection]||[])].length;

  const tbodyId = pageId+'-doc-tbody';
  const contId = pageId+'-doc-count';
  const rowsHtml = items.map(d=>`<tr>
    <td style="font-weight:700">${d.numero||'—'}</td>
    <td>${formatDate(d.fecha)}</td>
    <td>${d.cliente||'—'}</td>
    <td style="color:var(--accent);font-weight:700">${fmt(d.total||0)}</td>
    <td><span class="badge badge-${d.estado==='pagada'||d.estado==='aprobada'?'ok':d.estado==='anulada'?'pend':'warn'}">${d.estado||'borrador'}</span></td>
    <td><div class="btn-group">
      <button class="btn btn-xs btn-secondary" onclick="viewDoc('${collection}','${d.id}')">👁</button>
      <button class="btn btn-xs btn-secondary" onclick="printDoc('${collection}','${d.id}')">🖨</button>
      <button class="btn btn-xs btn-danger" onclick="deleteDoc('${collection}','${d.id}')">✕</button>
    </div></td>
  </tr>`).join('')||`<tr><td colspan="6" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>`;

  // Si ya existe la tabla, solo actualizar filas (mantiene foco del input)
  if(document.getElementById(tbodyId)) {
    document.getElementById(tbodyId).innerHTML = rowsHtml;
    const cnt = document.getElementById(contId);
    if(cnt) cnt.textContent = `${items.length} de ${total}`;
    const btnL = document.getElementById(pageId+'-doc-limpiar');
    if(btnL) btnL.style.display = (q||desde||hasta)?'inline-flex':'none';
    return;
  }

  el.innerHTML=`
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <button class="btn btn-primary" onclick="openDocModal('${collection}','${tipo}')">+ ${title}</button>
      <div class="search-bar" style="flex:1;min-width:180px;max-width:300px;margin:0">
        <span class="search-icon">🔍</span>
        <input type="text" id="${pageId}-search" placeholder="Buscar # o cliente..." value="${q}"
          oninput="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')">
      </div>
      <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
        <input type="date" id="${pageId}-desde" class="form-control" style="width:140px;padding:8px" value="${desde}"
          onchange="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')" title="Desde">
        <span style="color:var(--text2);font-size:11px;">hasta</span>
        <input type="date" id="${pageId}-hasta" class="form-control" style="width:140px;padding:8px" value="${hasta}"
          onchange="renderDocumentList('${pageId}','${title}','${collection}','${tipo}')" title="Hasta">
        <button class="btn btn-xs btn-secondary" id="${pageId}-doc-limpiar" style="display:${(q||desde||hasta)?'inline-flex':'none'}"
          onclick="document.getElementById('${pageId}-search').value='';document.getElementById('${pageId}-desde').value='';document.getElementById('${pageId}-hasta').value='';renderDocumentList('${pageId}','${title}','${collection}','${tipo}')">✕ Limpiar</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title">${title.toUpperCase()} — <span id="${contId}">${items.length} de ${total}</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th>Total</th><th>Estado</th><th></th></tr></thead>
        <tbody id="${tbodyId}">${rowsHtml}</tbody>
      </table></div>
    </div>`;
}

function openDocModal(collection,tipo,existingId){
  const tipos={cotizacion:'Cotización',orden:'Orden de Venta',factura:'Factura',nc:'Nota Crédito',nd:'Nota Débito',remision:'Remisión',devolucion:'Devolución',anticipo_cliente:'Anticipo Cliente'};
  const label=tipos[tipo]||tipo;
  openModal(`
    <div class="modal-title">Nueva ${label}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">FECHA</label><input type="date" class="form-control" id="m-doc-fecha" value="${today()}"></div>
      <div class="form-group"><label class="form-label">CLIENTE</label><input class="form-control" id="m-doc-cliente" placeholder="Nombre del cliente"></div>
    </div>
    ${(tipo==='nc'||tipo==='nd'||tipo==='devolucion')?`<div class="form-group"><label class="form-label">FACTURA REFERENCIA</label><select class="form-control" id="m-doc-ref"><option value="">— Seleccionar —</option>${(state.facturas||[]).map(f=>'<option value="'+f.id+'">'+f.numero+' · '+fmt(f.total)+'</option>').join('')}</select></div>`:''}
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="m-doc-obs" rows="2"></textarea></div>
    <div class="card-title" style="margin-top:16px">ÍTEMS</div>
    <div id="m-doc-items"></div>
    <button class="btn btn-sm btn-secondary" style="margin-bottom:16px" onclick="addDocItem()">+ Agregar Ítem</button>
    <div style="text-align:right;font-family:Syne;font-size:18px;font-weight:800;color:var(--accent);margin-bottom:16px" id="m-doc-total">Total: $0</div>
    <button class="btn btn-primary" style="width:100%" onclick="saveDoc('${collection}','${tipo}')">Guardar ${label}</button>
  `,true);
  addDocItem();
}

let _docItems=[];
function addDocItem(){
  _docItems.push({articuloId:'',nombre:'',cantidad:1,precio:0});
  renderDocItems();
}
function renderDocItems(){
  const el=document.getElementById('m-doc-items');if(!el)return;
  el.innerHTML=_docItems.map((item,i)=>`
    <div style="display:grid;grid-template-columns:2fr 80px 120px 40px;gap:8px;margin-bottom:8px;align-items:end">
      <div class="form-group" style="margin:0"><label class="form-label">${i===0?'ARTÍCULO':''}</label><select class="form-control" onchange="docItemChanged(${i},this.value)" style="padding:8px"><option value="">— Seleccionar —</option>${(state.articulos||[]).map(a=>'<option value="'+a.id+'" '+(item.articuloId===a.id?'selected':'')+'>'+a.nombre+'</option>').join('')}<option value="custom">✏️ Personalizado</option></select></div>
      <div class="form-group" style="margin:0"><label class="form-label">${i===0?'CANT':''}</label><input type="number" class="form-control" value="${item.cantidad}" min="1" onchange="docItemQty(${i},this.value)" style="padding:8px"></div>
      <div class="form-group" style="margin:0"><label class="form-label">${i===0?'PRECIO':''}</label><input type="number" class="form-control" value="${item.precio}" min="0" onchange="docItemPrice(${i},this.value)" style="padding:8px" id="doc-item-price-${i}"></div>
      <button class="btn btn-xs btn-danger" onclick="removeDocItem(${i})" style="margin-bottom:0;height:38px">✕</button>
    </div>`).join('');
  updateDocTotal();
}
function docItemChanged(i,artId){
  if(artId==='custom'){_docItems[i].articuloId='custom';_docItems[i].nombre='Personalizado'}
  else{const art=(state.articulos||[]).find(a=>a.id===artId);if(art){_docItems[i].articuloId=artId;_docItems[i].nombre=art.nombre;_docItems[i].precio=art.precioVenta}}
  renderDocItems();
}
function docItemQty(i,val){_docItems[i].cantidad=parseInt(val)||1;updateDocTotal()}
function docItemPrice(i,val){_docItems[i].precio=parseFloat(val)||0;updateDocTotal()}
function removeDocItem(i){_docItems.splice(i,1);renderDocItems()}
function updateDocTotal(){
  const total=_docItems.reduce((a,item)=>a+(item.cantidad*item.precio),0);
  const el=document.getElementById('m-doc-total');if(el)el.textContent='Total: '+fmt(total);
}

async function saveDoc(collection,tipo){
  const fecha=document.getElementById('m-doc-fecha').value||today();
  const cliente=document.getElementById('m-doc-cliente').value.trim();
  const obs=document.getElementById('m-doc-obs').value.trim();
  const refId=document.getElementById('m-doc-ref')?.value||'';
  const items=_docItems.filter(i=>i.precio>0);
  if(items.length===0){notify('warning','⚠️','Sin ítems','Agrega al menos un ítem.',{duration:3000});return}
  const subtotal=items.reduce((a,i)=>a+(i.cantidad*i.precio),0);
  const iva=subtotal*0.19; const total=subtotal+iva;
  const prefixes={cotizaciones:'COT',ordenes_venta:'OV',facturas:'FAC',notas_credito:'NC',
    notas_debito:'ND',remisiones:'REM',devoluciones:'DEV',anticipos_clientes:'ANT'};
  const consKeys={cotizaciones:'cotizacion',ordenes_venta:'orden',facturas:'factura',
    notas_credito:'nc',notas_debito:'nd',remisiones:'remision',devoluciones:'devolucion',anticipos_clientes:'anticipo'};
  const prefix=prefixes[collection]||'DOC';
  const consKey=consKeys[collection]||'factura';
  const numero=prefix+'-'+getNextConsec(consKey);
  const docData={id:uid(),numero,fecha,cliente,items:items.map(i=>({...i})),
    subtotal,iva,total,estado:'borrador',observaciones:obs,facturaRef:refId,tipo};

  // Guardar en state local
  if(!state[collection]) state[collection]=[];
  state[collection].push(docData);
  _docItems=[];

  // Guardar en Supabase legacy_docs
  try {
    await supabaseClient.from('legacy_docs').insert({
      id:docData.id, tipo, numero:docData.numero, data:docData
    });
    await saveConfig('consecutivos', state.consecutivos);
  } catch(e){ console.warn('saveDoc Supabase error:', e.message); }

  closeModal();
  renderPage(document.querySelector('.page.active')?.id.replace('page-',''));
  notify('success','✅','Documento creado',`${numero} · ${fmt(total)}`,{duration:3000});
}


function viewDoc(collection,id){
  const doc=(state[collection]||[]).find(d=>d.id===id);if(!doc)return;
  openModal(`
    <div class="modal-title">${doc.numero}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="grid-2" style="margin-bottom:16px">
      <div><span style="color:var(--text2);font-size:12px">Fecha:</span> ${formatDate(doc.fecha)}</div>
      <div><span style="color:var(--text2);font-size:12px">Cliente:</span> ${doc.cliente||'—'}</div>
    </div>
    <div class="table-wrap" style="margin-bottom:16px"><table><thead><tr><th>Artículo</th><th>Cant</th><th>Precio</th><th>Total</th></tr></thead><tbody>
    ${(doc.items||[]).map(i=>`<tr><td>${i.nombre||'—'}</td><td>${i.cantidad}</td><td>${fmt(i.precio)}</td><td style="font-weight:700;color:var(--accent)">${fmt(i.cantidad*i.precio)}</td></tr>`).join('')}
    </tbody></table></div>
    <div style="text-align:right;margin-bottom:8px"><span style="color:var(--text2)">Subtotal:</span> ${fmt(doc.subtotal)}</div>
    <div style="text-align:right;margin-bottom:8px"><span style="color:var(--text2)">IVA:</span> ${fmt(doc.iva)}</div>
    <div style="text-align:right;font-family:Syne;font-size:20px;font-weight:800;color:var(--accent)">${fmt(doc.total)}</div>
    ${doc.observaciones?'<div style="margin-top:12px;font-size:12px;color:var(--text2)">'+doc.observaciones+'</div>':''}
    <div class="btn-group" style="margin-top:16px">
      <button class="btn btn-primary btn-sm" onclick="printDoc('${collection}','${id}')">🖨 Imprimir</button>
      ${doc.estado!=='pagada'?`<button class="btn btn-sm" style="background:rgba(74,222,128,.15);color:var(--green);border:1px solid rgba(74,222,128,.3)" onclick="changeDocStatus('${collection}','${id}','pagada')">✓ Marcar Pagada</button>`:''}
      ${doc.estado!=='anulada'?`<button class="btn btn-sm btn-danger" onclick="changeDocStatus('${collection}','${id}','anulada')">✕ Anular</button>`:''}
    </div>
  `);
}

function changeDocStatus(collection,id,newStatus){
  const doc=(state[collection]||[]).find(d=>d.id===id);if(!doc)return;
  doc.estado=newStatus;
  
  saveRecord(collection, doc.id, doc);
  closeModal();
  renderPage(document.querySelector('.page.active')?.id.replace('page-',''));
  notify('success','✅','Estado actualizado',doc.numero+' → '+newStatus,{duration:3000});
}

function deleteDoc(collection, id) {
  // --- CANDADO DE SEGURIDAD PARA FACTURAS ---
  if (collection === 'facturas') {
    alert('⚠️ ¡Alto ahí! Para mantener tu inventario y caja perfectamente cuadrados, las facturas solo se pueden anular desde la pestaña: SISTEMA > Historial.');
    return; // Detiene la acción inmediatamente
  }
  // ------------------------------------------

  if (!confirm('¿Eliminar este documento?')) return;
  state[collection] = (state[collection] || []).filter(d => d.id !== id);
  renderPage(document.querySelector('.page.active')?.id.replace('page-', ''));
}

function printDoc(collection,id){
  const doc=(state[collection]||[]).find(d=>d.id===id);if(!doc)return;
  printReceipt(doc);
}

function renderCotizaciones(){_docItems=[];renderDocumentList('cotizaciones','Cotización','cotizaciones','cotizacion')}
function renderOrdenes(){_docItems=[];renderDocumentList('ordenes','Orden de Venta','ordenes_venta','orden')}
function renderFacturas(){_docItems=[];renderDocumentList('facturas','Factura','facturas','factura')}
function renderNotasCredito(){_docItems=[];renderDocumentList('notas_credito','Nota Crédito','notas_credito','nc')}
function renderNotasDebito(){_docItems=[];renderDocumentList('notas_debito','Nota Débito','notas_debito','nd')}
function renderRemisiones(){_docItems=[];renderDocumentList('remisiones','Remisión','remisiones','remision')}
function renderDevoluciones(){_docItems=[];renderDocumentList('devoluciones','Devolución','devoluciones','devolucion')}
function renderAnticiposClientes(){_docItems=[];renderDocumentList('anticipos_clientes','Anticipo Cliente','anticipos_clientes','anticipo_cliente')}
  // ==========================================
// ===== USUARIOS =====
// ==========================================

function renderUsuarios(pageId, titulo, collection, tipo){
  const el = document.getElementById(pageId+'-content'); if(!el) return;

  const q = (document.getElementById(pageId+'-search')?.value||'').toLowerCase();
  const desde = document.getElementById(pageId+'-desde')?.value||'';
  const hasta = document.getElementById(pageId+'-hasta')?.value||'';

  if(!state[collection]) state[collection]=[];
  let items = Array.isArray(state[collection]) ? [...state[collection]].reverse() : [];
  if(q) items = items.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) ||
    (u.cedula||'').toLowerCase().includes(q) ||
    (u.celular||'').toLowerCase().includes(q) ||
    (u.email||'').toLowerCase().includes(q) ||
    (u.ciudad||'').toLowerCase().includes(q)
  );
  if(desde) items = items.filter(u => (u.fechaCreacion||'') >= desde);
  if(hasta) items = items.filter(u => (u.fechaCreacion||'') <= hasta);

  const total = (state[collection]||[]).length;

  // Si ya existe el contenedor, solo actualizar la tabla (evita perder foco del input)
  const tbodyId = pageId+'-tbody';
  const contadorId = pageId+'-contador';
  const existing = document.getElementById(tbodyId);

  if(existing) {
    // Solo repintar tabla y contador
    existing.innerHTML = renderUsuariosRows(items, collection, tipo, pageId);
    const contador = document.getElementById(contadorId);
    if(contador) contador.textContent = `${items.length} de ${total}`;
    return;
  }

  // Primera carga: pintar todo
  el.innerHTML = `
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <button class="btn btn-primary" onclick="openUsuarioModal('${collection}','${tipo}')">+ Nuevo ${titulo}</button>
      <button class="btn btn-secondary" onclick="importarUsuariosCSV('${collection}','${tipo}','${pageId}')" title="Importar CSV/Excel">📥 Importar</button>
      <button class="btn btn-secondary" onclick="exportarUsuarios('${collection}','${tipo}')" title="Exportar a CSV">⬆ Exportar</button>
      <button class="btn btn-secondary" onclick="descargarPlantilla('${tipo}')" title="Descargar plantilla">⬇ Plantilla</button>
      <div class="search-bar" style="flex:1;min-width:180px;max-width:300px;margin:0">
        <span class="search-icon">🔍</span>
        <input type="text" id="${pageId}-search" placeholder="Nombre, cédula, ciudad..."
          value="${q}"
          oninput="renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">
      </div>
      <input type="date" class="form-control" id="${pageId}-desde" style="width:140px" value="${desde}"
        onchange="renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="${pageId}-hasta" style="width:140px" value="${hasta}"
        onchange="renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">
      <button class="btn btn-xs btn-secondary" id="${pageId}-limpiar" style="display:${(q||desde||hasta)?'inline-flex':'none'}"
        onclick="document.getElementById('${pageId}-search').value='';document.getElementById('${pageId}-desde').value='';document.getElementById('${pageId}-hasta').value='';renderUsuariosTabla('${pageId}','${titulo}','${collection}','${tipo}')">✕ Limpiar</button>
    </div>

    <div class="card">
      <div class="card-title">👥 ${titulo.toUpperCase()}S — <span id="${contadorId}">${items.length} de ${total}</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Nombre</th><th>Identificación</th><th>Celular</th><th>WhatsApp</th>
            <th>Email</th><th>Ciudad</th><th>Tipo</th><th></th>
          </tr></thead>
          <tbody id="${tbodyId}">
            ${renderUsuariosRows(items, collection, tipo, pageId)}
          </tbody>
        </table>
      </div>
    </div>
    <input type="file" id="${pageId}-file-input" accept=".csv,.xls,.xlsx" style="display:none"
      onchange="procesarArchivoUsuarios(this,'${collection}','${tipo}','${pageId}')">`;
}

function renderUsuariosTabla(pageId, titulo, collection, tipo) {
  // Actualiza solo la tabla sin repintar los filtros (mantiene foco)
  const q = (document.getElementById(pageId+'-search')?.value||'').toLowerCase();
  const desde = document.getElementById(pageId+'-desde')?.value||'';
  const hasta = document.getElementById(pageId+'-hasta')?.value||'';

  if(!state[collection]) state[collection]=[];
  let items = Array.isArray(state[collection]) ? [...state[collection]].reverse() : [];
  if(q) items = items.filter(u =>
    (u.nombre||'').toLowerCase().includes(q) ||
    (u.cedula||'').toLowerCase().includes(q) ||
    (u.celular||'').toLowerCase().includes(q) ||
    (u.email||'').toLowerCase().includes(q) ||
    (u.ciudad||'').toLowerCase().includes(q)
  );
  if(desde) items = items.filter(u => (u.fechaCreacion||'') >= desde);
  if(hasta) items = items.filter(u => (u.fechaCreacion||'') <= hasta);

  const total = (state[collection]||[]).length;
  const tbody = document.getElementById(pageId+'-tbody');
  if(tbody) tbody.innerHTML = renderUsuariosRows(items, collection, tipo, pageId);
  const contador = document.getElementById(pageId+'-contador');
  if(contador) contador.textContent = `${items.length} de ${total}`;
  // Mostrar/ocultar botón limpiar
  const btnLimpiar = document.getElementById(pageId+'-limpiar');
  if(btnLimpiar) btnLimpiar.style.display = (q||desde||hasta) ? 'inline-flex' : 'none';
}

function renderUsuariosRows(items, collection, tipo, pageId) {
  if(!items.length) return '<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:24px">Sin registros</td></tr>';
  // Show max 200 rows for performance with 8000+ records
  const visible = items.slice(0, 200);
  const more = items.length > 200 ? `<tr><td colspan="8" style="text-align:center;color:var(--text2);padding:12px;font-size:11px">... y ${items.length-200} más. Usa el buscador para filtrar.</td></tr>` : '';
  return visible.map((u,idx) => `<tr>
    <td style="font-weight:700">${u.nombre||'—'}</td>
    <td>${u.tipoId||''} ${u.cedula||'—'}</td>
    <td>${u.celular||'—'}</td>
    <td>${u.whatsapp||'—'}</td>
    <td>${u.email||'—'}</td>
    <td>${u.ciudad||'—'}</td>
    <td><span class="badge badge-warn">${u.tipoPersona||tipo}</span></td>
    <td><div class="btn-group">
      <button class="btn btn-xs btn-secondary" onclick="openUsuarioModal('${collection}','${tipo}','${pageId}','${idx}',true)">✏️</button>
      <button class="btn btn-xs btn-danger" onclick="eliminarUsuario('${collection}','${u.id}','${pageId}','${tipo}','${tipo}')">✕</button>
    </div></td>
  </tr>`).join('') + more;
}


function renderUsuClientes(){ renderUsuarios('usu_clientes','Cliente','usu_clientes','cliente'); }
function renderUsuEmpleados(){ renderUsuarios('usu_empleados','Empleado','usu_empleados','empleado'); }
function renderUsuProveedores(){ renderUsuarios('usu_proveedores','Proveedor','usu_proveedores','proveedor'); }

function openUsuarioModal(collection, tipo, pageId, idx, editar){
  const items = state[collection]||[];
  const u = (editar && idx!==undefined) ? items[items.length-1-parseInt(idx)] : null;
  const titulos = {cliente:'Cliente', empleado:'Empleado', proveedor:'Proveedor'};
  openModal(`
    <div class="modal-title">${u?'Editar':'Nuevo'} ${titulos[tipo]||tipo}<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO ID</label>
        <select class="form-control" id="usu-tipoid">
          <option value="CC" ${u?.tipoId==='CC'?'selected':''}>CC - Cédula</option>
          <option value="NIT" ${u?.tipoId==='NIT'?'selected':''}>NIT</option>
          <option value="CE" ${u?.tipoId==='CE'?'selected':''}>CE - Extranjería</option>
          <option value="PA" ${u?.tipoId==='PA'?'selected':''}>PA - Pasaporte</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">N° IDENTIFICACIÓN</label><input class="form-control" id="usu-cedula" value="${u?.cedula||''}"></div>
    </div>
    <div class="form-group"><label class="form-label">NOMBRE COMPLETO *</label><input class="form-control" id="usu-nombre" value="${u?.nombre||''}"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">CELULAR</label><input class="form-control" id="usu-celular" value="${u?.celular||''}"></div>
      <div class="form-group"><label class="form-label">WHATSAPP</label><input class="form-control" id="usu-whatsapp" value="${u?.whatsapp||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">EMAIL</label><input class="form-control" id="usu-email" value="${u?.email||''}"></div>
      <div class="form-group"><label class="form-label">CIUDAD</label><input class="form-control" id="usu-ciudad" value="${u?.ciudad||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">DEPARTAMENTO</label><input class="form-control" id="usu-dpto" value="${u?.departamento||''}"></div>
      <div class="form-group"><label class="form-label">DIRECCIÓN</label><input class="form-control" id="usu-dir" value="${u?.direccion||''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO PERSONA</label>
        <select class="form-control" id="usu-tipopersona">
          <option value="Natural" ${u?.tipoPersona==='Natural'?'selected':''}>Natural</option>
          <option value="Jurídica" ${u?.tipoPersona==='Jurídica'?'selected':''}>Jurídica</option>
        </select>
      </div>
      <div class="form-group"><label class="form-label">FECHA NACIMIENTO</label><input type="date" class="form-control" id="usu-fnac" value="${u?.fechaNac||''}"></div>
    </div>
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="usu-obs" rows="2">${u?.observacion||''}</textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="guardarUsuario('${collection}','${tipo}','${pageId||'usu_'+tipo+'s'}','${u?.id||''}')">Guardar ${titulos[tipo]||tipo}</button>
  `);
}

async function guardarUsuario(collection, tipo, pageId, existingId) {
  const nombre = document.getElementById('usu-nombre').value.trim();
  if(!nombre){ notify('danger','⚠️','Error','El nombre es obligatorio'); return; }

  // Determinar la tabla y preparar los datos según el tipo
  let table = '';
  let data = {};
  const recordId = existingId || crypto.randomUUID();

  if (tipo === 'cliente') {
    table = 'customers';
    data = {
      id: recordId,
      nombre: nombre,
      cedula: document.getElementById('usu-cedula').value.trim(),
      celular: document.getElementById('usu-celular').value.trim(),
      telefono: document.getElementById('usu-celular').value.trim(), // Usamos el mismo si no hay otro input
      whatsapp: document.getElementById('usu-whatsapp').value.trim(),
      ciudad: document.getElementById('usu-ciudad').value.trim(),
      direccion: document.getElementById('usu-dir').value.trim()
    };
  } else if (tipo === 'empleado') {
    table = 'employees';
    data = {
      id: recordId,
      nombre: nombre,
      tipo_contrato: 'indefinido', // Valor por defecto
      salario_base: 0 
    };
  } else {
    // Proveedor → tabla proveedores
    table = 'proveedores';
    data = {
      id: recordId,
      nombre: nombre,
      tipo_id: document.getElementById('usu-tipoid')?.value || 'CC',
      cedula: document.getElementById('usu-cedula')?.value.trim() || '',
      celular: document.getElementById('usu-celular')?.value.trim() || '',
      whatsapp: document.getElementById('usu-whatsapp')?.value.trim() || '',
      email: document.getElementById('usu-email')?.value.trim() || '',
      ciudad: document.getElementById('usu-ciudad')?.value.trim() || '',
      departamento: document.getElementById('usu-dpto')?.value.trim() || '',
      direccion: document.getElementById('usu-dir')?.value.trim() || '',
      tipo_persona: document.getElementById('usu-tipopersona')?.value || 'Natural',
      observacion: document.getElementById('usu-obs')?.value.trim() || ''
    };
  }

  try {
    showLoadingOverlay('connecting');
    
    // UPSERT: Inserta si es nuevo, actualiza si ya existe
    const { error } = await supabaseClient.from(table).upsert(data, { onConflict: 'id' });
    if (error) throw error;

    // Actualizar la vista local para que la interfaz responda al instante
    if (!state[collection]) state[collection] = [];
    if (existingId) {
      const i = state[collection].findIndex(x => x.id === existingId);
      if (i >= 0) state[collection][i] = { ...state[collection][i], ...data };
    } else {
      state[collection].push(data);
    }
    // Mantener sincronía entre state.empleados y state.usu_empleados
    if(tipo === 'empleado') state.empleados = state.usu_empleados;
    if(tipo === 'cliente') state.usu_clientes = state.usu_clientes; // ya sincronizado

    closeModal();
    renderPage(pageId);
    showLoadingOverlay('hide');
    notify('success','✅','Guardado',`${nombre} guardado correctamente en BD`,{duration:3000});

  } catch (err) {
    showLoadingOverlay('hide');
    console.error("Error guardando usuario:", err);
    notify('danger','⚠️','Error', err.message, {duration: 5000});
  }
}

async function eliminarUsuario(collection, id, pageId, titulo, tipo) {
  if(!confirm(`¿Eliminar este ${titulo}? Esta acción no se puede deshacer.`)) return;

  const table = tipo === 'cliente' ? 'customers' : (tipo === 'empleado' ? 'employees' : null);
  if (!table) return;

  try {
    showLoadingOverlay('connecting');
    
    const { error } = await supabaseClient.from(table).delete().eq('id', id);
    if (error) throw error;

    // Remover de la vista local
    state[collection] = (state[collection] || []).filter(x => x.id !== id);
    // Mantener sincronía
    if(tipo === 'empleado') state.empleados = state.usu_empleados;
    renderPage(pageId);
    
    showLoadingOverlay('hide');
    notify('success', '🗑️', 'Eliminado', `${titulo} borrado del sistema.`);
  } catch (err) {
    showLoadingOverlay('hide');
    notify('danger', '⚠️', 'Error al eliminar', err.message, {duration: 5000});
  }
}
function importarUsuariosCSV(collection, tipo, pageId){
  const input = document.getElementById(pageId+'-file-input');
  if(input) input.click();
}
function descargarPlantilla(tipo){
  const titulos = {cliente:'Clientes', empleado:'Empleados', proveedor:'Proveedores'};
  let csv = '';
  if(tipo === 'cliente'){
    const headers = 'ID EFFI Tipo de identificación,Tipo de identificación,Número de identificación,Nombre,Teléfono 1,Teléfono 2,Celular,WhatsApp,Facetime,Skype,Email,Web,Direcciones,País,Departamento,Ciudad,ID EFFI Ciudad,Dirección,Fecha de nacimiento,Género,Tipo de persona,Régimen tributario,Tipo de cliente,Tipo de marketing,Tarifa de precios,Actividad económica CIIU,Forma de pago,Descuento,Cupo de crédito CXC,Moneda principal,Sucursal,Ruta logística,Vendedor,Responsable asignado,Fecha última venta,Observación,Vigencia,Fecha de creación,Responsable de creación,Fecha de modificación,Responsable de modificación,Fecha de anulación,Responsable de anulación';
    const ejemplo = '2,Cédula de ciudadanía,12345678,María García López,3001234567,,3001234567,3001234567,,,maria@email.com,,,,Antioquia,Medellín,,Calle 10 # 5-20,1990-05-15,,Física (natural),,,,,,,0,0,Peso Colombiano $ COP,,,,,,,Cliente de prueba,Vigente,' + new Date().toISOString().split("T")[0] + ',,,,';
    csv = headers + '\n' + ejemplo;
  } else if(tipo === 'empleado'){
    csv = 'Nombre,Cédula,Celular,Email,Ciudad,Salario Base,Tipo Contrato\nJuan Pérez,12345678,3001234567,juan@email.com,Medellín,1750000,indefinido';
  } else {
    csv = 'Tipo ID,Cédula/NIT,Nombre,Celular,WhatsApp,Email,Ciudad,Departamento,Dirección,Tipo Persona,Observación\nNIT,900123456,Empresa XYZ,3001234567,,info@empresa.com,Medellín,Antioquia,Cra 1 #2-3,Jurídica,';
  }
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `plantilla_${titulos[tipo]||tipo}.csv`; a.click();
  notify('success','⬇','Plantilla descargada','Completa y luego importa el archivo.',{duration:3000});
}

function exportarUsuarios(collection, tipo){
  const items = state[collection] || [];
  if(items.length === 0){ notify('warning','⚠️','Sin datos','No hay registros para exportar.',{duration:3000}); return; }

  const BOM = '\uFEFF';
  const headers = [
    'ID EFFI Tipo de identificación','Tipo de identificación','Número de identificación',
    'Nombre','Teléfono 1','Teléfono 2','Celular','WhatsApp','Facetime','Skype',
    'Email','Web','Direcciones','País','Departamento','Ciudad','ID EFFI Ciudad',
    'Dirección','Fecha de nacimiento','Género','Tipo de persona','Régimen tributario',
    'Tipo de cliente','Tipo de marketing','Tarifa de precios','Actividad económica CIIU',
    'Forma de pago','Descuento','Cupo de crédito CXC','Moneda principal','Sucursal',
    'Ruta logística','Vendedor','Responsable asignado','Fecha última venta','Observación',
    'Vigencia','Fecha de creación','Responsable de creación','Fecha de modificación',
    'Responsable de modificación','Fecha de anulación','Responsable de anulación'
  ];

  const q = (v) => `"${String(v||'').replace(/"/g,'""')}"`;

  const rows = items.map(u => [
    q('2'), q(u.tipoId==='NIT'?'NIT':'Cédula de ciudadanía'),
    q(u.cedula||''), q(u.nombre||''),
    q(u.telefono||u.celular||''), q(''), q(u.celular||''), q(u.whatsapp||''),
    q(''), q(''), q(u.email||''), q(''),
    q(u.departamento&&u.ciudad ? `*Colombia / ${u.departamento} / ${u.ciudad} / ${u.direccion||''}` : ''),
    q('Colombia'), q(u.departamento||''), q(u.ciudad||''), q(''),
    q(u.direccion||''), q(u.fechaNac||''), q(u.genero||''),
    q(u.tipoPersona==='Jurídica'?'Jurídica':'Física (natural)'),
    q(''), q('Común'), q(''), q('Tarifa normal | Mayorista'),
    q(''), q(''), q('0,00'), q('0,00'), q('Peso Colombiano $ COP'),
    q(''), q(''), q(''), q(''), q(''), q(u.observacion||''),
    q('Vigente'), q(u.fechaCreacion||today()), q('VentasHera'), q(''), q(''), q(''), q('')
  ].join(','));

  const csv = BOM + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${tipo}s_VentasHera_${today()}.csv`;
  a.click();
  notify('success','⬆','Exportación exitosa',`${items.length} registros exportados.`,{duration:3000});
}


function procesarArchivoUsuarios(input, collection, tipo, pageId) {
  const file = input.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      showLoadingOverlay('connecting');
      const raw = e.target.result;

      let rows = []; // Array de arrays de strings

      // Detectar si es HTML (XLS de EFFI/Excel exportado como HTML)
      const isHTML = raw.trim().startsWith('<') || raw.includes('<table') || raw.includes('<tr');

      if(isHTML) {
        // Parsear tabla HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(raw, 'text/html');
        const trs = doc.querySelectorAll('tr');
        trs.forEach(tr => {
          const cells = [...tr.querySelectorAll('th,td')].map(td => td.textContent.trim());
          if(cells.length > 0) rows.push(cells);
        });
      } else {
        // CSV/TSV texto plano
        const text = raw.replace(/^\uFEFF/, '');
        const firstLine = text.split(/\r?\n/)[0];
        const sep = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ',';
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        lines.forEach(line => {
          if(sep === '\t') {
            rows.push(line.split('\t').map(c => c.trim()));
          } else {
            const cols = [];
            let cur = '', inQ = false;
            for(const ch of (line + sep)) {
              if(ch === '"') { inQ = !inQ; }
              else if(ch === sep && !inQ) { cols.push(cur.trim()); cur = ''; }
              else cur += ch;
            }
            rows.push(cols);
          }
        });
      }

      if(rows.length < 2) throw new Error("Archivo vacío o sin datos.");

      // Detectar fila de encabezados
      const headerRow = rows[0];
      const isEFFI = headerRow.some(h => h.includes('Tipo de identificaci') || h.includes('mero de identificaci') || h.includes('ID EFFI'));

      let importados = 0, duplicados = 0;
      if(!Array.isArray(state[collection])) state[collection] = [];
      const existentes = new Set(state[collection].map(u => u.cedula).filter(Boolean));
      let batch = [];

      for(let i = 1; i < rows.length; i++) {
        const cols = rows[i];
        if(cols.length < 3) continue;

        const clean = (n) => (cols[n]||'').replace(/^"|"$/g,'').trim();

        let u;
        if(isEFFI) {
          // Formato EFFI exacto (43 columnas)
          // 0=ID EFFI tipo, 1=Tipo ID texto, 2=Número ID, 3=Nombre
          // 4=Tel1, 5=Tel2, 6=Celular, 7=WhatsApp, 10=Email
          // 13=País, 14=Departamento, 15=Ciudad, 17=Dirección
          // 18=Fecha nac, 19=Género, 20=Tipo persona, 35=Observación
          const cedula = clean(2);
          const nombre = clean(3);
          if(!nombre) continue;
          if(cedula && existentes.has(cedula)) { duplicados++; continue; }
          u = {
            id: crypto.randomUUID(), tipo, tipoId: 'CC',
            cedula, nombre,
            telefono: clean(4),
            celular: clean(6) || clean(4),
            whatsapp: clean(7),
            email: clean(10),
            departamento: clean(14),
            ciudad: clean(15),
            direccion: clean(17),
            fechaNac: clean(18),
            genero: clean(19),
            tipoPersona: (clean(20)||'').toLowerCase().includes('natural') || (clean(20)||'').toLowerCase().includes('física') ? 'Natural' : 'Jurídica',
            observacion: clean(35),
            fechaCreacion: today()
          };
        } else {
          // Formato simple VentasHera
          const cedula = clean(1);
          const nombre = clean(2);
          if(!nombre) continue;
          if(cedula && existentes.has(cedula)) { duplicados++; continue; }
          u = {
            id: crypto.randomUUID(), tipo, tipoId: clean(0)||'CC',
            cedula, nombre,
            celular: clean(3), whatsapp: clean(4), email: clean(5),
            ciudad: clean(6), departamento: clean(7), direccion: clean(8),
            tipoPersona: clean(9)||'Natural', fechaNac: clean(10),
            observacion: clean(11), fechaCreacion: today()
          };
        }

        state[collection].push(u);
        if(u.cedula) existentes.add(u.cedula);
        importados++;

        if(tipo === 'cliente') {
          batch.push({
            id: u.id, nombre: u.nombre,
            cedula: u.cedula||null, celular: u.celular||null,
            telefono: u.telefono||null, whatsapp: u.whatsapp||null,
            ciudad: u.ciudad||null, direccion: u.direccion||null
          });
        }

        if(batch.length >= 500) {
          try { await supabaseClient.from('customers').upsert(batch, {onConflict:'id'}); }
          catch(ue) { console.warn('Batch upsert:', ue.message); }
          batch = [];
        }
      }

      if(batch.length > 0) {
        try { await supabaseClient.from('customers').upsert(batch, {onConflict:'id'}); }
        catch(ue) { console.warn('Final upsert:', ue.message); }
      }

      input.value = '';
      showLoadingOverlay('hide');
      renderPage(pageId);
      notify('success','📥','Importación exitosa',`${importados} importados · ${duplicados} duplicados omitidos`,{duration:4000});

    } catch(err) {
      showLoadingOverlay('hide');
      console.error('Import error:', err);
      notify('danger','⚠️','Error en importación', err.message, {duration:5000});
    }
  };
  reader.readAsText(file, 'UTF-8');
}
  async function saveDoc(collection, tipo) {
  const fecha = document.getElementById('m-doc-fecha').value || today();
  const cliente = document.getElementById('m-doc-cliente').value.trim();
  const obs = document.getElementById('m-doc-obs').value.trim();
  const refId = document.getElementById('m-doc-ref')?.value || '';
  const items = _docItems.filter(i => i.precio > 0);
  
  if (items.length === 0) { notify('warning','⚠️','Sin ítems','Agrega al menos un ítem.',{duration:3000}); return; }
  
  const subtotal = items.reduce((a,i) => a + (i.cantidad * i.precio), 0);
  const iva = subtotal * 0.19; 
  const total = subtotal + iva;
  
  const consKeys = {cotizaciones:'cotizacion', ordenes_venta:'orden', notas_credito:'nc', notas_debito:'nd', remisiones:'remision', devoluciones:'devolucion', anticipos_clientes:'anticipo'};
  const prefixes = {cotizaciones:'COT', ordenes_venta:'OV', notas_credito:'NC', notas_debito:'ND', remisiones:'REM', devoluciones:'DEV', anticipos_clientes:'ANT'};
  
  const prefix = prefixes[collection] || 'DOC';
  const consKey = consKeys[collection] || 'factura';
  const numero = prefix + '-' + getNextConsec(consKey);
  
  // Objeto JSON completo con la data del documento
  const docData = { id: crypto.randomUUID(), numero, fecha, cliente, items: items.map(i => ({...i})), subtotal, iva, total, estado: 'borrador', observaciones: obs, facturaRef: refId, tipo };

  try {
    showLoadingOverlay('connecting');

    const { error } = await supabaseClient.from('legacy_docs').insert({id:docData.id,tipo,numero:docData.numero,data:docData});

    if (error) throw error;

    // Actualizar el estado local
    if (!state[collection]) state[collection] = [];
    state[collection].push(docData);
    _docItems = [];
    
    saveConfig('consecutivos', state.consecutivos);
    closeModal();
    renderPage(document.querySelector('.page.active')?.id.replace('page-',''));
    showLoadingOverlay('hide');
    notify('success','✅','Documento creado',`${numero} guardado en BD.`,{duration:3000});

  } catch (err) {
    showLoadingOverlay('hide');
    notify('danger','⚠️','Error al crear documento', err.message);
  }
}

// ===================================================================
// ===== COBROS / PENDIENTES =====
// ===================================================================

function renderLogistica(){
  const el=document.getElementById('logistica-content');if(!el)return;
  const q=(document.getElementById('log-search')?.value||'').toLowerCase();
  const desde=document.getElementById('log-desde')?.value||'';
  const hasta=document.getElementById('log-hasta')?.value||'';
  const canal=document.getElementById('log-canal')?.value||'';
  const trans=document.getElementById('log-trans')?.value||'';
  let guias=[...(state.ventas||[])].filter(v=>v.canal==='local'||v.canal==='inter').reverse();
  if(canal)guias=guias.filter(v=>v.canal===canal);
  if(trans)guias=guias.filter(v=>(v.transportadora||'').toLowerCase().includes(trans.toLowerCase()));
  if(desde)guias=guias.filter(v=>v.fecha>=desde);
  if(hasta)guias=guias.filter(v=>v.fecha<=hasta);
  if(q)guias=guias.filter(v=>(v.cliente||'').toLowerCase().includes(q)||(v.guia||'').toLowerCase().includes(q)||(v.telefono||'').toLowerCase().includes(q)||(v.ciudad||'').toLowerCase().includes(q));
  const total=(state.ventas||[]).filter(v=>v.canal==='local'||v.canal==='inter').length;

  const rowsHtml = guias.map(v=>`<tr>
    <td>${formatDate(v.fecha)}</td>
    <td><span class="badge ${v.canal==='local'?'badge-warn':'badge-inter'}">${v.canal==='local'?'🛵':'📦'} ${v.canal}</span></td>
    <td style="font-weight:700">${v.cliente||'—'}</td>
    <td>${v.telefono||'—'}</td>
    <td>${v.ciudad||'—'}</td>
    <td>${v.transportadora||v.empresa||'—'}</td>
    <td style="color:var(--accent);font-weight:700">${v.guia||'—'}</td>
    <td style="font-weight:700">${fmt(v.valor||0)}</td>
    <td><span class="badge ${v.liquidado?'badge-ok':'badge-pend'}">${v.liquidado?'✓ Liq':'⏳ Pend'}</span></td>
    <td><span class="badge ${v.esContraEntrega?'badge-warn':'badge-ok'}">${v.esContraEntrega?'📦 C/E':'💵 Ctdo'}</span></td>
  </tr>`).join('')||'<tr><td colspan="10" style="text-align:center;color:var(--text2);padding:24px">Sin guías</td></tr>';

  if(document.getElementById('log-tbody')) {
    document.getElementById('log-tbody').innerHTML = rowsHtml;
    const cnt = document.getElementById('log-count');
    if(cnt) cnt.textContent = `${guias.length} de ${total}`;
    const btnL = document.getElementById('log-limpiar');
    if(btnL) btnL.style.display=(q||canal||trans||desde||hasta)?'inline-flex':'none';
    return;
  }

  el.innerHTML=`
    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;">
      <div class="search-bar" style="flex:1;min-width:180px;max-width:280px;margin:0"><span class="search-icon">🔍</span>
        <input type="text" id="log-search" placeholder="Cliente, guía, teléfono..." value="${q}" oninput="renderLogistica()"></div>
      <select class="form-control" id="log-canal" style="width:130px" onchange="renderLogistica()">
        <option value="">Todos</option><option value="local" ${canal==='local'?'selected':''}>🛵 Local</option>
        <option value="inter" ${canal==='inter'?'selected':''}>📦 Inter</option></select>
      <input type="text" class="form-control" id="log-trans" placeholder="Transportadora..." style="width:140px" value="${trans}" oninput="renderLogistica()">
      <input type="date" class="form-control" id="log-desde" style="width:130px" value="${desde}" onchange="renderLogistica()">
      <span style="color:var(--text2);font-size:11px;align-self:center;">hasta</span>
      <input type="date" class="form-control" id="log-hasta" style="width:130px" value="${hasta}" onchange="renderLogistica()">
      <button class="btn btn-xs btn-secondary" id="log-limpiar" style="display:${(q||canal||trans||desde||hasta)?'inline-flex':'none'}"
        onclick="['log-search','log-trans'].forEach(id=>{document.getElementById(id).value=''});['log-canal','log-desde','log-hasta'].forEach(id=>{document.getElementById(id).value=''});renderLogistica()">✕</button>
    </div>
    <div class="card"><div class="card-title">🚚 GUÍAS — <span id="log-count">${guias.length} de ${total}</span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Canal</th><th>Cliente</th><th>Teléfono</th><th>Ciudad</th><th>Transportadora</th><th>N° Guía</th><th>Total</th><th>Estado</th><th>Tipo Cobro</th></tr></thead>
      <tbody id="log-tbody">${rowsHtml}</tbody>
    </table></div></div>`;
}


function renderPendientes(){
  // Solo contra entrega pendiente va a cobros (contado ya está liquidado al vender)
  const pend=(state.ventas||[]).filter(v=>!v.archived&&v.canal!=='vitrina'&&!v.liquidado&&v.esContraEntrega!==false).sort((a,b)=>(a.fechaLiquidacion||'')>(b.fechaLiquidacion||'')?1:-1);
  const totalPend=pend.reduce((a,v)=>a+v.valor,0);
  let html=`<div class="grid-2" style="margin-bottom:20px"><div class="card" style="margin:0"><div class="stat-val" style="color:var(--red)">${pend.length}</div><div class="stat-label">Sin liquidar</div></div><div class="card" style="margin:0"><div class="stat-val" style="color:var(--yellow)">${fmt(totalPend)}</div><div class="stat-label">Total pendiente</div></div></div>`;
  if(pend.length===0)html+='<div class="empty-state"><div class="es-icon">✅</div><div class="es-title" style="color:var(--green)">¡Todo al día!</div><div class="es-text">No tienes cobros pendientes</div></div>';
  else pend.forEach(v=>{
    const diff=daysDiff(v.fechaLiquidacion);const urgClass=diff<0?'urgent':diff<=1?'warning':'ok';const urgLabel=diff<0?`⚡ VENCIDO hace ${Math.abs(diff)}d`:diff===0?'⚠️ Vence HOY':diff===1?'⚠️ Vence mañana':`✓ Vence en ${diff}d`;
    const empresaString = v.empresa ? (v.transportadora ? `${v.empresa} (${v.transportadora})` : v.empresa) : '';
    html+=`<div class="urgency-item ${urgClass}"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><div><span class="badge badge-${v.canal}">${v.canal==='local'?'🛵 Local':'📦 Inter'}</span> <span class="badge badge-warn" style="margin-left:4px">📦 Contraentrega</span> <span style="font-family:Syne;font-weight:700;color:var(--accent);margin-left:6px">${fmt(v.valor)}</span></div><span style="font-size:11px;font-weight:700;color:${urgClass==='urgent'?'var(--red)':urgClass==='warning'?'var(--yellow)':'var(--green)'}">${urgLabel}</span></div><div style="font-size:12px;margin-bottom:4px"><b>${v.cliente||'Sin nombre'}</b>${v.telefono?' · '+v.telefono:''}</div>${v.guia?'<div style="font-size:12px;color:var(--text2);margin-bottom:4px">Guía: '+v.guia+' · '+empresaString+'</div>':''}<div style="font-size:12px;color:var(--text2);margin-bottom:10px">${formatDate(v.fecha)} → Liq: ${formatDate(v.fechaLiquidacion)}</div><div class="btn-group"><button class="btn btn-primary btn-sm" onclick="marcarLiquidado('${v.id}')">✓ Liquidar (+20XP)</button></div></div>`});
  document.getElementById('pendientes-content').innerHTML=html;
}
function marcarLiquidado(id) {
  const v = state.ventas.find(v => v.id === id); 
  if (!v) return;
  
  v.liquidado = true; 
  awardXP(20); 
  
  // --- GUARDADOS ATÓMICOS ---
  saveRecord('ventas', v.id, v);
  saveConfig('game', state.game);
  

  const cajaAbierta = (state.cajas || []).find(c => c.estado === 'abierta');
  if (cajaAbierta) {
    cajaAbierta.saldo += v.valor;
    const mov = { id: uid(), cajaId: cajaAbierta.id, tipo: 'ingreso', valor: v.valor, concepto: 'Liquidación ' + (v.guia || 'Venta'), fecha: today(), metodo: 'transferencia' };
    state.tes_movimientos.push(mov);
    saveRecord('tes_movimientos', mov.id, mov);
    saveRecord('cajas', cajaAbierta.id, cajaAbierta);
  }
  
  renderPendientes();
  updateNavBadges();
  notify('success', '💵', '¡Liquidado!', fmt(v.valor) + ' · +20XP', { duration: 3000 });
  screenFlash('green');
}

// ===================================================================
// ===== NÓMINA =====
// ===================================================================
function renderNomAusencias(){
  const items=[...(state.nom_ausencias||[])].reverse();
  document.getElementById('nom_ausencias-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openNomAusenciaModal()">+ Nueva Ausencia</button>
    <div class="card"><div class="card-title">AUSENCIAS LABORALES (${items.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Empleado</th><th>Tipo</th><th>Desde</th><th>Hasta</th><th>Días</th><th>Estado</th><th></th></tr></thead><tbody>
    ${items.map(a=>`<tr><td>${a.empleado}</td><td><span class="badge badge-warn">${a.tipo}</span></td><td>${formatDate(a.desde)}</td><td>${formatDate(a.hasta)}</td><td style="font-weight:700">${a.dias}</td><td><span class="badge ${a.aprobada?'badge-ok':'badge-pend'}">${a.aprobada?'Aprobada':'Pendiente'}</span></td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_ausencias','${a.id}','nom_ausencias')">✕</button></td></tr>`).join('')||'<tr><td colspan="7" style="text-align:center;color:var(--text2);padding:24px">Sin ausencias</td></tr>'}
    </tbody></table></div></div>`;
}

function openNomAusenciaModal(){
  openModal(`
    <div class="modal-title">Nueva Ausencia<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">EMPLEADO</label><input class="form-control" id="m-na-emp" placeholder="Nombre del empleado"></div>
    <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-na-tipo"><option value="Vacaciones">Vacaciones</option><option value="Incapacidad">Incapacidad</option><option value="Licencia">Licencia</option><option value="Permiso">Permiso</option><option value="Maternidad">Maternidad</option><option value="Calamidad">Calamidad</option></select></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">DESDE</label><input type="date" class="form-control" id="m-na-desde" value="${today()}"></div>
      <div class="form-group"><label class="form-label">HASTA</label><input type="date" class="form-control" id="m-na-hasta" value="${today()}"></div>
    </div>
    <div class="form-group"><label class="form-label">OBSERVACIONES</label><textarea class="form-control" id="m-na-obs" rows="2"></textarea></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveNomAusencia()">Guardar Ausencia</button>
  `);
}

function saveNomAusencia(){
  const emp=document.getElementById('m-na-emp').value.trim();if(!emp)return;
  const desde=document.getElementById('m-na-desde').value;const hasta=document.getElementById('m-na-hasta').value;
  const dias=Math.max(1,Math.round((new Date(hasta)-new Date(desde))/86400000)+1);
  const aus={id:uid(),empleado:emp,tipo:document.getElementById('m-na-tipo').value,desde,hasta,dias,observaciones:document.getElementById('m-na-obs').value.trim(),aprobada:false};
  state.nom_ausencias.push(aus);
  saveRecord('nom_ausencias',aus.id,aus);
  closeModal();renderNomAusencias();notify('success','✅','Ausencia registrada',emp+' · '+dias+' días',{duration:3000});
}

function renderNomAnticipos(){
  const items=[...(state.nom_anticipos||[])].reverse();
  document.getElementById('nom_anticipos-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openSimpleFormModal('nom_anticipos','Anticipo de Nómina',['empleado:text:EMPLEADO','valor:number:VALOR','fecha:date:FECHA','motivo:text:MOTIVO'])">+ Nuevo Anticipo</button>
    <div class="card"><div class="card-title">ANTICIPOS DE NÓMINA (${items.length})</div>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Empleado</th><th>Valor</th><th>Motivo</th><th></th></tr></thead><tbody>
    ${items.map(a=>`<tr><td>${formatDate(a.fecha)}</td><td>${a.empleado}</td><td style="color:var(--accent);font-weight:700">${fmt(a.valor||0)}</td><td>${a.motivo||'—'}</td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_anticipos','${a.id}','nom_anticipos')">✕</button></td></tr>`).join('')||'<tr><td colspan="5" style="text-align:center;color:var(--text2);padding:24px">Sin anticipos</td></tr>'}
    </tbody></table></div></div>`;
}

function renderNomConceptos(){
  const items=state.nom_conceptos||[];
  document.getElementById('nom_conceptos-content').innerHTML=`
    <button class="btn btn-primary" style="margin-bottom:16px" onclick="openConceptoModal()">+ Nuevo Concepto</button>
    <div class="card"><div class="card-title">CONCEPTOS DE NÓMINA</div>
    <div class="table-wrap"><table><thead><tr><th>Nombre</th><th>Tipo</th><th>Fórmula</th><th>Valor</th><th></th></tr></thead><tbody>
    ${items.map(c=>`<tr><td style="font-weight:700">${c.nombre}</td><td><span class="badge ${c.tipo==='devengo'?'badge-ok':'badge-pend'}">${c.tipo}</span></td><td>${c.formula}</td><td>${c.formula==='porcentaje'?c.valor+'%':fmt(c.valor)}</td><td><button class="btn btn-xs btn-danger" onclick="deleteFromCollection('nom_conceptos','${c.id}','nom_conceptos')">✕</button></td></tr>`).join('')}
    </tbody></table></div></div>`;
}

function openConceptoModal(){
  openModal(`
    <div class="modal-title">Nuevo Concepto<button class="modal-close" onclick="closeModal()">×</button></div>
    <div class="form-group"><label class="form-label">NOMBRE</label><input class="form-control" id="m-nc-nombre" placeholder="Ej: Horas Extra"></div>
    <div class="form-row">
      <div class="form-group"><label class="form-label">TIPO</label><select class="form-control" id="m-nc-tipo"><option value="devengo">Devengo</option><option value="deduccion">Deducción</option></select></div>
      <div class="form-group"><label class="form-label">FÓRMULA</label><select class="form-control" id="m-nc-formula"><option value="fijo">Valor Fijo</option><option value="porcentaje">Porcentaje sobre salario</option></select></div>
    </div>
    <div class="form-group"><label class="form-label">VALOR</label><input type="number" class="form-control" id="m-nc-valor" placeholder="0"></div>
    <button class="btn btn-primary" style="width:100%" onclick="saveConcepto()">Guardar</button>
  `);
}

function saveConcepto(){
  const nombre=document.getElementById('m-nc-nombre').value.trim();if(!nombre)return;
  const conc={id:uid(),nombre,tipo:document.getElementById('m-nc-tipo').value,formula:document.getElementById('m-nc-formula').value,valor:parseFloat(document.getElementById('m-nc-valor').value)||0};
  state.nom_conceptos.push(conc);
  saveRecord('nom_conceptos',conc.id,conc);
  closeModal();renderNomConceptos();
}

// ===================================================================