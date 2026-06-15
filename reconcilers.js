const {
    todayUTC,
    getMetafield,
    getWindowDate,
    TAG_TO_METAFIELD,
    buildWindowMetafieldInput,
    freshUntilDate,
    WINDOW_DAYS,
} = require('./tagWindows');

// Un vendor tiene "campo explícito" para una tag si declara el field correspondiente
// en sus reglas: "nuevo" -> newProducts.field, "oferta" -> offers.field. Cuando lo
// tiene, la tag NO se retira automáticamente al vencer la ventana: se monitorea el
// campo del webservice para quitar/dejar la tag.
function tagHasExplicitField(tagName, ctx) {
    const rules = (ctx.vendor && ctx.vendor.rules) || {};
    if (tagName === 'nuevo') return !!(rules.newProducts && rules.newProducts.field);
    if (tagName === 'oferta') return !!(rules.offers && rules.offers.field);
    return false;
}
const { priceDiffers } = require('./pricing');
const { getShopifyVariantKey: defaultShopifyKey } = require('./vendorAdapters/_shared');

function shopifyKeyFor(adapter, sv, shop) {
    if (typeof adapter.getShopifyVariantKey === 'function') {
        return adapter.getShopifyVariantKey(sv, shop);
    }
    return defaultShopifyKey(sv, shop);
}

function indexShopifyVariantsByKey(variants, adapter, shop) {
    const map = new Map();
    for (const sv of variants) {
        const k = shopifyKeyFor(adapter, sv, shop);
        if (k) map.set(k, sv);
    }
    return map;
}

async function expireTagWindows(shopifyProducts, ctx) {
    const today = todayUTC();

    for (const product of shopifyProducts) {
        try {
            const tagsToRemove = [];
            const metafieldIdsToDelete = [];
            for (const tagName of Object.keys(TAG_TO_METAFIELD)) {
                const mfKey = TAG_TO_METAFIELD[tagName];
                const mf = getMetafield(product, mfKey);
                if (!mf || !mf.value) continue;
                const date = new Date(mf.value);
                if (isNaN(date.getTime())) continue;
                if (date.getTime() >= today.getTime()) continue; // ventana vigente

                // Ventana vencida: siempre se borra el metafield de vencimiento.
                metafieldIdsToDelete.push(mf.id);
                // Para una tag con campo explícito del vendor ("nuevo"/Caso 1 u
                // "oferta"/Caso A), NO se quita la tag aquí: el reconciliador
                // correspondiente decidirá según el campo del webservice. En cualquier
                // otro caso (sin campo, o "nuevo color") sí se retira al vencer.
                if (tagHasExplicitField(tagName, ctx)) continue;
                tagsToRemove.push(tagName);
            }
            if (metafieldIdsToDelete.length === 0) continue;

            if (tagsToRemove.length > 0) {
                const newTags = product.tags.filter(t => !tagsToRemove.includes(t));
                await ctx.shopifyFns.setProductTags(product.id, newTags);
                product.tags = newTags;
                ctx.entry.counters.tagsRetirados += tagsToRemove.length;
            }
            for (const id of metafieldIdsToDelete) {
                await ctx.shopifyFns.deleteMetafield(id);
            }
            product.metafields.nodes = product.metafields.nodes.filter(m => !metafieldIdsToDelete.includes(m.id));
            ctx.entry.counters.ventanasExpiradas += metafieldIdsToDelete.length;
        } catch (err) {
            ctx.report.logError(ctx.entry, `expireTagWindows ${product.handle}`, err);
        }
    }
}

