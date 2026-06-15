const axios = require('axios');
const { categories, ecoCategories, normalizedSurfaces, normalizedPrintingTechniques } = require('./impressline.constants');
const { buildHandle } = require('../handleParser');
const { addCantidadOption, expandVariantForShopify, getShopifyVariantKey, mapShopMetafields } = require('./_shared');

async function fetchCatalog({ vendor }) {
    const r = await axios.get(vendor.endpoint, { headers: { 'Authorization': `Bearer ${process.env.ILN_AUTH_TOKEN}` } });
    const list = Array.isArray(r.data) ? r.data : (r.data.data || r.data.productos || []);

    return list.map(prod => ({
        code: String(prod.clave).toLowerCase().replace(/[\s]+/g, '-'),
        name: prod.nombre,
        rawPrice: Number(prod.precio_base),
        isNewExplicit: prod.tipo === 'nuevo',
        isDiscontinuedExplicit: null,
        isOnOfferExplicit: null,
        variants: (prod.skus || []).map(v => ({
            sku: v.sku,
            key: v.color,
            name: v.color,
            rawPrice: Number(prod.precio_base),
            available: Number(v.stock) > 0,
            raw: v,
        })),
        raw: prod,
    }));
}

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function getNormalizedPrintingTechniques(arr) {
    return [...new Set((arr || []).map(t => normalizedPrintingTechniques[t] || ''))].filter(Boolean).join('-');
}

function getCategories(prod) {
    let extra = '';
    extra += prod.tipo === 'nuevo' ? ',nuevo' : '';
    const cs = `${prod.categoria && prod.categoria.slug} - ${prod.subcategoria && prod.subcategoria.slug}`;
    const fw = normalize((prod.nombre || '').split(' ')[0]);
    if (cs === 'bolsas-backpacks-maletas-hieleras - backpack-mochilas-casuales') {
        extra += ['backpack', 'mochila'].includes(fw) ? ',textil,mochilas y maletas' : ',textil,gorras y cangureras';
    }
    if (cs === 'bebidas - tarros-vasos-tazas') {
        extra += ['vaso', 'tarro', 'set'].includes(fw) ? ',bebidas,vasos' : ',bebidas,tazas';
    }
    if (cs === 'casa-hogar - casa-hogar') {
        extra += ['contenedor', 'vaporizador'].includes(fw) ? ',hogar,accesorios del hogar' : ',hogar,cocina';
    }
    if (cs === 'outdoors-viajes-camping - outdoors-camping') {
        extra += fw === 'paraguas' ? ',textil,paraguas e impermeables'
            : fw === 'kit' ? ',tiempo libre,herramientas de trabajo' : ',hogar,cocina';
    }
    if ((prod.etiquetas || []).includes('producto-ecologico')) extra += ecoCategories[cs] || '';
    return (categories[cs] || '') + extra;
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const prod = normalized.raw;
    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: `${(prod.nombre || '').replace(/\.*$/, '')} ${prod.clave}`.toUpperCase(),
        descriptionHtml: prod.descripcion_completa,
        vendor: vendor.name,
        tags: getCategories(prod),
        metafields: mapShopMetafields([
            // { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: normalizedSurfaces[prod.material] || prod.material || '' },
            { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: prod.material || '' },
            { key: 'medidas', namespace: 'custom', type: 'single_line_text_field', value: prod.tamano || '' },
            // { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: getNormalizedPrintingTechniques(prod.tipos_impresion) },
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: prod.tipos_impresion.join(', ') },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field', value: prod.tipos_impresion.join('/-/') },
            { key: 'capacidad', namespace: 'custom', type: 'single_line_text_field', value: prod.capacidad || '' },
            { key: 'area_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: prod.area_impresion || '' },
            { key: 'peso', namespace: 'custom', type: 'single_line_text_field', value: prod.peso_caja && prod.piezas_por_caja ? `${(parseFloat(prod.peso_caja.replace(' kgs', '')) / prod.piezas_por_caja).toFixed(2)} kg` : '', },
            { key: 'peso_de_caja', namespace: 'custom', type: 'single_line_text_field', value: prod.peso_caja || '' },
            { key: 'piezas_por_caja', namespace: 'custom', type: 'single_line_text_field', value: String(prod.piezas_por_caja || '') },
        ], shop),
        productOptions: [{ name: 'Color', values: [{ name: 'Default' }] }],
    };
    return { input: addCantidadOption(base, shop), meta: {} };
}

function buildMedia(prod) {
    const principal = prod.imagen_principal;
    const productMedia = principal ? [{ mediaContentType: 'IMAGE', originalSource: principal }] : [];
    const variantMedia = (prod.skus || []).flatMap(v => (v.imagenes || [])
        .filter(src => src !== principal)
        .map((src, i) => ({ alt: i === 0 ? v.color : '', mediaContentType: 'IMAGE', originalSource: src })));
    return [...productMedia, ...variantMedia];
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx, prod, colorCount) {
    const { locationId, computeTargetPrice } = ctx;
    const baseColor = rawVariant.color;
    colorCount[baseColor] = (colorCount[baseColor] || 0) + 1;
    const colorName = colorCount[baseColor] === 1 ? baseColor : `${baseColor} ${colorCount[baseColor]}`;
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === baseColor);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    return {
        inventoryItem: { sku: rawVariant.sku, tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant.stock) || 0, locationId }],
        optionValues: [{ name: String(colorName || '').toUpperCase(), optionName: 'Color' }],
        price: computeTargetPrice(Number(prod.precio_base)),
        taxable: false,
    };
}

function expandVariantsForUpload(normalized, ctx, productResponse) {
    const productMediaNodes = productResponse && productResponse.media && productResponse.media.nodes;
    const colorCount = {};
    const out = [];
    for (const v of normalized.raw.skus || []) {
        const base = buildBaseVariantPayload(v, productMediaNodes, ctx, normalized.raw, colorCount);
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
    expandVariantsForUpload,
    uploadNewProduct,
    buildAllMedia: (n) => buildMedia(n.raw),
    buildVariantPayloadForExisting: (e) => e.payload,
    getShopifyVariantKey,
};
