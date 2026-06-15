const axios = require('axios');
const { categoriesV2 } = require('./innova.constants');
const { buildHandle } = require('../handleParser');
const {
    addCantidadOption,
    expandVariantForShopify,
    getShopifyVariantKey,
    buildMediaFromUrls,
    mapShopMetafields,
} = require('./_shared');

async function fetchPage(vendor, page) {
    const r = await axios.get(vendor.endpoint, {
        params: {
            User: process.env.INNOVA_USER,
            Clave: process.env.INNOVA_PASS,
            page,
            limit: 100,
        },
        headers: { 'auth-token': process.env.INNOVA_AUTH_TOKEN },
    });
    return r.data;
}

async function fetchCatalog({ vendor }) {
    const first = await fetchPage(vendor, 1);
    let products = first.productos || [];
    const pages = first.paginas_totales || 1;
    let p = 2;
    while (p <= pages) {
        const r = await fetchPage(vendor, p);
        products = products.concat(r.productos || []);
        p++;
    }

    return products.map(prod => ({
        code: String(prod.Codigo).toLowerCase(),
        name: prod.Nombre,
        rawPrice: Number(prod.Precio),
        isNewExplicit: null,
        isDiscontinuedExplicit: null,
        isOnOfferExplicit: [...(prod.Categoria || []), ...(prod.SubCategorias || [])].includes('Outlet'),
        variants: (prod.Variantes || []).filter(variant => variant.Tono !== '').map(v => ({
            sku: v['Codigo Variante'],
            key: v.Tono,
            name: v.Tono,
            rawPrice: Number(prod.Precio),
            available: Number(v.Stock) > 0,
            raw: v,
        })),
        raw: prod,
    }));
}