async function reconcileNewProducts(vendorProducts, shopifyByCode, ctx) {
    const adapter = ctx.adapter;
    const hasNewField = tagHasExplicitField('nuevo', ctx);
    const today = todayUTC();

    for (const v of vendorProducts) {
        try {
            const shopifyProduct = shopifyByCode.get(v.code);

            // --- Producto NUEVO (no existe en Shopify): subir siempre con tag "nuevo"
            //     + ventana de vencimiento, sin importar el vendor (estrategia diff). ---
            if (!shopifyProduct) {
                if (typeof adapter.uploadNewProduct !== 'function') {
                    ctx.report.logError(ctx.entry, `newProducts ${v.code}`, new Error(`Adapter no implementa uploadNewProduct`));
                    continue;
                }
                const created = await adapter.uploadNewProduct(v, ctx);
                ctx.entry.counters.nuevos++;
                if (created && created.id) {
                    await ctx.shopifyFns.tagsAdd(created.id, ['nuevo']);
                    await ctx.shopifyFns.setMetafields([
                        buildWindowMetafieldInput(created.id, 'nuevo', freshUntilDate(WINDOW_DAYS))
                    ]);
                }
                continue;
            }

            // --- Producto EXISTENTE ---
            // Mientras la ventana de "nuevo" siga vigente, NO se modifica la tag.
            const windowDate = getWindowDate(shopifyProduct, 'nuevo');
            const windowActive = windowDate && windowDate.getTime() >= today.getTime();
            if (windowActive) continue;

            // Ventana expirada/ausente:
            //  - Caso 2 (sin campo): expireTagWindows ya retiró la tag; nada que hacer.
            if (!hasNewField) continue;

            //  - Caso 1 (con campo): monitorear el campo del webservice para quitar o
            //    dejar la tag "nuevo".
            const hasTag = shopifyProduct.tags.includes('nuevo');
            if (v.isNewExplicit === false && hasTag) {
                await ctx.shopifyFns.tagsRemove(shopifyProduct.id, ['nuevo']);
                shopifyProduct.tags = shopifyProduct.tags.filter(t => t !== 'nuevo');
                ctx.entry.counters.tagsRetirados++;
            } else if (v.isNewExplicit === true && !hasTag) {
                await ctx.shopifyFns.tagsAdd(shopifyProduct.id, ['nuevo']);
                shopifyProduct.tags = [...shopifyProduct.tags, 'nuevo'];
                ctx.entry.counters.tagsAgregados++;
            }
            // v.isNewExplicit === null (campo ausente en este producto): no se toca (conservador).
        } catch (err) {
            ctx.report.logError(ctx.entry, `newProducts ${v.code}`, err);
        }
    }
}

async function reconcileDiscontinued(vendorProducts, shopifyByCode, ctx) {
    const rule = ctx.vendor.rules.discontinued;
    const vendorByCode = new Map(vendorProducts.map(v => [v.code, v]));

    for (const [code, shopifyProduct] of shopifyByCode) {
        try {
            const v = vendorByCode.get(code);

            if (!v) {
                if (rule.strategy === 'diff' && shopifyProduct.status !== 'DRAFT') {
                    await ctx.shopifyFns.setProductStatus(shopifyProduct.id, 'DRAFT');
                    shopifyProduct.status = 'DRAFT';
                    ctx.entry.counters.descontinuados++;
                }
                continue;
            }

            if (rule.strategy === 'field') {
                const isDisc = v.isDiscontinuedExplicit === true;
                if (isDisc && shopifyProduct.status !== 'DRAFT') {
                    await ctx.shopifyFns.setProductStatus(shopifyProduct.id, 'DRAFT');
                    shopifyProduct.status = 'DRAFT';
                    ctx.entry.counters.descontinuados++;
                } else if (!isDisc && shopifyProduct.status === 'DRAFT') {
                    await ctx.shopifyFns.setProductStatus(shopifyProduct.id, 'ACTIVE');
                    shopifyProduct.status = 'ACTIVE';
                    ctx.entry.counters.reactivados++;
                }
            } else if (shopifyProduct.status === 'DRAFT') {
                await ctx.shopifyFns.setProductStatus(shopifyProduct.id, 'ACTIVE');
                shopifyProduct.status = 'ACTIVE';
                ctx.entry.counters.reactivados++;
            }
        } catch (err) {
            ctx.report.logError(ctx.entry, `discontinued ${code}`, err);
        }
    }
}

