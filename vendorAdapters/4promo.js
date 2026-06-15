const axios = require('axios');
const sharp = require('sharp');
const { categories, extraCategories, sizes } = require('./4promo.constants');
const { buildHandle } = require('../handleParser');
const {
    addCantidadOption,
    expandVariantForShopify,
    getShopifyVariantKey,
    mapShopMetafields,
    isEscalas,
} = require('./_shared');

async function fetchCatalog({ vendor }) {
    const response = await axios.get(vendor.endpoint);
    const rows = response.data;

    const byModel = new Map();
    for (const row of rows) {
        const code = row.id_articulo;
        if (!byModel.has(code)) byModel.set(code, []);
        byModel.get(code).push(row);
    }

    const products = [];
    for (const [code, group] of byModel) {
        const head = group[0];
        const isNewExplicit = head.producto_nuevo === 'SI';
        const isOnOfferExplicit = head.producto_promocion === 'SI';
        products.push({
            code: String(code).toLowerCase().replace(/[\s]+/g, '-'),
            name: head.nombre_articulo,
            rawPrice: Number(head.precio),
            isNewExplicit,
            isDiscontinuedExplicit: null,
            isOnOfferExplicit,
            variants: group.map(v => ({
                sku: `${v.id_articulo} ${v.color}`,
                key: v.color,
                name: v.color,
                rawPrice: Number(v.precio),
                available: Number(v.inventario) > 0,
                raw: v,
            })),
            raw: { head, group },
        });
    }
    return products;
}

function getCategoryTags(head) {
    let extra = '';
    extra += head.producto_promocion === 'SI' ? ',oferta' : '';
    if (['ARTÍCULOS DE MUNDIAL', 'HUICHOL', 'ECO BEBIDAS ♻️'].includes(head.sub_categoria)) {
        const firstWord = (head.descripcion || '').split(' ')[0];
        extra += extraCategories[`${firstWord} - ${head.categoria} - ${head.sub_categoria}`];
    }
    return (categories[`${head.categoria} - ${head.sub_categoria}`]) + extra;
}

function productHasSize(group) {
    return group.some(v => sizes.includes(v.color));
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const head = normalized.raw.head;
    const group = normalized.raw.group;
    const hasSize = productHasSize(group);
    const tags = getCategoryTags(head) + (normalized.isNewExplicit ? ',nuevo' : '');

    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: `${(head.descripcion || '').split(' ')[0]} ${head.nombre_articulo} ${head.id_articulo}`.toUpperCase(),
        descriptionHtml: head.descripcion,
        vendor: vendor.name,
        tags,
        metafields: mapShopMetafields([
            { key: 'medidas', namespace: 'custom', type: 'single_line_text_field',
              value: `${head.medida_producto_alto} x ${head.medida_producto_ancho} x ${head.profundidad_articulo} cm` },
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field',
              value: (head.metodos_impresion || '').split('-').join(', ') },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field',
              value: (head.metodos_impresion || '').split('-').join('/-/') },
            { key: 'capacidad', namespace: 'custom', type: 'single_line_text_field',
              value: head.capacidad || '' },
            { key: 'area_de_impresion', namespace: 'custom', type: 'single_line_text_field',
              value: head.area_impresion || '' },
            { key: 'peso', namespace: 'custom', type: 'single_line_text_field',
              value: `${(parseFloat(head.peso_caja) / head.piezas_caja).toFixed(2)} kg` },
            { key: 'peso_de_caja', namespace: 'custom', type: 'single_line_text_field',
              value: `${head.peso_caja} kg` },
            { key: 'medidas_de_caja', namespace: 'custom', type: 'single_line_text_field',
              value: `${head.alto_caja} x ${head.ancho_caja} x ${head.largo_caja} cm` },
            { key: 'piezas_por_caja', namespace: 'custom', type: 'single_line_text_field',
              value: String(head.piezas_caja) },
        ], shop),
        productOptions: [
            { name: 'Color', values: [{ name: 'Default' }] },
            ...(hasSize ? [{ name: 'Talla', values: [{ name: 'Default' }] }] : []),
        ],
    };

    return { input: addCantidadOption(base, shop), meta: { hasSize, group } };
}

