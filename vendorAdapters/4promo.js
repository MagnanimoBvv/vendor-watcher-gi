const axios = require('axios');
const { categories, extraCategories, sizes, printingTechniques, surfaces } = require('./4promo.constants');
const { buildHandle } = require('../handleParser');
const { printableSurface } = require('./surfaces');
const {
    addCantidadOption,
    expandVariantForShopify,
    getShopifyVariantKey,
    mapShopMetafields,
    isEscalas,
    buildClassificationMetafields,
    filterMetafieldKeys,
    joinComma,
} = require('./_shared');

async function fetchCatalog({ vendor }) {
    const response = await axios.get(vendor.endpoint, { headers: { 'Authorization': `Bearer ${process.env.FP_AUTH_TOKEN}` } });
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
            name: head.nombre_artd,
            rawPrice: Number(head.precio_desc),
            isNewExplicit,
            isDiscontinuedExplicit: null,
            isOnOfferExplicit,
            variants: group.map(v => ({
                sku: `${v.id_articulo} ${v.modelo}`,
                key: v.modelo,
                name: v.modelo,
                rawPrice: Number(v.precio_desc),
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
    return group.some(v => sizes.includes(v.modelo));
}

function buildMetafieldsForUpdate(normalized, ctx, keys) {
    const head = normalized.raw.head;
    const logical = buildClassificationMetafields({
        material: printableSurface(head.composicion, head.descripcion, surfaces),
        materialFront: head.composicion || '',
        tecnicas: [...new Set((head.metodos_impresion.split('-') || []).map(t => printingTechniques[t] || '').filter(Boolean))].join('-'),
        tecnicasFront: joinComma(head.metodos_impresion || '', '-'),
    });
    return mapShopMetafields(filterMetafieldKeys(logical, keys), ctx.shop);
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const head = normalized.raw.head;
    const group = normalized.raw.group;
    const hasSize = productHasSize(group);
    const tags = getCategoryTags(head) + (normalized.isNewExplicit ? ',nuevo' : '');

    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: `${(head.descripcion || '').split(' ')[0]} ${head.nombre_artd} ${head.id_articulo}`.toUpperCase(),
        descriptionHtml: head.descripcion,
        vendor: vendor.name,
        tags,
        metafields: mapShopMetafields([
            { key: 'material', namespace: 'custom', type: 'single_line_text_field',
              value: printableSurface(head.composicion, head.descripcion, surfaces) },
            { key: 'material_front', namespace: 'custom', type: 'single_line_text_field',
              value: head.composicion || '' },
            { key: 'medidas', namespace: 'custom', type: 'single_line_text_field',
              value: `${Number(head.medida_producto_alto)} x ${Number(head.medida_producto_ancho)} x ${Number(head.profundidad_articulo)} cm` },
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field',
              value: [...new Set((head.metodos_impresion.split('-') || []).map(t => printingTechniques[t] || '').filter(Boolean))].join('-') },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field',
              value: joinComma(head.metodos_impresion || '', '-') },
            { key: 'capacidad', namespace: 'custom', type: 'single_line_text_field',
              value: head.capacidad || '' },
            { key: 'area_de_impresion', namespace: 'custom', type: 'single_line_text_field',
              value: head.area_impresion || '' },
            { key: 'peso', namespace: 'custom', type: 'single_line_text_field',
              value: `${(parseFloat(head.caja_peso) / head.piezas).toFixed(2)} kg` },
            { key: 'peso_de_caja', namespace: 'custom', type: 'single_line_text_field',
              value: `${head.caja_peso} kg` },
            { key: 'medidas_de_caja', namespace: 'custom', type: 'single_line_text_field',
              value: `${Number(head.alto_caja)} x ${Number(head.ancho_caja)} x ${Number(head.largo_caja)} cm` },
            { key: 'piezas_por_caja', namespace: 'custom', type: 'single_line_text_field',
              value: String(head.piezas) },
        ], shop),
        productOptions: [
            { name: 'Color', values: [{ name: 'Default' }] },
            ...(hasSize ? [{ name: 'Talla', values: [{ name: 'Default' }] }] : []),
        ],
    };

    return { input: addCantidadOption(base, shop), meta: { hasSize, group } };
}

function buildMedia(group) {
    return group.flatMap((v, i) => {
        const imgs = (v.images || []).filter(img => img.tipo_imagen !== 'imagen_vta');
        if (i === 0) {
            return imgs.map(img => ({
                alt: img.tipo_imagen === 'imagen_color' ? v.modelo : '',
                mediaContentType: 'IMAGE',
                originalSource: encodeURI(img.url_imagen),
            }));
        }
        const colorImg = imgs.find(img => img.tipo_imagen === 'imagen_color');
        return colorImg
            ? [{ alt: v.modelo, mediaContentType: 'IMAGE', originalSource: encodeURI(colorImg.url_imagen) }]
            : [];
    });
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx, hasSize) {
    const { locationId, computeTargetPrice } = ctx;
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === rawVariant.modelo);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    let optColor = rawVariant.modelo, optTalla;
    if (hasSize) {
        const split = String(rawVariant.modelo).split('-');
        if (split[1]) { optColor = split[0]; optTalla = split[1]; }
        else { optColor = 'UNICO'; optTalla = split[0]; }
    }

    return {
        inventoryItem: { sku: `${rawVariant.id_articulo} ${rawVariant.modelo}`, tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant.inventario) || 0, locationId }],
        optionValues: hasSize
            ? [{ name: optColor, optionName: 'Color' }, { name: optTalla, optionName: 'Talla' }]
            : [{ name: rawVariant.modelo, optionName: 'Color' }],
        price: computeTargetPrice(Number(rawVariant.precio_desc)),
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
    const media = buildMedia(meta.group);
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
    buildMetafieldsForUpdate,
    expandVariantsForUpload,
    uploadNewProduct,
    buildAllMedia: (n) => buildMedia(n.raw.group),
    buildVariantPayloadForExisting,
    getShopifyVariantKey,
    productHasSize,
};