async function reconcilePricing(vendorProducts, shopifyByCode, ctx) {
    const adapter = ctx.adapter;
    const shop = ctx.shop;
    const hasOfferField = tagHasExplicitField('oferta', ctx);
    const today = todayUTC();

    for (const v of vendorProducts) {
        const shopifyProduct = shopifyByCode.get(v.code);
        if (!shopifyProduct) continue;

        try {
            if (typeof adapter.expandVariantsForUpload !== 'function') {
                throw new Error(`Adapter no implementa expandVariantsForUpload`);
            }
            const expanded = adapter.expandVariantsForUpload(v, ctx, shopifyProduct);
            const svByKey = indexShopifyVariantsByKey(shopifyProduct.variants.nodes, adapter, shop);

            const updates = [];
            let priceWentDown = false;

            for (const e of expanded) {
                const sv = svByKey.get(e.key);
                if (!sv) continue;
                const target = Number(e.payload.price);
                const current = Number(sv.price);
                if (priceDiffers(target, current)) {
                    updates.push({ id: sv.id, price: target.toFixed(2) });
                    if (target < current) priceWentDown = true;
                }
            }

            if (updates.length > 0) {
                await ctx.shopifyFns.productVariantsBulkUpdate(shopifyProduct.id, updates);
                ctx.entry.counters.preciosCambiados += updates.length;
            }

            if (priceWentDown) {
                // Bajada de precio: crea/RENUEVA la ventana y asegura la tag "oferta".
                // Mientras la ventana siga vigente no se hará otra modificación a la tag.
                await ctx.shopifyFns.setMetafields([
                    buildWindowMetafieldInput(shopifyProduct.id, 'oferta', freshUntilDate(WINDOW_DAYS))
                ]);
                if (!shopifyProduct.tags.includes('oferta')) {
                    await ctx.shopifyFns.tagsAdd(shopifyProduct.id, ['oferta']);
                    shopifyProduct.tags = [...shopifyProduct.tags, 'oferta'];
                    ctx.entry.counters.tagsAgregados++;
                }
            } else if (hasOfferField) {
                // Sin bajada este run y vendor CON campo de oferta (Caso A): si la ventana
                // NO está vigente, monitorear el campo del webservice para quitar/dejar la tag.
                const windowDate = getWindowDate(shopifyProduct, 'oferta');
                const windowActive = windowDate && windowDate.getTime() >= today.getTime();
                if (!windowActive) {
                    const hasTag = shopifyProduct.tags.includes('oferta');
                    if (v.isOnOfferExplicit === false && hasTag) {
                        await ctx.shopifyFns.tagsRemove(shopifyProduct.id, ['oferta']);
                        shopifyProduct.tags = shopifyProduct.tags.filter(t => t !== 'oferta');
                        ctx.entry.counters.tagsRetirados++;
                    } else if (v.isOnOfferExplicit === true && !hasTag) {
                        await ctx.shopifyFns.tagsAdd(shopifyProduct.id, ['oferta']);
                        shopifyProduct.tags = [...shopifyProduct.tags, 'oferta'];
                        ctx.entry.counters.tagsAgregados++;
                    }
                    // isOnOfferExplicit === null (campo ausente en este producto): no se toca.
                }
            }
        } catch (err) {
            ctx.report.logError(ctx.entry, `pricing ${v.code}`, err);
        }
    }
}

// Refresca TODA la media del producto "como si fuera la primera vez", respetando
// el orden del vendor: crea la media nueva, borra la anterior y devuelve los nodos
// frescos {id, alt}. Crea-antes-de-borrar para nunca dejar el producto sin imágenes
// si algo falla a medio camino. (Borrar imágenes está permitido; nunca se borran
// productos ni variantes.)
async function refreshProductMedia(shopifyProduct, vendorProduct, ctx) {
    const adapter = ctx.adapter;
    if (typeof adapter.buildAllMedia !== 'function') return null;

    const media = await adapter.buildAllMedia(vendorProduct, ctx);
    if (!Array.isArray(media) || media.length === 0) return null;

    const oldMedia = await ctx.shopifyFns.getProductMedia(shopifyProduct.id);
    const created = await ctx.shopifyFns.productCreateMedia(shopifyProduct.id, media);
    if (oldMedia.length > 0) {
        await ctx.shopifyFns.productDeleteMedia(shopifyProduct.id, oldMedia.map(m => m.id));
    }
    return created;
}

