const axios = require('axios');
const { categories, ecoCategories, printingTechniquesFront } = require('./promoopcion.constants');
const { buildHandle } = require('../handleParser');
const { addCantidadOption, expandVariantForShopify, getShopifyVariantKey, mapShopMetafields } = require('./_shared');

async function fetchAllProducts(vendor) {
    const r = await axios.post(vendor.endpoint, JSON.stringify({
        user: process.env.PO_USER,
        password: process.env.PO_PASS,
    }), { headers: { 'Content-Type': 'application/json' } });
    return r.data;
}

async function fetchAllStocks() {
    const r = await axios.post('https://promocionalesenlinea.net/api/all-stocks', JSON.stringify({
        user: process.env.PO_USER,
        password: process.env.PO_PASS,
    }), { headers: { 'Content-Type': 'application/json' } });
    return r.data;
}

function variantInventory(stocks, sku) {
    const rows = (stocks.Stocks || []).filter(s => s.Material === sku);
    return rows.reduce((acc, s) => acc + (Number(s.Stock) || 0), 0);
}

async function fetchCatalog({ vendor }) {
    const products = await fetchAllProducts(vendor);
    const stocks = await fetchAllStocks();

    const list = Array.isArray(products) ? products : (products.response || []);
    return list.map(prod => {
        const hijos = prod.hijos || [];
        // PromoOpción NO expone un campo explícito de "producto nuevo": la tag "nuevo"
        // se rige únicamente por la ventana de vencimiento (Caso 2).
        const isNewExplicit = null;
        // Descontinuado: TODOS los hijos con estatus "0" (string). Este campo se usa
        // EXCLUSIVAMENTE para discontinuación; no filtra ni afecta las variantes.
        const isDiscontinuedExplicit = hijos.length > 0 && hijos.every(h => String(h.estatus) === '0');
        // Oferta: PromoOpción marca con tipo "Outlet" en alguno de los hijos.
        const isOnOfferExplicit = hijos.some(v => v.tipo === 'Outlet');
        return {
            code: String(prod.skuPadre).toLowerCase().replace(/-+$/g, '').replace(/[\s]+/g, '-'),
            name: prod.nombrePadre,
            rawPrice: Number((prod.hijos && prod.hijos[0] && prod.hijos[0].precio) || 0),
            isNewExplicit,
            isDiscontinuedExplicit,
            isOnOfferExplicit,
            variants: (prod.hijos || []).map(v => ({
                sku: v.skuHijo,
                key: v.skuHijo,
                name: v.color + (v.talla ? ` ${v.talla}` : ''),
                rawPrice: Number(v.precio),
                available: variantInventory(stocks, v.skuHijo) > 0,
                raw: { ...v, _stock: variantInventory(stocks, v.skuHijo) },
            })),
            raw: { prod, stocks },
        };
    });
}

function productHasSize(prod) {
    return (prod.hijos || []).some(v => v.talla !== null && v.talla !== undefined);
}

function getCategories(prod) {
    let extra = '';
    extra += (prod.hijos || []).some(v => v.tipo === 'Outlet') ? ',oferta' : '';
    extra += String(prod.skuPadre || '').startsWith('SOC') ? ',mundial' : '';
    if ((prod.descripcion || '').includes('ecológic')) {
        extra += ecoCategories[`${prod.categorias} - ${prod.subCategorias}`.trim()] || '';
    }
    return (categories[`${prod.categorias} - ${prod.subCategorias}`.trim()] || '') + extra;
}

