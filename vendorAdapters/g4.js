const axios = require('axios');
const xml2js = require('xml2js');
const { skipAdventages, ecoAdventages, categories, extraCategories, normalizedSurfaces, normalizedPrintingTechniques } = require('./g4.constants');
const { buildHandle } = require('../handleParser');
const { addCantidadOption, expandVariantForShopify, getShopifyVariantKey, mapShopMetafields, buildClassificationMetafields, filterMetafieldKeys, joinComma } = require('./_shared');

function soapEnvelope(method, urn) {
    return `<?xml version="1.0" encoding="ISO-8859-1"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
 xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
 xmlns:SOAP-ENC="http://schemas.xmlsoap.org/soap/encoding/" xmlns:urn="${urn}"
 SOAP-ENV:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
 <SOAP-ENV:Body>
   <urn:${method}>
     <user xsi:type="xsd:string">${process.env.G4_USER}</user>
     <key xsi:type="xsd:string">${process.env.G4_KEY}</key>
   </urn:${method}>
 </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

async function callSoap(endpoint, method, urn) {
    const r = await axios.post(endpoint, soapEnvelope(method, urn), {
        headers: {
            'Content-Type': 'text/xml; charset=ISO-8859-1',
            'SOAPAction': `"${urn}#${method}"`,
        },
    });
    const parsed = await xml2js.parseStringPromise(r.data, { explicitArray: false });
    const respKey = `ns1:${method}Response`;
    const base64 = parsed['SOAP-ENV:Envelope']['SOAP-ENV:Body'][respKey].return._;
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const dec = await xml2js.parseStringPromise(decoded, { explicitArray: false, mergeAttrs: true });
    return dec.response;
}

async function fetchCatalog({ vendor }) {
    const productsResp = await callSoap(vendor.endpoint, 'getProduct', 'urn:getProductwsdl');
    const stockResp = await callSoap(vendor.endpoint, 'getProductStock', 'urn:getProductStockwsdl');
    const stockArr = Array.isArray(stockResp.producto) ? stockResp.producto : [stockResp.producto];
    const stockByCode = new Map();
    for (const s of stockArr) {
        if (s) stockByCode.set(s.codigo_producto, parseInt(s.existencias, 10) || 0);
    }

    const products = Array.isArray(productsResp.producto) ? productsResp.producto : [productsResp.producto];
    const byModel = new Map();
    for (const p of products) {
        if (!p) continue;
        const escalas = Array.isArray(p.precios && p.precios.escala)
            ? p.precios.escala
            : [p.precios && p.precios.escala];
        let isActive = true;
        for (const e of escalas) {
            if (!e || e.rango === '0') isActive = false;
        }
        if (!isActive) continue;
        const list = byModel.get(p.model) || [];
        list.push(p);
        byModel.set(p.model, list);
    }

    const out = [];
    for (const [model, group] of byModel) {
        const head = group[0];
        const isNew = head.novedad === '1';
        const isOnOffer = head.promocion === '1';
        out.push({
            code: String(model).toLowerCase(),
            name: head.nombre_producto,
            rawPrice: getRawPrice(head),
            isNewExplicit: isNew,
            isDiscontinuedExplicit: null,
            isOnOfferExplicit: isOnOffer,
            variants: group.map(v => ({
                sku: v.codigo_producto,
                key: v.nombre_color,
                name: v.nombre_color,
                rawPrice: getRawPrice(v),
                available: (stockByCode.get(v.codigo_producto) || 0) > 0,
                raw: { ...v, _stock: stockByCode.get(v.codigo_producto) || 0 },
            })),
            raw: { head, group },
        });
    }
    return out;
}

function getRawPrice(variant) {
    const escalas = Array.isArray(variant.precios && variant.precios.escala)
        ? variant.precios.escala
        : [variant.precios && variant.precios.escala];
    for (const e of escalas) {
        if (e && e.rango === '1') return parseFloat(e.precio);
    }
    return 0;
}

function getProductTitle(p) {
    const cat = (p.linea || '').toLowerCase();
    const t = `${p.nombre_producto} ${p.model}`.toUpperCase();
    if (['bolígrafos de plástico', 'bolígrafos de metal'].includes(cat)) {
        return /BOL[IÍ]GRAFO/.test(t) ? t : `BOLÍGRAFO ${t}`;
    }
    if (cat === 'electrónicos' && t.includes('LUMINA')) return `POWER BANK ${t}`;
    return t;
}

function getProductDescription(p) {
    let extra = '<br>';
    if (p.color_tinta && p.color_tinta !== 'N/A') extra += `Color de tinta: ${p.color_tinta}. `;
    for (let i = 1; i <= 4; i++) {
        if (!skipAdventages.includes(p[`titulo_ventaja_${i}`])) extra += `${p[`ventaja_${i}`] || ''} `;
    }
    return (p.descripcion || '') + extra;
}

function getCategories(p) {
    let extra = '';
    extra += p.novedad === '1' ? ',nuevo' : '';
    extra += p.promocion === '1' ? ',oferta' : '';
    const firstName = (p.nombre_producto || '').split(' ')[0].toLowerCase();
    const cat = (p.linea || '').toLowerCase();
    for (let i = 1; i <= 4; i++) {
        if (ecoAdventages.includes(p[`titulo_ventaja_${i}`])) {
            extra += cat === 'bolígrafos de plástico' ? ',ecologicos,boligrafos ecologicos' : ',ecologicos,libretas ecologicas';
        }
    }
    if (['bolígrafos de plástico', 'bolígrafos de metal'].includes(cat)) {
        extra += (p.descripcion || '').includes('multifuncional') ? ',boligrafos multifuncionales' : '';
    }
    if (cat === 'llaveros y herramientas') extra += firstName === 'llavero' ? ',llaveros' : ',herramientas de trabajo';
    if (cat === 'electrónicos') extra += firstName === 'lumina' ? ',power banks' : ',accesorios de tecnologia';
    if (cat === 'oficina') extra += firstName === 'carpeta' ? ',libretas y carpetas' : ',accesorios de oficina';
    if (cat === 'mochilas y viajes') {
        extra += ['bolso', 'bolsa', 'estuche', 'maletin', 'organizador', 'porta'].includes(firstName) ? ',tiempo libre,viaje' : ',textil';
        extra += firstName === 'mochila' ? ',mochilas y maletas' : (firstName === 'funda' ? ',portafolios y portalaptop' : '');
    }
    if (cat === 'bebidas y alimentos') {
        const fd = (p.descripcion || '').split(' ')[0];
        extra += extraCategories[`${fd} ${p.material}`] || '';
    }
    return (categories[cat] || '') + extra;
}

// Actualización puntual de metafields (ver reconcileMetafields). No corre en el
// ciclo normal del watcher.
function buildMetafieldsForUpdate(normalized, ctx, keys) {
    const head = normalized.raw.head;
    const logical = buildClassificationMetafields({
        material: normalizedSurfaces[head.material] || '',
        materialFront: head.material || '',
        tecnicas: normalizedPrintingTechniques[head.impresion] || '',
        tecnicasFront: joinComma(head.impresion || ''),
    });
    return mapShopMetafields(filterMetafieldKeys(logical, keys), ctx.shop);
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const head = normalized.raw.head;
    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: getProductTitle(head),
        descriptionHtml: getProductDescription(head),
        vendor: vendor.name,
        tags: getCategories(head),
        metafields: mapShopMetafields([
            { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: normalizedSurfaces[head.material] || '' },
            { key: 'material_front', namespace: 'custom', type: 'single_line_text_field', value: head.material || '' },
            { key: 'medidas', namespace: 'custom', type: 'single_line_text_field', value: head.medidas || '' },
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: normalizedPrintingTechniques[head.impresion] || '' },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field', value: joinComma(head.impresion || '') },
            { key: 'capacidad', namespace: 'custom', type: 'single_line_text_field', value: head.capacidad_litros || '' },
            { key: 'area_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: head.area_impresion || '' },
            { key: 'peso', namespace: 'custom', type: 'single_line_text_field', value: head.peso_producto || '' },
            { key: 'peso_de_caja', namespace: 'custom', type: 'single_line_text_field', value: head.peso_caja || '' },
            { key: 'medidas_de_caja', namespace: 'custom', type: 'single_line_text_field', value: head.alto_caja && head.ancho_caja && head.largo_caja ? `${head.alto_caja} x ${head.largo_caja} x ${head.ancho_caja} cm` : '', },
            { key: 'piezas_por_caja', namespace: 'custom', type: 'single_line_text_field', value: String(head.piezas_por_caja || '') },
        ], shop),
        productOptions: [
            { name: 'Color', values: [{ name: 'Default' }] },
        ],
    };
    return { input: addCantidadOption(base, shop), meta: {} };
}

function buildMedia(group) {
    const media = [];
    const isValidUrl = (u) => /\.(jpg|png)$/i.test(String(u || ''));
    group.forEach((variant, i) => {
        if (i === 0) {
            const ambUrl = variant.imagenes && variant.imagenes.ambientada && variant.imagenes.ambientada.url;
            if (isValidUrl(ambUrl)) media.push({ mediaContentType: 'IMAGE', originalSource: ambUrl });
            const adicionales = variant.imagenes && variant.imagenes.adicionales && variant.imagenes.adicionales.adicional;
            const adArr = Array.isArray(adicionales) ? adicionales : (adicionales ? [adicionales] : []);
            for (const ad of adArr) {
                if (isValidUrl(ad.url)) media.push({ mediaContentType: 'IMAGE', originalSource: ad.url });
            }
        }
        const principalUrl = variant.imagenes && variant.imagenes.principal && variant.imagenes.principal.url;
        if (isValidUrl(principalUrl)) media.push({ alt: variant.nombre_color, mediaContentType: 'IMAGE', originalSource: principalUrl });
    });
    media.push({ mediaContentType: 'IMAGE', originalSource: `https://g4mexico.com/imagen-producto/${group[0].model}_specification.jpg` });
    media.push({ mediaContentType: 'IMAGE', originalSource: `https://g4mexico.com/imagen-producto/${group[0].model}_specification.png` });
    return media;
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx, colorCount) {
    const { locationId, computeTargetPrice } = ctx;
    const baseColor = rawVariant.nombre_color;
    colorCount[baseColor] = (colorCount[baseColor] || 0) + 1;
    const colorName = colorCount[baseColor] === 1 ? baseColor : `${baseColor} ${colorCount[baseColor]}`;
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === baseColor);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    return {
        inventoryItem: { sku: rawVariant.codigo_producto, tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: Number(rawVariant._stock) || 0, locationId }],
        optionValues: [{ name: String(colorName).toUpperCase(), optionName: 'Color' }],
        price: computeTargetPrice(getRawPrice(rawVariant)),
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
