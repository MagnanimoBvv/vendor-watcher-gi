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

// --- Actualización puntual de metafields (función "adaptable") -----------------
// Estos helpers dan soporte a una actualización on-demand de metafields que NO
// corre en el ciclo normal del watcher (ver reconcileMetafields / index.js
// --update-metafields). Hoy se usan para los 4 campos de clasificación, pero el
// diseño permite agregar más campos sin tocar la infraestructura.

// Une un valor en una sola cadena separada por coma. Acepta un array tal cual o
// una cadena que se parte por `sep` (default '/'). Limpia espacios y vacíos.
// Útil para los campos "_front" crudos (sin normalizar).
function joinComma(value, sep = '/') {
    const arr = Array.isArray(value) ? value : String(value == null ? '' : value).split(sep);
    return arr.map(s => String(s).trim()).filter(Boolean).join(', ');
}

// Mapeo prop -> key lógica canónica de la actualización de clasificación.
const CLASSIFICATION_METAFIELD_KEYS = {
    material: 'material',
    materialFront: 'material_front',
    tecnicas: 'tecnicas_de_impresion',
    tecnicasFront: 'tecnicas_de_impresion_front',
};

// Construye los metafields lógicos (namespace custom, texto) de la actualización
// de clasificación a partir de los valores YA calculados por cada adapter. Sólo
// incluye las props presentes (undefined = el vendor no expone esa key, p.ej.
// Preslow no tiene técnicas).
function buildClassificationMetafields(values) {
    const out = [];
    for (const [prop, key] of Object.entries(CLASSIFICATION_METAFIELD_KEYS)) {
        if (values[prop] === undefined) continue;
        out.push({ key, namespace: 'custom', type: 'single_line_text_field', value: values[prop] || '' });
    }
    return out;
}

// Filtra metafields lógicos por una lista de keys canónicas. keys nulo/vacío =>
// no filtra (devuelve todos). Permite a --metafields=key1,key2 restringir qué se
// actualiza.
function filterMetafieldKeys(logicalMetafields, keys) {
    if (!keys || keys.length === 0) return logicalMetafields;
    return logicalMetafields.filter(m => keys.includes(m.key));
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
    joinComma,
    buildClassificationMetafields,
    filterMetafieldKeys,
};
