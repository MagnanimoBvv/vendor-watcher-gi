const axios = require('axios');
const { icons, categories, bebidasRules, normalizedSurfaces, surfaceKeywords, normalizedPrintingTechniques } = require('./cdo.constants');
const { buildHandle } = require('../handleParser');
const { addCantidadOption, expandVariantForShopify, getShopifyVariantKey, mapShopMetafields, buildClassificationMetafields, filterMetafieldKeys, joinComma } = require('./_shared');

async function fetchCatalog({ vendor }) {
    const r = await axios.get(vendor.endpoint, { params: { auth_token: process.env.CDO_AUTH_TOKEN } });
    const list = Array.isArray(r.data) ? r.data : (r.data.products || r.data.data || []);

    return list.map(prod => {
        const isNewExplicit = (prod.variants || []).every(v => v.novedad === true);
        const isOnOfferExplicit = (prod.categories || []).some(c => ['Precios Mejorados', 'Super Promo'].includes((c.name || '').trim()));
        return {
            code: String(prod.code).toLowerCase().replace(/[+]/g, 'mas').replace(/[\s]+/g, ''),
            name: prod.name,
            rawPrice: Number(((prod.variants || [])[0] || {}).net_price || 0),
            isNewExplicit,
            isDiscontinuedExplicit: null,
            isOnOfferExplicit,
            variants: (prod.variants || []).map(v => ({
                sku: v.sku,
                key: (v.color && v.color.name) || ((v.colors || []).map(c => c.name).join('/')),
                name: (v.color && v.color.name) || ((v.colors || []).map(c => c.name).join('/')),
                rawPrice: Number(v.net_price),
                available: Number(v.stock_available) > 0,
                raw: v,
            })),
            raw: prod,
        };
    });
}

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Clasifica un texto de material a su categoría normalizada. 1) match exacto
// contra normalizedSurfaces (conserva las decisiones ya curadas a mano); 2) si no,
// keywords por posición (ver surfaceKeywords). Devuelve null si no hay señal.
function classifySurface(text) {
    if (!text) return null;
    const exact = normalizedSurfaces[String(text).trim()];
    if (exact) return exact;
    const t = normalize(text);
    let best = null, bestIdx = Infinity, bestPrio = Infinity;
    surfaceKeywords.forEach(([cat, regexes], prio) => {
        for (const r of regexes) {
            const m = t.match(r);
            if (m && (m.index < bestIdx || (m.index === bestIdx && prio < bestPrio))) {
                best = cat; bestIdx = m.index; bestPrio = prio;
            }
        }
    });
    return best;
}

// Obtiene el texto crudo de material desde la descripción de CDO. CDO no expone un
// campo de material: 1) si hay etiqueta "Materiales:" se usa esa línea; 2) si no,
// se toma la PRIMERA oración que parezca un material (muchos productos arrancan con
// "Plástico.", "Bambú.", o traen "Non-woven."/"Poliéster 600D." tras las medidas).
// Devuelve '' si no hay ninguna señal de material.
function extractMaterialText(description) {
    const labelled = String(description || '').match(/Materiales?\s*:\s*(.*?)(?:\r\n|\n|$)/i);
    if (labelled) return labelled[1].trim();
    const sentences = String(description || '').split(/[.\r\n]+/).map(s => s.trim()).filter(Boolean);
    for (const s of sentences) {
        if (classifySurface(s)) return s;
    }
    return '';
}

// Material normalizado para los metafields. '' sólo si no hay ninguna señal.
function getNormalizedSurface(description) {
    return classifySurface(extractMaterialText(description)) || '';
}

function matchRule(text) {
    const m = (bebidasRules || []).find(rule => {
        const allMatch = !rule.all || rule.all.every(w => text.includes(w));
        const anyMatch = !rule.any || rule.any.some(w => text.includes(w));
        return allMatch && anyMatch;
    });
    return m ? m.name : null;
}

