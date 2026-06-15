const axios = require('axios');
const { buildHandle } = require('../handleParser');
const { addCantidadOption, expandVariantForShopify, getShopifyVariantKey, mapShopMetafields } = require('./_shared');

const surfaces = {
    'POLIESTER FINO': 'TEXTIL', 'NYLON LIGHT': 'TEXTIL', 'MICROFIBRA PARIS': 'TEXTIL',
    'NEOPRENO': 'TEXTIL', 'ALGODON PIQUE': 'TEXTIL', 'ALGODON': 'TEXTIL',
};
const categoryMap = {
    'CHAMARRA': 'textil,chamarras y chalecos',
    'CHALECO': 'textil,chamarras y chalecos',
    'POLO BASICA': 'textil,playeras',
    'CAMISA': 'textil,playeras',
};
const colorMap = {
    'MAR': 'MARINO', 'NEG': 'NEGRO', 'GRO': 'GRIS', 'VIN': 'VINO', 'AZA': 'AZUL ACERO',
    'ROJ': 'ROJO', 'OLI': 'OLIVO', 'ARE': 'ARENA', 'CHO': 'CHOCOLATE', 'TOP': 'TOPO',
    'BLA': 'BLANCO', 'CIE': 'AZUL CIELO', 'OXJ': 'OXFORD', 'AZU': 'AZUL CIAN', 'ROS': 'ROSA',
};

async function fetchCatalog({ vendor }) {
    const r = await axios.get(vendor.endpoint, { headers: { 'x-api-key': process.env.PW_KEY } });
    const list = r.data;

    const byModel = new Map();
    for (const p of list) {
        if (!byModel.has(p.modelo)) byModel.set(p.modelo, []);
        byModel.get(p.modelo).push(p);
    }

    const out = [];
    for (const [modelo, group] of byModel) {
        const head = group[0];
        out.push({
            code: String(modelo),
            name: `${head.linea} ${head.departamento} ${head.nombre} ${head.modelo}`,
            rawPrice: Number(head.precio_distribuidor),
            isNewExplicit: null,
            isDiscontinuedExplicit: null,
            isOnOfferExplicit: null,
            variants: group.map(v => ({
                sku: v.modelo_ct,
                key: `${v.color}-${v.talla}`,
                name: `${colorMap[v.color] || v.color} ${v.talla}`,
                rawPrice: Number(v.precio_distribuidor),
                available: Number(v.disponible) > 0,
                raw: v,
            })),
            raw: { head, group },
        });
    }
    return out;
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const head = normalized.raw.head;
    const productTitle = `${head.linea} ${head.departamento} ${head.nombre} ${head.modelo}`;

    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: productTitle,
        descriptionHtml: head.descripcion,
        vendor: vendor.name,
        tags: `preslow,${categoryMap[head.linea] || ''}`,
        metafields: mapShopMetafields([
            { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: surfaces[head.tela] || head.tela || '' },
        ], shop),
        productOptions: [
            { name: 'Color', values: [{ name: 'Default' }] },
            { name: 'Talla', values: [{ name: 'Default' }] },
        ],
    };
    return { input: addCantidadOption(base, shop), meta: {} };
}

function buildMedia(group) {
    const seenImages = new Set();
    const seenColors = new Set();
    return group.flatMap(p => (p.imagenes || []).map(img => ({ src: img, color: p.color })))
        .filter(img => {
            if (seenImages.has(img.src)) return false;
            seenImages.add(img.src);
            return true;
        })
        .map(img => {
            const colorName = colorMap[img.color] || img.color;
            if (!seenColors.has(colorName)) {
                seenColors.add(colorName);
                return { mediaContentType: 'IMAGE', originalSource: img.src, alt: colorName };
            }
            return { mediaContentType: 'IMAGE', originalSource: img.src };
        });
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx) {
    const { locationId, computeTargetPrice } = ctx;
    const colorName = colorMap[rawVariant.color] || rawVariant.color;
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === colorName);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    return {
        inventoryItem: { sku: rawVariant.modelo_ct, tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant.disponible) || 0, locationId }],
        optionValues: [
            { optionName: 'Color', name: colorName },
            { optionName: 'Talla', name: rawVariant.talla },
        ],
        price: computeTargetPrice(Number(rawVariant.precio_distribuidor)),
        taxable: false,
    };
}

function expandVariantsForUpload(normalized, ctx, productResponse) {
    const productMediaNodes = productResponse && productResponse.media && productResponse.media.nodes;
    const out = [];
    for (const v of normalized.raw.group) {
        const base = buildBaseVariantPayload(v, productMediaNodes, ctx);
        out.push(...expandVariantForShopify(base, ctx.shop));
    }
    return out;
}

async function uploadNewProduct(normalized, ctx) {
    const { input } = buildProductInput(normalized, ctx);
    const media = buildMedia(normalized.raw.group);
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
    buildAllMedia: (n) => buildMedia(n.raw.group),
    buildVariantPayloadForExisting: (e) => e.payload,
    getShopifyVariantKey,
};
