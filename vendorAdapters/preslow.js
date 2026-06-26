const axios = require('axios');
const { buildHandle } = require('../handleParser');
const { addCantidadOption, expandVariantForShopify, getShopifyVariantKey, mapShopMetafields, buildClassificationMetafields, filterMetafieldKeys, joinComma } = require('./_shared');
const { surfaces, categoryMap, colorMap, printingTechniques, normalizedPrintingTechniques, SIZE_GUIDE_URL, } = require('./preslow.constants');

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
            code: String(modelo).toLowerCase(),
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

function getNormalizedPrintingTechs(arr) {
    return [...new Set((arr || []).map(t => normalizedPrintingTechniques[t] || ''))].filter(Boolean).join('-');
}

function technicalSheetUrl(modelo) {
    return `https://api.preslow.app/public/ecommerce/${modelo}.pdf`;
}

// Actualización puntual de metafields (ver reconcileMetafields). No corre en el
// ciclo normal del watcher. Preslow expone material y técnicas hardcodeadas.
function buildMetafieldsForUpdate(normalized, ctx, keys) {
    const head = normalized.raw.head;
    const logical = buildClassificationMetafields({
        material: surfaces[head.tela] || '',
        materialFront: head.tela || '',
        tecnicas: getNormalizedPrintingTechs(printingTechniques),
        tecnicasFront: joinComma(printingTechniques),
    });
    return mapShopMetafields(filterMetafieldKeys(logical, keys), ctx.shop);
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
        tags: `${categoryMap[head.linea] || ''}`,
        metafields: mapShopMetafields([
            { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: surfaces[head.tela] || '' },
            { key: 'material_front', namespace: 'custom', type: 'single_line_text_field', value: head.tela || '' },
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: getNormalizedPrintingTechs(printingTechniques) },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field', value: joinComma(printingTechniques) },
        ], shop),
        productOptions: [
            { name: 'Color', values: [{ name: 'Default' }] },
            { name: 'Talla', values: [{ name: 'Default' }] },
        ],
    };
    return { input: addCantidadOption(base, shop), meta: {} };
}

async function uploadTechnicalSpecs(modelo, ctx) {
    const { fromBuffer } = require('pdf2pic');
    const r = await axios.get(technicalSheetUrl(modelo), { responseType: 'arraybuffer' });
    const pdfBuffer = Buffer.from(r.data);
    const convert = fromBuffer(pdfBuffer, { density: 200, format: 'jpg', width: 1600, height: 1600, preserveAspectRatio: true });
    const pages = await convert.bulk(-1, { responseType: 'buffer' });

    const urls = [];
    for (const page of pages) {
        if (!page || !page.buffer) continue;
        const filename = `preslow_ficha_${modelo}_${page.page}.jpg`;
        const target = await ctx.shopifyFns.createStagedUpload([{
            filename, httpMethod: 'POST', mimeType: 'image/jpeg', resource: 'IMAGE',
        }]);
        const uploaded = await ctx.shopifyFns.uploadFileToStagedTarget(target, page.buffer, filename);
        if (uploaded) urls.push(uploaded);
    }
    return urls;
}

async function buildMedia(group, ctx) {
    const head = group[0];
    const seenImages = new Set();
    const seenColors = new Set();

    // Imágenes de producto, deduplicadas por URL y conservando el orden por color.
    // Guardamos el código de color para poder insertar los extras tras el 1er color.
    const colorImages = group
        .flatMap(p => (p.imagenes || []).map(src => ({ src, color: p.color })))
        .filter(img => {
            if (seenImages.has(img.src)) return false;
            seenImages.add(img.src);
            return true;
        })
        .map(img => {
            const colorName = colorMap[img.color] || img.color;
            const node = { mediaContentType: 'IMAGE', originalSource: img.src };
            if (!seenColors.has(colorName)) {
                seenColors.add(colorName);
                node.alt = colorName; // portada por color (para asociar la variante)
            }
            return { node, color: img.color };
        });

    const extras = [{ mediaContentType: 'IMAGE', originalSource: SIZE_GUIDE_URL }];
    try {
        const fichaUrls = await uploadTechnicalSpecs(head.modelo, ctx);
        for (const u of fichaUrls) extras.push({ mediaContentType: 'IMAGE', originalSource: u });
    } catch (err) {
        console.warn(`[preslow] ficha técnica skip ${head.modelo}: ${err.message}`);
    }

    const firstColor = colorImages.length ? colorImages[0].color : null;
    let firstBlockEnd = 0;
    while (firstBlockEnd < colorImages.length && colorImages[firstBlockEnd].color === firstColor) firstBlockEnd++;

    const nodes = colorImages.map(ci => ci.node);
    return [...nodes.slice(0, firstBlockEnd), ...extras, ...nodes.slice(firstBlockEnd)];
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