function getCategories(prod) {
    let tags = '';
    tags += (prod.variants || []).some(v => v.novedad === true) ? ',nuevo' : '';
    const promoCategories = ['Precios Mejorados', 'Super Promo'];
    tags += (prod.categories || []).some(c => promoCategories.includes((c.name || '').trim())) ? ',oferta' : '';
    tags += (prod.categories || []).some(c => (c.name || '').trim() === 'Mundial 2026') ? ',mundial' : '';

    const mapped = (prod.categories || []).map(c => (c.name || '').trim());
    const filtered = (categories || []).filter(c => mapped.includes(c));
    const pensCats = new Set(['Escrituras Plásticas y otros', 'Escrituras Metálicas']);

    for (const fc of filtered) {
        const firstName = normalize((prod.name || '').split(' ')[0]);
        if (fc === 'Eco') {
            if (filtered.includes('Bebidas')) { tags += ',ecologicos,bebidas ecologicas'; continue; }
            if (filtered.some(el => pensCats.has(el))) { tags += ',ecologicos,boligrafos ecologicos'; continue; }
            if (filtered.includes('Mochilas, Bolsos, Bolsas, Maletas')) {
                tags += firstName === 'bolsa' ? ',ecologicos,bolsas ecologicas' : ',ecologicos,hogar ecologico'; continue;
            }
            if (filtered.includes('Oficina y Negocios')) {
                tags += firstName === 'libreta' ? ',ecologicos,libretas ecologicas' : ',ecologicos,oficina ecologica'; continue;
            }
            tags += ',ecologicos,hogar ecologico'; continue;
        }
        const map = {
            'Paraguas': ',textil,paraguas e impermeables',
            'Herramientas': ',tiempo libre,herramientas de trabajo',
            'Gorros': ',textil,gorras y cangureras',
            'Entretenimiento': ',tiempo libre,entretenimiento',
            'Audio': ',tecnologia,audifonos y bocinas',
            'Llaveros': ',tiempo libre,llaveros',
            'Automóvil': ',tiempo libre,accesorios para auto',
        };
        if (map[fc]) { tags += map[fc]; break; }
        if (fc === 'Tecnología') { tags += firstName === 'power' ? ',tecnologia,power banks' : ',tecnologia,accesorios de tecnologia'; break; }
        if (fc === 'Salud y Belleza') { tags += ['necessaire', 'espejo', 'esponja'].includes(firstName) ? ',hogar,belleza' : ',hogar,salud y bienestar'; break; }
        if (fc === 'Bebidas') { tags += matchRule(normalize(prod.description || '')) || ''; break; }
        if (fc === 'Escrituras Metálicas') { tags += firstName === 'boligrafo' ? ',oficina,boligrafos de metal' : ',oficina,accesorios de oficina'; break; }
        if (fc === 'Escrituras Plásticas y otros') {
            tags += firstName === 'boligrafo' ? ',oficina,boligrafos de plastico'
                : normalize(prod.name).includes('resaltador') ? ',oficina,boligrafos multifuncionales' : '';
            break;
        }
        if (fc === 'Mochilas, Bolsos, Bolsas, Maletas') {
            tags += ['mochila', 'carry'].includes(firstName) ? ',textil,mochilas y maletas'
                : firstName === 'bolsa' ? ',textil,bolsas y morrales'
                : firstName === 'bolso' ? ',tiempo libre,viaje'
                : firstName === 'cangurera' ? ',textil,gorras y cangureras'
                : firstName === 'cooler' ? ',textil,hieleras y loncheras' : ',tiempo libre,viaje';
            break;
        }
        if (fc === 'Oficina y Negocios') {
            tags += ['libreta', 'carpeta'].includes(firstName) ? ',oficina,libretas y carpetas'
                : firstName === 'figura' ? ',tiempo libre,antiestres' : ',oficina,accesorios de oficina';
            break;
        }
        if (['Hogar', 'Tiempo Libre'].includes(fc)) { tags += ',hogar,accesorios del hogar'; break; }
        tags += ',undefined';
    }
    return tags;
}

function getNormalizedPrintingTechniques(printingTechs) {
    return [...new Set((printingTechs || []).map(t => normalizedPrintingTechniques[t] || ''))].filter(Boolean).join('-');
}

