const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { categories, printingTechniques, normalizedSurfaces, normalizedPrintingTechniques, warehouses } = require('./dkps.constants');
const { buildHandle } = require('../handleParser');
const { addCantidadOption, expandVariantForShopify, getShopifyVariantKey, mapShopMetafields, buildClassificationMetafields, filterMetafieldKeys, joinComma } = require('./_shared');

const PRODUCTS_URL = 'https://bfekkcapbvnilicqzpkr.supabase.co/functions/v1/api-rest/api/productos';
const STOCKS_URL = 'https://bfekkcapbvnilicqzpkr.supabase.co/functions/v1/api-rest/api/productos/precios-existencias';
const WEB_URL = 'https://bfekkcapbvnilicqzpkr.supabase.co/rest/v1/articulos';

async function getDKPSPage(url, pagina) {
    const r = await axios.get(url, {
        params: { pagina, limite: 100 },
        headers: { 'Authorization': `Bearer ${process.env.DKPS_AUTH_TOKEN}` },
    });
    return r.data;
}

async function paginate(url) {
    const first = await getDKPSPage(url, 1);
    let items = first.data || [];
    const pages = (first.pagination && first.pagination.totalPages) || 1;
    for (let p = 2; p <= pages; p++) {
        const r = await getDKPSPage(url, p);
        items = items.concat(r.data || []);
    }
    return items;
}

async function getWebProducts() {
    if (!process.env.DKPS_WEB_AUTH_TOKEN) return [];
    const r = await axios.get(WEB_URL, {
        params: { order: 'id.desc', select: 'modelo,codigo_producto,ArticuloNuevo,ArticuloPromocion' },
        headers: { 'Apikey': process.env.DKPS_WEB_AUTH_TOKEN },
    });
    return r.data || [];
}

