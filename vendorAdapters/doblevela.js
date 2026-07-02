const axios = require('axios');
const { categories, extraCategories, printingTechniques, normalizedSurfaces, normalizedPrintingTechniques, warehouses } = require('./doblevela.constants');
const { buildHandle } = require('../handleParser');
const { printableSurface } = require('./surfaces');
const { addCantidadOption, expandVariantForShopify, getShopifyVariantKey, mapShopMetafields, buildClassificationMetafields, filterMetafieldKeys, joinComma } = require('./_shared');

async function fetchCatalog({ vendor }) {
    const r = await axios.get(vendor.endpoint, { params: { Key: process.env.DV_KEY } });
    const m = String(r.data).match(/<string[^>]*>(.*)<\/string>/s);
    const list = m ? JSON.parse(m[1]).Resultado : [];

    const byModel = new Map();
    for (const p of list) {
        const k = p.MODELO;
        if (p.Status === 'X') continue;
        if (!byModel.has(k)) byModel.set(k, []);
        byModel.get(k).push(p);
    }

    const out = [];
    for (const [modelo, group] of byModel) {
        const head = group[0];
        const isNew = head.Status === 'N';

        const isOnOffer = String(head.Status || '').includes('%');
        out.push({
            code: String(modelo).toLowerCase().replace(/[\s]+/g, '-'),
            name: head.NOMBRE,
            rawPrice: Number(head.Price),
            isNewExplicit: isNew,
            isDiscontinuedExplicit: null,
            isOnOfferExplicit: isOnOffer,
            variants: group.map(v => ({
                sku: v.CLAVE,
                key: (v.COLOR || '').split(' - ')[1] || v.COLOR,
                name: (v.COLOR || '').split(' - ')[1] || v.COLOR,
                rawPrice: Number(v.Price),
                available: variantInventory(v) > 0,
                raw: { ...v, _stock: variantInventory(v) },
            })),
            raw: { head, group },
        });
    }
    return out;
}

function variantInventory(variant) {
    return warehouses.reduce((acc, w) => acc + (Number(variant[w]) || 0), 0);
}

function getNormalizedPrintingTechniques(t) {
    if (!t) return '';
    const arr = String(t).split(' ').map(s => normalizedPrintingTechniques[s.trim()] || '').filter(Boolean);
    return [...new Set(arr)].join('-');
}

function getCategories(prod) {
    let extra = '';
    extra += prod.Status === 'N' ? ',nuevo' : '';
    extra += String(prod.Status || '').includes('%') ? ',oferta' : '';
    if (prod.SubFamilia === 'TAZAS Y TERMOS') {
        const fw = (prod.Descripcion || '').split(' ')[0];
        extra += extraCategories[`${fw}`];
    }
    const cs = `${prod.Familia} - ${prod.SubFamilia}`;
    if ((prod.Descripcion || '').includes('ecológic')) extra += extraCategories[cs];
    if ((prod.NOMBRE || '').includes('SOCCER')) extra += ',mundial';
    return (categories[cs] || '') + extra;
}

function buildMetafieldsForUpdate(normalized, ctx, keys) {
    const head = normalized.raw.head;
    const materialRaw = (head.Material || '').replace(/\r/g, ' ');
    const logical = buildClassificationMetafields({
        material: printableSurface(materialRaw, head.Descripcion, normalizedSurfaces),
        materialFront: materialRaw,
        tecnicas: getNormalizedPrintingTechniques(head['Tipo Impresion']),
        tecnicasFront: joinComma((head['Tipo Impresion'] || '').split(' ').map(t => printingTechniques[t] || '')),
    });
    return mapShopMetafields(filterMetafieldKeys(logical, keys), ctx.shop);
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const head = normalized.raw.head;
    const materialRaw = (head.Material || '').replace(/\r/g, ' ');
    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: `${(head.NOMBRE || '').slice(0, (head.NOMBRE || '').indexOf(head.MODELO) + (head.MODELO || '').length).trim().replace(/[.,]/g, '')}`,
        descriptionHtml: head.Descripcion,
        vendor: vendor.name,
        tags: getCategories(head),
        metafields: mapShopMetafields([
            { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: printableSurface(materialRaw, head.Descripcion, normalizedSurfaces) },
            { key: 'material_front', namespace: 'custom', type: 'single_line_text_field', value: materialRaw },
            { key: 'medidas', namespace: 'custom', type: 'single_line_text_field', value: (head['Medida Producto'] || '').replace(/\r/g, ' ') },
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: getNormalizedPrintingTechniques(head['Tipo Impresion']) },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field', value: joinComma((head['Tipo Impresion'] || '').split(' ').map(t => printingTechniques[t] || '')) },
            { key: 'peso', namespace: 'custom', type: 'single_line_text_field', value: head['Peso Producto'] || '' },
            { key: 'peso_de_caja', namespace: 'custom', type: 'single_line_text_field', value: head['Peso caja'] || '' },
            { key: 'medidas_de_caja', namespace: 'custom', type: 'single_line_text_field', value: head['Medida Caja Master'] || '' },
            { key: 'piezas_por_caja', namespace: 'custom', type: 'single_line_text_field', value: String(head['Unidad Empaque'] || '') },
        ], shop),
        productOptions: [{ name: 'Color', values: [{ name: 'Default' }] }],
    };
    return { input: addCantidadOption(base, shop), meta: {} };
}

function buildMedia(group) {
    const baseUrl = 'https://doblevela.com/images/';
    const head = group[0];
    const modelo = String(head.MODELO || '').replace(/\s/g, '');
    const media = [{ mediaContentType: 'IMAGE', originalSource: `${baseUrl}large/${modelo}_lrg.jpg` }];
    for (const v of group) {
        const color = (v.COLOR || '').split(' - ')[1] || '';
        media.push({
            alt: color,
            mediaContentType: 'IMAGE',
            originalSource: `${baseUrl}large/${modelo}_${color.toLowerCase().replace(/\s/g, '')}_lrg.jpg`,
        });
    }
    for (let i = 1; i <= 12; i++) {
        media.push({ mediaContentType: 'IMAGE', originalSource: `${baseUrl}adicionales/_${modelo}_${i}.jpg` });
    }
    return media;
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx, colorCount) {
    const { locationId, computeTargetPrice } = ctx;
    const baseColor = (rawVariant.COLOR || '').split(' - ')[1] || rawVariant.COLOR;
    colorCount[baseColor] = (colorCount[baseColor] || 0) + 1;
    const colorName = colorCount[baseColor] === 1 ? baseColor : `${baseColor} ${colorCount[baseColor]}`;
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === baseColor);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    return {
        inventoryItem: { sku: rawVariant.CLAVE, tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant._stock) || 0, locationId }],
        optionValues: [{ name: colorName, optionName: 'Color' }],
        price: computeTargetPrice(Number(rawVariant.Price)),
        taxable: false,
    };
}

function expandVariantsForUpload(normalized, ctx, productResponse) {
    const productMediaNodes = productResponse && productResponse.media && productResponse.media.nodes;
    const colorCount = {};
    const out = [];
    for (const v of normalized.raw.group) {
        const base = buildBaseVariantPayload(v, productMediaNodes, ctx, colorCount);
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
    buildMetafieldsForUpdate,
    expandVariantsForUpload,
    uploadNewProduct,
    buildAllMedia: (n) => buildMedia(n.raw.group),
    buildVariantPayloadForExisting: (e) => e.payload,
    getShopifyVariantKey,
};