// Actualización puntual de metafields (ver reconcileMetafields). No corre en el
// ciclo normal del watcher.
function buildMetafieldsForUpdate(normalized, ctx, keys) {
    const prod = normalized.raw;
    const printingTechs = (prod.icons || []).filter(i => (icons || []).includes(i.label)).map(i => i.label);
    const logical = buildClassificationMetafields({
        material: getNormalizedSurface(prod.description),
        materialFront: extractMaterialText(prod.description),
        tecnicas: getNormalizedPrintingTechniques(printingTechs),
        tecnicasFront: joinComma(printingTechs),
    });
    return mapShopMetafields(filterMetafieldKeys(logical, keys), ctx.shop);
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const prod = normalized.raw;
    const printingTechs = (prod.icons || []).filter(i => (icons || []).includes(i.label)).map(i => i.label);

    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: `${(prod.name || '').replace(/["¨“”]/g, '').replace(/\s+/g, ' ')} ${prod.code}`.trim().toUpperCase(),
        descriptionHtml: prod.description,
        vendor: vendor.name,
        tags: getCategories(prod),
        metafields: mapShopMetafields([
            { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: getNormalizedSurface(prod.description) },
            { key: 'material_front', namespace: 'custom', type: 'single_line_text_field', value: extractMaterialText(prod.description) },
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: getNormalizedPrintingTechniques(printingTechs) },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field', value: joinComma(printingTechs) },
            ...(prod.packing && prod.packing.width ? [{
                key: 'peso', namespace: 'custom', type: 'single_line_text_field', value: `${(parseFloat(prod.packing.weight) / prod.packing.quantity).toFixed(2)} kg`,
                key: 'peso_de_caja', namespace: 'custom', type: 'single_line_text_field', value: `${prod.packing.weight} kg`,
                key: 'medidas_de_caja', namespace: 'custom', type: 'single_line_text_field', value: `${prod.packing.height} x ${prod.packing.width} x ${prod.packing.depth} cm`,
            }] : []),
            ...(prod.packing && prod.packing.quantity ? [{
                key: 'piezas_por_caja', namespace: 'custom', type: 'single_line_text_field', value: String(prod.packing.quantity),
            }] : []),
        ], shop),
        productOptions: [{ name: 'Color', values: [{ name: 'Default' }] }],
    };
    return { input: addCantidadOption(base, shop), meta: {} };
}

function getImageKey(url) {
    const m = String(url || '').match(/\/medium\/([^?]+)/);
    return m ? m[1].toLowerCase() : String(url || '').toLowerCase();
}

function scoreImage(url) {
    const u = String(url || '').toLowerCase();
    let s = 0;
    if (u.includes('gama') || u.includes('colores')) s += 50;
    if (u.includes('mex') || u.includes('mexico')) s += 30;
    if (u.includes('completa')) s += 20;
    return s;
}

function buildMedia(prod) {
    const variants = prod.variants || [];
    const groups = new Map();
    const media = [];

    for (const v of variants) {
        const colorName = (v.color && v.color.name) || ((v.colors || []).map(c => c.name).join('/'));
        if (v.detail_picture && v.detail_picture.medium) {
            media.push({ alt: colorName, mediaContentType: 'IMAGE', originalSource: v.detail_picture.medium });
        }
    }
    for (const v of variants) {
        for (const p of (v.other_pictures || [])) {
            if (!p || !p.medium) continue;
            const key = getImageKey(p.medium);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push({ url: p.medium });
        }
    }
    for (const [, imgs] of groups) {
        media.push({ mediaContentType: 'IMAGE', originalSource: imgs[0].url });
    }
    media.sort((a, b) => scoreImage(b.originalSource) - scoreImage(a.originalSource));
    return media;
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx) {
    const { locationId, computeTargetPrice } = ctx;
    const colorName = (rawVariant.color && rawVariant.color.name) || ((rawVariant.colors || []).map(c => c.name).join('/'));
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === colorName);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    return {
        inventoryItem: { sku: rawVariant.sku, tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant.stock_available) || 0, locationId }],
        optionValues: [{ name: String(colorName).toUpperCase(), optionName: 'Color' }],
        price: computeTargetPrice(Number(rawVariant.net_price)),
        taxable: false,
    };
}

function expandVariantsForUpload(normalized, ctx, productResponse) {
    const productMediaNodes = productResponse && productResponse.media && productResponse.media.nodes;
    const out = [];
    for (const v of normalized.raw.variants || []) {
        const base = buildBaseVariantPayload(v, productMediaNodes, ctx);
        out.push(...expandVariantForShopify(base, ctx.shop));
    }
    return out;
}

async function uploadNewProduct(normalized, ctx) {
    const { input } = buildProductInput(normalized, ctx);
    const media = buildMedia(normalized.raw);
    const productResponse = await ctx.shopifyFns.productCreate(input, media);
    if (!productResponse || !productResponse.id) throw new Error(`productCreate vacío para ${normalized.code}`);
    const expanded = expandVariantsForUpload(normalized, ctx, productResponse);
    await ctx.shopifyFns.productVariantsBulkCreate(productResponse.id, expanded.map(e => e.payload));
    await ctx.shopifyFns.publishProduct(productResponse.id, ctx.publications);
    return productResponse;
}

module.exports = {
    fetchCatalog,
    buildProductInput,
    buildMetafieldsForUpdate,
    expandVariantsForUpload,
    uploadNewProduct,
    buildAllMedia: (n) => buildMedia(n.raw),
    buildVariantPayloadForExisting: (e) => e.payload,
    getShopifyVariantKey,
};