async function addNuevoColorTag(shopifyProduct, ctx) {
    await ctx.shopifyFns.setMetafields([
        buildWindowMetafieldInput(shopifyProduct.id, 'nuevo color', freshUntilDate(WINDOW_DAYS))
    ]);
    if (!shopifyProduct.tags.includes('nuevo color')) {
        const newTags = [...shopifyProduct.tags, 'nuevo color'];
        await ctx.shopifyFns.setProductTags(shopifyProduct.id, newTags);
        shopifyProduct.tags = newTags;
    }
}

async function reconcileVariants(vendorProducts, shopifyByCode, ctx) {
    const adapter = ctx.adapter;
    const shop = ctx.shop;

    for (const v of vendorProducts) {
        const shopifyProduct = shopifyByCode.get(v.code);
        if (!shopifyProduct) continue;

        try {
            if (typeof adapter.expandVariantsForUpload !== 'function') {
                throw new Error(`Adapter no implementa expandVariantsForUpload`);
            }

            // 1) Detecta variantes nuevas. NUNCA se borran las sobrantes (filosofía
            //    de historial: no se elimina ningún producto ni variante).
            const svByKey = indexShopifyVariantsByKey(shopifyProduct.variants.nodes, adapter, shop);
            const probe = adapter.expandVariantsForUpload(v, ctx, shopifyProduct);
            const hasNew = probe.some(e => !svByKey.has(e.key));
            if (!hasNew) continue;

            // 2) Hay color/variante nueva -> refresca TODAS las imágenes del producto
            //    como si fuera la primera vez (orden propio de cada vendor).
            let mediaNodes = null;
            try {
                mediaNodes = await refreshProductMedia(shopifyProduct, v, ctx);
            } catch (err) {
                ctx.report.logError(ctx.entry, `mediaRefresh ${v.code}`, err);
            }

            // 3) Reconstruye los payloads con la media fresca para asignar el mediaId
            //    correcto (por color) a cada variante.
            const productResponse = mediaNodes
                ? { id: shopifyProduct.id, media: { nodes: mediaNodes } }
                : shopifyProduct;
            const expanded = adapter.expandVariantsForUpload(v, ctx, productResponse);

            // 4) Crea SÓLO las variantes nuevas (con su mediaId).
            const toCreate = expanded.filter(e => !svByKey.has(e.key));
            if (toCreate.length > 0) {
                if (typeof adapter.buildVariantPayloadForExisting !== 'function') {
                    throw new Error(`Adapter no implementa buildVariantPayloadForExisting`);
                }
                const payloads = toCreate.map(e => adapter.buildVariantPayloadForExisting(e, ctx));
                await ctx.shopifyFns.productVariantsBulkCreate(shopifyProduct.id, payloads, 'PRESERVE_STANDALONE_VARIANT');
                ctx.entry.counters.variantesAgregadas += toCreate.length;
            }

            // 5) Reasigna el mediaId de las variantes EXISTENTES (su media anterior se
            //    reconstruyó). Sólo se toca la asociación de imagen, no precio/stock.
            if (mediaNodes) {
                const updates = [];
                for (const e of expanded) {
                    const sv = svByKey.get(e.key);
                    if (sv && e.payload.mediaId) updates.push({ id: sv.id, mediaId: e.payload.mediaId });
                }
                if (updates.length > 0) {
                    await ctx.shopifyFns.productVariantsBulkUpdate(shopifyProduct.id, updates);
                }
            }

            // 6) Etiqueta "nuevo color" con ventana de vencimiento (misma lógica que
            //    'nuevo' y 'oferta': se renueva mientras sigan apareciendo colores).
            await addNuevoColorTag(shopifyProduct, ctx);
            ctx.entry.counters.coloresNuevos++;
        } catch (err) {
            ctx.report.logError(ctx.entry, `variants ${v.code}`, err);
        }
    }
}

module.exports = {
    expireTagWindows,
    reconcileNewProducts,
    reconcileDiscontinued,
    reconcilePricing,
    reconcileVariants,
};