async function fetchCatalog({ vendor }) {
    const products = await paginate(PRODUCTS_URL);
    const stocks = await paginate(STOCKS_URL);
    const webProducts = await getWebProducts();

    const stockBySku = new Map(stocks.map(s => [s.sku, s]));
    const byModel = new Map();
    for (const p of products) {
        const model = String(p.sku).split('-')[0];
        if (!byModel.has(model)) byModel.set(model, []);
        byModel.get(model).push(p);
    }

    const out = [];
    for (const [model, group] of byModel) {
        const head = group[0];
        const webMatches = webProducts.filter(w => w.modelo === model);
        const isNew = webMatches.some(w => w.ArticuloNuevo === 'SI');
        const isOnOffer = webMatches.some(w => w.ArticuloPromocion === 'SI');
        out.push({
            code: model.toLowerCase(),
            name: (head.familia || '').replace(/^#\d+\s*/, '').trim(),
            rawPrice: Number((stockBySku.get(head.sku) && stockBySku.get(head.sku).precios && stockBySku.get(head.sku).precios[0] && stockBySku.get(head.sku).precios[0].precio) || 0),
            isNewExplicit: isNew,
            isDiscontinuedExplicit: null,
            isOnOfferExplicit: isOnOffer,
            variants: group.map(v => {
                const inv = stockBySku.get(v.sku);
                const stock = inv ? variantInventory(inv) : 0;
                const price = inv && inv.precios && inv.precios[0] ? Number(inv.precios[0].precio) : 0;
                return {
                    sku: v.sku,
                    key: v.sku,
                    name: (v.colorProducto || []).join(''),
                    rawPrice: price,
                    available: stock > 0,
                    raw: { ...v, _stock: stock, _price: price },
                };
            }),
            raw: { head, group, webProducts },
        });
    }
    return out;
}

function variantInventory(inv) {
    return (inv.existencias || []).reduce((acc, w) => warehouses.includes(w.almacen) ? acc + (Number(w.cantidad) || 0) : acc, 0);
}

function productHasSize(group) {
    return !group.some(v => (v.tallas || []).includes('UN'));
}

function getCategories(prod, webProducts, model) {
    let extra = '';
    if (prod.categoria === 'MOCHILAS Y MORRALES') {
        extra += (prod.familia || '').includes('MORRAL') ? 'textil,bolsas y morrales' : 'textil,mochilas y maletas';
    }
    const matches = (webProducts || []).filter(p => p.modelo === model);
    extra += matches.some(p => p.ArticuloNuevo === 'SI') ? ',nuevo' : '';
    extra += matches.some(p => p.ArticuloPromocion === 'SI') ? ',oferta' : '';
    return (categories[prod.categoria] || '') + extra;
}

function getPrintingTechs(prod, model) {
    let arr = JSON.parse(JSON.stringify(printingTechniques[prod.categoria] || []));
    const sublimationModels = ['B000100','D000710','D000701','D000601','D000600','D000405','D000400','D000130','D000125'];
    if (['MOCHILAS Y MORRALES', 'GORRAS'].includes(prod.categoria) && !sublimationModels.includes(model)) arr.pop();
    if (prod.categoria === 'TERMOS') {
        if (['T000160', 'T000170'].includes(model)) arr.pop();
        if (prod.materialProducto === 'Acero inoxidable / plástico') arr = ['Grabado Láser', 'DTF UV'];
    }
    return arr;
}

function getNormalizedPrintingTechs(arr) {
    return [...new Set((arr || []).map(t => normalizedPrintingTechniques[t] || ''))].filter(Boolean).join('-');
}

// Actualización puntual de metafields (ver reconcileMetafields). No corre en el
// ciclo normal del watcher.
function buildMetafieldsForUpdate(normalized, ctx, keys) {
    const head = normalized.raw.head;
    const model = normalized.code;
    const techs = getPrintingTechs(head, model);
    const values = {
        tecnicas: getNormalizedPrintingTechs(techs),
        tecnicasFront: joinComma(techs),
    };
    if (head.materialProducto) {
        values.material = normalizedSurfaces[head.materialProducto] || '';
        values.materialFront = head.materialProducto ;
    }
    return mapShopMetafields(filterMetafieldKeys(buildClassificationMetafields(values), keys), ctx.shop);
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const head = normalized.raw.head;
    const model = normalized.code;
    const tags = getCategories(head, normalized.raw.webProducts, model);
    const techs = getPrintingTechs(head, model);
    const hasSize = productHasSize(normalized.raw.group);

    const base = {
        handle: buildHandle(shop, vendor, model, normalized.name),
        title: `${normalized.name} ${model}`.toUpperCase(),
        descriptionHtml: head.descripcion,
        vendor: vendor.name,
        tags,
        metafields: mapShopMetafields([
            ...(head.materialProducto ? [
                { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: normalizedSurfaces[head.materialProducto] || '' },
                { key: 'material_front', namespace: 'custom', type: 'single_line_text_field', value: head.materialProducto }
            ] : []),
            ...(head.medidaProducto ? [{ key: 'medidas', namespace: 'custom', type: 'single_line_text_field', value: `${head.medidaProducto} cm` }] : []),
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: getNormalizedPrintingTechs(techs) },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field', value: joinComma(techs) },
            ...(head.capacidadProducto ? [{ key: 'capacidad', namespace: 'custom', type: 'single_line_text_field', value: head.capacidadProducto }] : []),
            ...(head.pesoCaja ? [
                { key: 'peso', namespace: 'custom', type: 'single_line_text_field', value: `${(head.pesoCaja / head.piezasPorCaja).toFixed(2)} kg` },
                { key: 'peso_de_caja', namespace: 'custom', type: 'single_line_text_field', value: `${head.pesoCaja} kg` }
            ] : []),
            ...(head.medidaCaja ? [{ key: 'medidas_de_caja', namespace: 'custom', type: 'single_line_text_field', value: `${head.medidaCaja} cm` }] : []),
            { key: 'piezas_por_caja', namespace: 'custom', type: 'single_line_text_field', value: String(head.piezasPorCaja || '') },
        ], shop),
        productOptions: [
            { name: 'Color', values: [{ name: 'Default' }] },
            ...(hasSize ? [{ name: 'Talla', values: [{ name: 'Default' }] }] : []),
        ],
    };
    return { input: addCantidadOption(base, shop), meta: { hasSize } };
}