function normalize(text) {
    return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function getCategories(prod) {
    let tags = '';
    const cats = [...(prod.Categoria || []), ...(prod.SubCategorias || [])];
    tags += cats.includes('Outlet') ? ',oferta' : '';
    tags += cats.includes('Mundial 2026') ? ',mundial' : '';
    const filtered = (categoriesV2 || []).filter(c => cats.includes(c));
    const firstName = normalize((prod.Nombre || '').split(' ')[0]);
    const firstCode = normalize((prod.Codigo || '').split('-')[0]);
    const material = normalize((prod.Materiales && prod.Materiales[0]) || '');
    if (cats.some(c => ['Ecológica', 'Ecológicas'].includes(c))) {
        tags += ['bl', 'st'].includes(firstCode) ? ',ecologicos,boligrafos ecologicos,oficina'
            : firstCode === 'lb' ? ',ecologicos,libretas ecologicas'
            : firstCode === 'te' ? ',ecologicos,bebidas ecologicas'
            : ['dk', 'ex'].includes(firstCode) ? ',ecologicos,oficina ecologica'
            : ['be', 'hm'].includes(firstCode) ? ',ecologicos,hogar ecologico' : '';
    }
    for (const fc of filtered) {
        const map = {
            'Paraguas': ',textil,paraguas e impermeables',
            'Herramientas': ',tiempo libre,herramientas de trabajo',
            'Antiestrés': ',tiempo libre,antiestres',
            'Mascotas': ',hogar,accesorios del hogar',
            'Vasos': ',bebidas,vasos',
            'Tazas': ',bebidas,tazas',
            'Termos': ',bebidas,termos',
            'Libretas': ',oficina,libretas y carpetas',
            'Bocinas': ',tecnologia,audifonos y bocinas',
            'Power Bank': ',tecnologia,power banks',
            'Audífonos': ',tecnologia,audifonos y bocinas',
            'Cargadores y power bank': ',tecnologia,accesorios de tecnologia',
            'Relojes': ',oficina,accesorios de oficina',
            'Cosmetiqueras': ',hogar,belleza',
            'Neceser': ',tiempo libre,viaje',
            'Porta Laptop': ',textil,portafolios y portalaptop',
            'Hieleras y Loncheras': ',textil,hieleras y loncheras',
            'Decoración': ',hogar,accesorios del hogar',
            'Marca Textos': ',hogar,ninos',
            'Cuidado Personal': ',hogar,salud y bienestar',
            'Belleza': ',hogar,belleza',
            'Llaveros': ',tiempo libre,llaveros',
            'Tecnología': ',tecnologia,accesorios de tecnologia',
            'Sets': ',oficina,boligrafos multifuncionales',
            'Oficina': ',oficina,accesorios de oficina',
            'Hogar': ',hogar,accesorios del hogar',
            'Escolares y Niños': ',hogar,ninos',
        };
        if (map[fc]) { tags += map[fc]; break; }
        if (fc === 'Cilindros') {
            tags += ['acero inoxidable', 'vidrio', 'aluminio'].includes(material) ? ',bebidas,cilindros de metal y vidrio' : ',bebidas,cilindros de plastico';
            break;
        }
        if (fc === 'Bebidas') {
            tags += firstName === 'termo' ? ',bebidas,termos'
                : firstName === 'vaso' ? ',bebidas,vasos'
                : firstName === 'juego' ? ',bebidas,tazas'
                : firstName === 'bolsa' ? ',tiempo libre,viaje' : '';
            break;
        }
        if (['Crossbody', 'Cangureras'].includes(fc)) { tags += ',textil,gorras y cangureras'; break; }
        if (['Bolsas', 'Bolsas Deportivas', 'Morrales'].includes(fc)) { tags += ',textil,bolsas y morrales'; break; }
        if (['Mochilas y Maletas', 'Maletas de Mano', 'Maletas rigidas', 'Maletas de Ruedas'].includes(fc)) { tags += ',textil,mochilas y maletas'; break; }
        if (['Bar', 'Cocina', 'Contenedores de alimentos', 'Jarras y Prensas Francesas', 'Tablas de Queso', 'Alimentos', 'Tablas', 'Cubiertos'].includes(fc)) { tags += ',hogar,cocina'; break; }
        if (fc === 'Bolígrafos') {
            tags += ['metal', 'aluminio', 'acero inoxidable'].includes(material) ? ',oficina,boligrafos de metal'
                : ['fibra de trigo', 'bambu', 'carton'].includes(material) ? ',ecologicos,boligrafos ecologicos,oficina'
                : ',oficina,boligrafos de plastico';
            break;
        }
        if (fc === 'Escritura') {
            tags += material === 'aluminio' ? ',oficina,boligrafos de metal'
                : material === 'corcho' ? ',ecologicos,boligrafos ecologicos,oficina' : '';
            break;
        }
        if (fc === 'Ejecutiva') { tags += firstName === 'carpeta' ? ',oficina,libretas y carpetas' : ',oficina,accesorios de oficina'; break; }
        if (fc === 'Fitness') { tags += firstName === 'cangureras' ? ',textil,gorras y cangureras' : ',tiempo libre,entretenimiento'; break; }
        if (['Viaje', 'Accesorios de Viaje'].includes(fc)) { tags += ',tiempo libre,viaje'; break; }
        tags += ',undefined';
    }
    return tags;
}

function buildProductInput(normalized, ctx) {
    const { shop, vendor } = ctx;
    const prod = normalized.raw;
    const tags = getCategories(prod);

    const base = {
        handle: buildHandle(shop, vendor, normalized.code, normalized.name),
        title: `${(prod.Nombre || '').trim().replace(/\.*$/, '')} ${prod.Codigo}`.toUpperCase(),
        descriptionHtml: prod.Descripcion,
        vendor: vendor.name,
        tags,
        metafields: mapShopMetafields([
            { key: 'material', namespace: 'custom', type: 'single_line_text_field', value: (prod.Materiales || []).join(', ') },
            { key: 'medidas', namespace: 'custom', type: 'single_line_text_field', value: prod['Medidas producto'] || '' },
            { key: 'tecnicas_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: (prod.TecnicasImpresion || []).join(', ') },
            { key: 'tecnicas_de_impresion_front', namespace: 'custom', type: 'single_line_text_field', value: (prod.TecnicasImpresion || []).join('/-/') },
            { key: 'area_de_impresion', namespace: 'custom', type: 'single_line_text_field', value: prod.AreaDeImpresion || '' },
            { key: 'peso', namespace: 'custom', type: 'single_line_text_field', value: prod.PesoProducto || '' },
            { key: 'peso_de_caja', namespace: 'custom', type: 'single_line_text_field', value: prod.EmpaqueMaster[0].Peso || '' },
            { key: 'medidas_de_caja', namespace: 'custom', type: 'single_line_text_field', value: prod['Medidas empaque'] || '' },
            { key: 'piezas_por_caja', namespace: 'custom', type: 'single_line_text_field', value: String(prod['Cantidad empaque'] || '') },
        ], shop),
        productOptions: [
            { name: 'Color', values: [{ name: 'Default' }] },
        ],
    };
    return { input: addCantidadOption(base, shop), meta: {} };
}

async function buildAndUploadMedia(prod, ctx) {
    const variantImgs = (prod.Variantes || []).filter(variant => variant.Tono !== '').filter(v => v.Imagen && v.Imagen !== 'https:').map(v => ({ url: v.Imagen, alt: v.Tono }));
    const principal = prod.ImagenP ? [{ url: prod.ImagenP, alt: '' }] : [];
    const additional = (prod.ImagenesC || []).map(u => ({ url: u, alt: '' }));
    return await buildMediaFromUrls([...variantImgs, ...principal, ...additional], ctx, { stage: false });
}

function buildBaseVariantPayload(rawVariant, productMediaNodes, ctx, prod) {
    const { locationId, computeTargetPrice } = ctx;
    const matched = productMediaNodes && productMediaNodes.find(m => m.alt === rawVariant.Tono);
    const mediaId = matched ? matched.id : (productMediaNodes && productMediaNodes[0] && productMediaNodes[0].id);

    return {
        inventoryItem: { sku: rawVariant['Codigo Variante'], tracked: true },
        ...(mediaId ? { mediaId } : {}),
        inventoryQuantities: [{ availableQuantity: parseInt(rawVariant.Stock) || 0, locationId }],
        optionValues: [{ name: rawVariant.Tono, optionName: 'Color' }],
        price: computeTargetPrice(Number(prod.Precio)),
        taxable: false,
    };
}

function expandVariantsForUpload(normalized, ctx, productResponse) {
    const productMediaNodes = productResponse && productResponse.media && productResponse.media.nodes;
    const out = [];
    for (const v of (normalized.raw.Variantes || []).filter(variant => variant.Tono !== '')) {
        const base = buildBaseVariantPayload(v, productMediaNodes, ctx, normalized.raw);
        out.push(...expandVariantForShopify(base, ctx.shop));
    }
    return out;
}

async function uploadNewProduct(normalized, ctx) {
    const { input } = buildProductInput(normalized, ctx);
    const media = await buildAndUploadMedia(normalized.raw, ctx);
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
    buildAllMedia: (n, ctx) => buildAndUploadMedia(n.raw, ctx),
    buildVariantPayloadForExisting: (e) => e.payload,
    getShopifyVariantKey,
};
