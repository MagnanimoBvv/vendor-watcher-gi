const axios = require('axios');
const { buildHandle } = require('../handleParser');
const { printableSurface } = require('./surfaces');
const { addCantidadOption, applyDescriptionTemplate, expandVariantForShopify, getShopifyVariantKey, mapShopMetafields, buildClassificationMetafields, filterMetafieldKeys } = require('./_shared');
const { normalizedSurfaces, printingTechniques, secondaryOptions, primaryCategories, extraCategories } = require('./importacionesusb.constants');

function norm(s) {
    return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function skuParts(sku) {
    const [model = '', segment = '', color = ''] = String(sku || '').split('-');
    return { model, segment, color };
}

async function fetchCatalog({ vendor }) {
    const r = await axios.get(vendor.endpoint);
    const body = r.data;
    if (!body || body.success !== true || !Array.isArray(body.data) || body.data.length === 0) {
        const items = body && Array.isArray(body.data) ? body.data.length : 'n/a';
        throw new Error(`[importacionesusb] respuesta inválida del webservice (success=${body && body.success}, items=${items})`);
    }

    const byModel = new Map();
    for (const p of body.data) {
        const { model } = skuParts(p.sku);
        if (!model) {
            console.warn(`[importacionesusb] skip registro sin SKU: ${JSON.stringify(p).slice(0, 120)}`);
            continue;
        }
        if (!byModel.has(model)) byModel.set(model, []);
        byModel.get(model).push(p);
    }

    const out = [];
    for (const [model, group] of byModel) {
        const head = group[0];
        out.push({
            code: model.toLowerCase(),
            name: head.nombre,
            rawPrice: Number(head.precio),
            isNewExplicit: null,
            isDiscontinuedExplicit: null,
            isOnOfferExplicit: null,
            variants: group.map(v => ({
                sku: v.sku,
                key: v.sku,
                name: v.variante,
                rawPrice: Number(v.precio),
                available: Number(v.inventario) > 0,
                raw: v,
            })),
            raw: { head, group },
        });
    }
    return out;
}

function matchSecondary(segment) {
    return secondaryOptions.find(o => o.match.test(segment)) || null;
}

function getSecondaryOptionName(group) {
    for (const v of group) {
        const m = matchSecondary(skuParts(v.sku).segment);
        if (m) return m.option;
    }
    return null;
}

function getOptionValues(rawVariant, secondaryName) {
    const { segment, color: colorCode } = skuParts(rawVariant.sku);
    const parts = String(rawVariant.variante || '').split(' / ').map(s => s.trim());
    const color = parts[0] || colorCode;
    const values = [{ optionName: 'Color', name: color }];
    if (secondaryName) {
        const m = matchSecondary(segment);
        const secondary = parts.slice(1).join(' / ') || (m && m.label) || segment;
        values.push({ optionName: secondaryName, name: secondary });
    }
    return values;
}

function getPrintingTechs(raw) {
    const tokens = norm(raw).split(/\s*(?:-|,|\/|\by\b)\s*/).map(s => s.trim()).filter(Boolean);
    const normalized = [];
    const display = [];
    for (const t of tokens) {
        const tech = printingTechniques[t];
        if (!tech) continue;
        if (!normalized.includes(tech.normalized)) normalized.push(tech.normalized);
        if (!display.includes(tech.display)) display.push(tech.display);
    }
    return { normalized: normalized.join('-'), display: display.join(', ') };
}

function ruleMatches(rule, collections) {
    if (rule.all && !rule.all.every(c => collections.has(norm(c)))) return false;
    if (rule.any && !rule.any.some(c => collections.has(norm(c)))) return false;
    return true;
}

function getCategories(head) {
    const collections = new Set((head.colecciones || []).map(norm));
    const tags = [];

    const primary = primaryCategories.find(rule => ruleMatches(rule, collections));
    if (primary) {
        const value = norm(primary.field ? head[primary.field] : '');
        const matched = (primary.cases || []).find(([re]) => re.test(value));
        tags.push(matched ? matched[1] : primary.tags);
    }
    for (const rule of extraCategories) {
        if (ruleMatches(rule, collections)) tags.push(rule.tags);
    }

    return [...new Set(tags.join(',').split(',').map(s => s.trim()).filter(Boolean))].join(',');
}

function buildMetafieldsForUpdate(normalized, ctx, keys) {
    const head = normalized.raw.head;
    const techs = getPrintingTechs(head.tecnica);
    const logical = buildClassificationMetafields({
        material: printableSurface(head.material, head.descripcion, normalizedSurfaces),
        materialFront: head.material || '',
        tecnicas: techs.normalized,
        tecnicasFront: techs.display,
    });
    return mapShopMetafields(filterMetafieldKeys(logical, keys), ctx.shop);
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const head = normalized.raw.head;
    const model = skuParts(head.sku).model;
    const techs = getPrintingTechs(head.tecnica);
    const material = printableSurface(head.material, head.descripcion, normalizedSurfaces);
    const secondaryName = getSecondaryOptionName(normalized.raw.group);

    const metafields = [
        { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: material },
        { key: 'material_front', namespace: 'custom', type: 'single_line_text_field', value: String(head.material || '').trim() },
        { key: 'medidas', namespace: 'custom', type: 'single_line_text_field', value: String(head.medidas || '').trim() },
        { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: techs.normalized },
        { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field', value: techs.display },
        { key: 'detalles', namespace: 'custom', type: 'multi_line_text_field', value: String(head.descripcion || '').trim() },
    ].filter(m => m.value);

    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: `${String(head.nombre || '').trim()} ${model}`.trim().toUpperCase(),
        descriptionHtml: head.descripcion,
        vendor: vendor.name,
        tags: getCategories(head),
        metafields: mapShopMetafields(metafields, shop),
        productOptions: [
            { name: 'Color', values: [{ name: 'Default' }] },
            ...(secondaryName ? [{ name: secondaryName, values: [{ name: 'Default' }] }] : []),
        ],
    };
    return { input: addCantidadOption(applyDescriptionTemplate(base, shop), shop), meta: { secondaryName } };
}

function uniqueImageUrls(group) {
    return [...new Set(group.map(v => v.imagen).filter(Boolean))];
}

function buildMedia(group) {
    return uniqueImageUrls(group).map(url => {
        const firstUser = group.find(v => v.imagen === url);
        return { alt: getOptionValues(firstUser, null)[0].name, mediaContentType: 'IMAGE', originalSource: url };
    });
}

// La imagen del proveedor va por SKU y no siempre por color (en LIB023 cambia por tamaño),
// así que se liga cada variante a la posición de su propia imagen; si los nodos de media
// no corresponden 1:1 con las URLs, se cae al match por alt (color) o a la primera.
function resolveMediaId(rawVariant, color, productMediaNodes, imageUrls) {
    if (!productMediaNodes || productMediaNodes.length === 0) return null;
    const idx = imageUrls.indexOf(rawVariant.imagen);
    if (idx >= 0 && productMediaNodes.length === imageUrls.length) return productMediaNodes[idx].id;
    const matched = productMediaNodes.find(m => m.alt === color);
    return matched ? matched.id : productMediaNodes[0].id;
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx, secondaryName, imageUrls) {
    const { locationId, computeTargetPrice, computeTargetCost } = ctx;
    const rawPrice = Number(rawVariant.precio);
    const optionValues = getOptionValues(rawVariant, secondaryName);
    const mediaId = resolveMediaId(rawVariant, optionValues[0].name, productMediaNodes, imageUrls);

    return {
        inventoryItem: { sku: rawVariant.sku, tracked: true, cost: computeTargetCost(rawPrice) },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant.inventario) || 0, locationId }],
        optionValues,
        price: computeTargetPrice(rawPrice),
        taxable: false,
    };
}

function expandVariantsForUpload(normalized, ctx, productResponse) {
    const productMediaNodes = productResponse && productResponse.media && productResponse.media.nodes;
    const secondaryName = getSecondaryOptionName(normalized.raw.group);
    const imageUrls = uniqueImageUrls(normalized.raw.group);
    const out = [];
    for (const v of normalized.raw.group) {
        const base = buildBaseVariantPayload(v, productMediaNodes, ctx, secondaryName, imageUrls);
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