async function buildMedia(group, ctx) {
    let variantMedia = [];
    for (const v of group) {
        const color = (v.colorProducto || []).join('');
        if ((v.imagenesAdicionales || []).length === 0) {
            if (v.imagenPrincipal && v.imagenPrincipal.url) {
                variantMedia.push({ alt: color, mediaContentType: 'IMAGE', originalSource: v.imagenPrincipal.url });
            }
        } else {
            const sorted = [...v.imagenesAdicionales]
                .sort((a, b) => {
                    const am = parseInt((a.nombreArchivo || '').match(/(\d+)\./) ? RegExp.$1 : '0', 10);
                    const bm = parseInt((b.nombreArchivo || '').match(/(\d+)\./) ? RegExp.$1 : '0', 10);
                    return am - bm;
                })
                .sort((a, b) => {
                    const aHas = (a.nombreArchivo || '').includes(`${color}.`);
                    const bHas = (b.nombreArchivo || '').includes(`${color}.`);
                    if (aHas !== bHas) return bHas - aHas;
                    return 0;
                });
            sorted.forEach((img, i) => {
                variantMedia.push({ alt: i === 0 ? color : img.nombreArchivo, mediaContentType: 'IMAGE', originalSource: img.url });
            });
        }
    }
    const seen = [];
    const filtered = variantMedia.filter(item => {
        if (!item.alt) return true;
        if (seen.includes(item.alt)) return false;
        seen.push(item.alt);
        return true;
    });

    const ficha = group.map(g => g.fichaTecnica).find(f => f && f.url);
    if (ficha && ficha.url) {
        try {
            const url = await uploadTechnicalSpecs(ficha, ctx);
            if (url) filtered.push({ mediaContentType: 'IMAGE', originalSource: url });
        } catch (err) {
            console.warn(`[dkps] ficha técnica skip: ${err.message}`);
        }
    }
    return filtered;
}

async function uploadTechnicalSpecs(ficha, ctx) {
    const { fromPath } = require('pdf2pic');
    const tmpDir = require('os').tmpdir();
    const pdfPath = path.join(tmpDir, `dkps_ficha_${Date.now()}.pdf`);
    const imgPath = path.join(tmpDir, `dkps_ficha_${Date.now()}.1.jpg`);
    try {
        const r = await axios.get(ficha.url, { responseType: 'arraybuffer' });
        fs.writeFileSync(pdfPath, r.data);
        const convert = fromPath(pdfPath, {
            density: 150, saveFilename: path.basename(imgPath, '.1.jpg'), savePath: tmpDir,
            format: 'jpg', width: 1200, height: 1600,
        });
        await convert(1);
        const buf = fs.readFileSync(imgPath);
        const target = await ctx.shopifyFns.createStagedUpload([{
            filename: path.basename(imgPath), httpMethod: 'POST', mimeType: 'image/jpeg', resource: 'IMAGE',
        }]);
        return await ctx.shopifyFns.uploadFileToStagedTarget(target, buf, path.basename(imgPath));
    } finally {
        if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
        if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx, hasSize) {
    const { locationId, computeTargetPrice } = ctx;
    const color = (rawVariant.colorProducto || []).join('');
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === color);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    return {
        inventoryItem: { sku: rawVariant.sku, tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant._stock) || 0, locationId }],
        optionValues: [
            { name: color, optionName: 'Color' },
            ...(hasSize ? [{ name: (rawVariant.tallas || []).join(''), optionName: 'Talla' }] : []),
        ],
        price: computeTargetPrice(Number(rawVariant._price) || 0),
        taxable: false,
    };
}

function expandVariantsForUpload(normalized, ctx, productResponse) {
    const productMediaNodes = productResponse && productResponse.media && productResponse.media.nodes;
    const hasSize = productHasSize(normalized.raw.group);
    const out = [];
    for (const v of normalized.variants) {
        const base = buildBaseVariantPayload(v.raw, productMediaNodes, ctx, hasSize);
        out.push(...expandVariantForShopify(base, ctx.shop));
    }
    return out;
}

async function uploadNewProduct(normalized, ctx) {
    const { input } = buildProductInput(normalized, ctx);
    const media = await buildMedia(normalized.raw.group, ctx);
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
    buildAllMedia: (n, ctx) => buildMedia(n.raw.group, ctx),
    buildVariantPayloadForExisting: (e) => e.payload,
    getShopifyVariantKey,
};