async function buildAndUploadMedia(group, ctx) {
    const tempMedia = group.flatMap((v, i) => {
        if (i === 0) {
            return (v.imagenes || []).map(img => ({
                alt: img.tipo_imagen === 'imagen_color' ? v.color : '',
                mediaContentType: 'IMAGE',
                originalSource: img.url_imagen,
            }));
        }
        return v.imagenes && v.imagenes[2] && v.imagenes[2].url_imagen
            ? [{ alt: v.color, mediaContentType: 'IMAGE', originalSource: v.imagenes[2].url_imagen }]
            : [];
    });

    const media = [];
    for (const m of tempMedia) {
        try {
            const r = await axios.get(m.originalSource, { responseType: 'arraybuffer' });
            let buf = Buffer.from(r.data, 'binary');
            if (buf.length > 20 * 1024 * 1024) buf = await sharp(buf).jpeg({ quality: 80 }).toBuffer();
            const filename = `${group[0].id_articulo}-${m.alt || ''}.jpg`.replace(/[^a-zA-Z0-9._-]+/g, '-');
            const target = await ctx.shopifyFns.createStagedUpload([{ filename, httpMethod: 'POST', mimeType: 'image/jpeg', resource: 'IMAGE' }]);
            const resourceUrl = await ctx.shopifyFns.uploadFileToStagedTarget(target, buf, filename);
            media.push({ ...m, originalSource: resourceUrl });
        } catch (err) {
            console.warn(`[4promo] media skip: ${err.message}`);
        }
    }
    return media;
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx, hasSize) {
    const { locationId, computeTargetPrice } = ctx;
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === rawVariant.color);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    let optColor = rawVariant.color, optTalla;
    if (hasSize) {
        const split = String(rawVariant.color).split('-');
        if (split[1]) { optColor = split[0]; optTalla = split[1]; }
        else { optColor = 'UNICO'; optTalla = split[0]; }
    }

    return {
        inventoryItem: { sku: `${rawVariant.id_articulo} ${rawVariant.color}`, tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant.inventario) || 0, locationId }],
        optionValues: hasSize
            ? [{ name: optColor, optionName: 'Color' }, { name: optTalla, optionName: 'Talla' }]
            : [{ name: rawVariant.color, optionName: 'Color' }],
        price: computeTargetPrice(Number(rawVariant.precio)),
        taxable: false,
    };
}

function expandVariantsForUpload(normalized, ctx, productResponse) {
    const hasSize = productHasSize(normalized.raw.group);
    const productMediaNodes = productResponse && productResponse.media && productResponse.media.nodes;
    const out = [];
    for (const v of normalized.raw.group) {
        const base = buildBaseVariantPayload(v, productMediaNodes, ctx, hasSize);
        out.push(...expandVariantForShopify(base, ctx.shop));
    }
    return out;
}

async function uploadNewProduct(normalized, ctx) {
    const { input, meta } = buildProductInput(normalized, ctx);
    const media = await buildAndUploadMedia(meta.group, ctx);
    const productResponse = await ctx.shopifyFns.productCreate(input, media);
    if (!productResponse || !productResponse.id) throw new Error(`productCreate vacío para ${normalized.code}`);
    const expanded = expandVariantsForUpload(normalized, ctx, productResponse);
    await ctx.shopifyFns.productVariantsBulkCreate(productResponse.id, expanded.map(e => e.payload));
    await ctx.shopifyFns.publishProduct(productResponse.id, ctx.publications);
    return productResponse;
}

function buildVariantPayloadForExisting(expandedVariant) {
    return expandedVariant.payload;
}

module.exports = {
    fetchCatalog,
    buildProductInput,
    expandVariantsForUpload,
    uploadNewProduct,
    buildAllMedia: (n, ctx) => buildAndUploadMedia(n.raw.group, ctx),
    buildVariantPayloadForExisting,
    getShopifyVariantKey,
    productHasSize,
};