function getPrintingTechniquesFront(techniques) {
    if (!techniques) return '';
    const arr = String(techniques).split('/').map(t => printingTechniquesFront[t.trim()] || '');
    const isMulti = arr.some(t => t.includes('#-#'));
    return isMulti ? arr.join('*-*') : arr.join('/-/');
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const prod = normalized.raw.prod;
    const replaceString = 'Este producto por ser últimas piezas puede presentar alguna variación, no se aceptan devoluciones.';
    const hasSize = productHasSize(prod);

    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: `${prod.nombrePadre} ${prod.skuPadre}`.trim(),
        descriptionHtml: (prod.descripcion || '').replace(replaceString, '').trim(),
        vendor: vendor.name,
        tags: getCategories(prod),
        metafields: mapShopMetafields([
            { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: prod.material || '' },
            { key: 'medidas', namespace: 'custom', type: 'single_line_text_field', value: prod.medidas || '' },
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: (prod.impresion && prod.impresion.tecnicaImpresion) || '' },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field', value: getPrintingTechniquesFront(prod.impresion && prod.impresion.tecnicaImpresion) },
            { key: 'capacidad', namespace: 'custom', type: 'single_line_text_field', value: prod.capacidad || '' },
            { key: 'area_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: (prod.impresion && prod.impresion.areaImpresion) || '' },
            { key: 'peso', namespace: 'custom', type: 'single_line_text_field', value: prod.paquete && prod.paquete.pesoNeto && prod.paquete.PiezasCaja ? `${(prod.paquete.pesoNeto / parseInt(prod.paquete.PiezasCaja, 10)).toFixed(2)} kg` : '', },
            { key: 'peso_de_caja', namespace: 'custom', type: 'single_line_text_field', value: prod.paquete && prod.paquete.pesoNeto ? `${prod.paquete.pesoNeto} kg` : '', },
            { key: 'medidas_de_caja', namespace: 'custom', type: 'single_line_text_field', value: prod.paquete && prod.paquete.alto && prod.paquete.largo && prod.paquete.ancho ? `${(parseFloat(prod.paquete.alto) * 100).toFixed(1)} x ${(parseFloat(prod.paquete.largo) * 100).toFixed(1)} x ${(parseFloat(prod.paquete.ancho) * 100).toFixed(1)} cm` : '', },
            { key: 'piezas_por_caja', namespace: 'custom', type: 'single_line_text_field', value: String((prod.paquete && prod.paquete.PiezasCaja) || '') },
        ], shop),
        productOptions: [
            { name: 'Color', values: [{ name: 'Default' }] },
            ...(hasSize ? [{ name: 'Talla', values: [{ name: 'Default' }] }] : []),
        ],
    };
    return { input: addCantidadOption(base, shop), meta: { hasSize } };
}

function buildMedia(prod) {
    const productMedia = (prod.imagenesPadre || []).map(src => ({
        mediaContentType: 'IMAGE',
        originalSource: encodeURI(String(src).replace(/[\s]+/g, '-')),
    }));
    const vectorMedia = (prod.imagenesVector || []).map(src => ({
        mediaContentType: 'IMAGE',
        originalSource: encodeURI(String(src).replace(/[\s]+/g, '-')),
    }));
    const variantMedia = (prod.hijos || []).flatMap(v => (v.imagenesHijo || []).map((src, i) => ({
        alt: i === 0 ? v.color : '',
        mediaContentType: 'IMAGE',
        originalSource: encodeURI(String(src).replace(/[\s]+/g, '-')),
    })));
    const all = [...productMedia, ...variantMedia, ...vectorMedia];
    const seenColors = [];
    return all.filter(item => {
        if (!item.alt) return true;
        if (seenColors.includes(item.alt)) return false;
        seenColors.push(item.alt);
        return true;
    });
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx, hasSize) {
    const { locationId, computeTargetPrice } = ctx;
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === rawVariant.color);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    return {
        inventoryItem: { sku: rawVariant.skuHijo, tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant._stock) || 0, locationId }],
        optionValues: [
            { name: rawVariant.color, optionName: 'Color' },
            ...(hasSize ? [{ name: rawVariant.talla || 'UNICA', optionName: 'Talla' }] : []),
        ],
        price: computeTargetPrice(Number(rawVariant.precio)),
        taxable: false,
    };
}

function expandVariantsForUpload(normalized, ctx, productResponse) {
    const productMediaNodes = productResponse && productResponse.media && productResponse.media.nodes;
    const hasSize = productHasSize(normalized.raw.prod);
    const out = [];
    for (const v of normalized.raw.prod.hijos || []) {
        const base = buildBaseVariantPayload(v, productMediaNodes, ctx, hasSize);
        out.push(...expandVariantForShopify(base, ctx.shop));
    }
    return out;
}

async function uploadNewProduct(normalized, ctx) {
    const { input } = buildProductInput(normalized, ctx);
    const media = buildMedia(normalized.raw.prod);
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
    buildAllMedia: (n) => buildMedia(n.raw.prod),
    buildVariantPayloadForExisting: (e) => e.payload,
    getShopifyVariantKey,
};
