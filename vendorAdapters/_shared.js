const axios = require('axios');
const sharp = require('sharp');

const DEFAULT_SCALES = [100, 500, 1000];

function getScales(shop) {
    return Array.isArray(shop.scales) && shop.scales.length > 0 ? shop.scales : DEFAULT_SCALES;
}

function isEscalas(shop) {
    return shop && shop.productFormat === 'escalas';
}

function addCantidadOption(productInput, shop) {
    if (!isEscalas(shop)) return productInput;
    return {
        ...productInput,
        productOptions: [
            ...productInput.productOptions,
            { name: 'Cantidad', values: [{ name: 'Default' }] },
        ],
    };
}

function getShopifyVariantKey(shopifyVariant, shop) {
    const sku = shopifyVariant.sku || '';
    if (!isEscalas(shop)) return sku;
    const cantidadOpt = (shopifyVariant.selectedOptions || []).find(o => o.name === 'Cantidad');
    if (!cantidadOpt) return sku;
    return `${sku}::${cantidadOpt.value}`;
}

function expandVariantForShopify(baseVariant, shop) {
    if (!isEscalas(shop)) {
        return [{
            key: baseVariant.inventoryItem.sku,
            payload: baseVariant,
            cantidad: null,
        }];
    }
    const scales = getScales(shop);
    const out = [];
    for (const cantidad of scales) {
        const copy = JSON.parse(JSON.stringify(baseVariant));
        copy.price = (Number(baseVariant.price) * cantidad).toFixed(2);
        if (Array.isArray(copy.inventoryQuantities) && copy.inventoryQuantities[0]) {
            const stock = Number(copy.inventoryQuantities[0].availableQuantity) || 0;
            copy.inventoryQuantities[0].availableQuantity = stock >= cantidad ? 1 : 0;
        }
        copy.optionValues = [
            ...(baseVariant.optionValues || []).filter(o => o.optionName !== 'Cantidad'),
            { name: String(cantidad), optionName: 'Cantidad' },
        ];
        out.push({
            key: `${baseVariant.inventoryItem.sku}::${cantidad}`,
            payload: copy,
            cantidad,
        });
    }
    return out;
}

async function downloadAndStageImage(url, filename, shopifyFns, opts = {}) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    let buffer = Buffer.from(response.data, 'binary');
    const MAX = 20 * 1024 * 1024;
    if (buffer.length > MAX) {
        buffer = await sharp(buffer).jpeg({ quality: 80 }).toBuffer();
    }
    const safeName = String(filename || 'image').replace(/[^a-zA-Z0-9._-]+/g, '-') + '.jpg';
    const target = await shopifyFns.createStagedUpload([{
        filename: safeName,
        httpMethod: 'POST',
        mimeType: 'image/jpeg',
        resource: 'IMAGE',
    }]);
    return await shopifyFns.uploadFileToStagedTarget(target, buffer, safeName);
}

async function buildMediaFromUrls(urls, ctx, { stage = false } = {}) {
    const media = [];
    for (const item of urls) {
        const url = typeof item === 'string' ? item : item.url;
        const alt = typeof item === 'string' ? '' : (item.alt || '');
        if (!url) continue;
        try {
            const finalUrl = stage
                ? await downloadAndStageImage(url, alt || 'img', ctx.shopifyFns)
                : url;
            media.push({ alt, mediaContentType: 'IMAGE', originalSource: finalUrl });
        } catch (err) {
            console.warn(`[media] skip ${url}: ${err.message}`);
        }
    }
    return media;
}

function slugify(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

// Los adapters emiten metafields con KEYS LÓGICAS canónicas (material, medidas,
// tecnicas_de_impresion, capacidad, area_de_impresion, peso, peso_de_caja,
// medidas_de_caja, piezas_por_caja, tecnicas_de_impresion_front). Cada tienda
// define en shops.json un mapeo logicalKey -> keyReal (string) o
// { key, namespace }. Si la tienda no incluye una key lógica, ese metafield se
// omite (no está habilitado en esa tienda). Si la tienda no define `metafields`,
// se conservan las keys lógicas tal cual (comportamiento por defecto).
function mapShopMetafields(logicalMetafields, shop) {
    const mapping = shop && shop.metafields;
    if (!mapping) return logicalMetafields;

    const out = [];
    for (const mf of logicalMetafields) {
        if (mf == null) continue;
        const target = mapping[mf.key];
        if (!target) continue; // deshabilitado en esta tienda
        if (typeof target === 'string') {
            out.push({ ...mf, key: target });
        } else if (typeof target === 'object') {
            out.push({ ...mf, key: target.key || mf.key, namespace: target.namespace || mf.namespace });
        }
    }
    return out;
}

module.exports = {
    DEFAULT_SCALES,
    getScales,
    isEscalas,
    addCantidadOption,
    getShopifyVariantKey,
    expandVariantForShopify,
    downloadAndStageImage,
    buildMediaFromUrls,
    mapShopMetafields,
    slugify,
};
