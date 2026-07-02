const {
    todayUTC,
    getMetafield,
    getWindowDate,
    TAG_TO_METAFIELD,
    buildWindowMetafieldInput,
    freshUntilDate,
    WINDOW_DAYS,
} = require('./tagWindows');

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
            const metafieldsToDelete = [];
            for (const tagName of Object.keys(TAG_TO_METAFIELD)) {
                const mfKey = TAG_TO_METAFIELD[tagName];
                const mf = getMetafield(product, mfKey);
                if (!mf || !mf.value) continue;
                const date = new Date(mf.value);
                if (isNaN(date.getTime())) continue;
                if (date.getTime() >= today.getTime()) continue;

                metafieldsToDelete.push({ id: mf.id, key: mfKey });
                if (tagHasExplicitField(tagName, ctx)) continue;
                tagsToRemove.push(tagName);
            }
            if (metafieldsToDelete.length === 0) continue;

            if (tagsToRemove.length > 0) {
                const newTags = product.tags.filter(t => !tagsToRemove.includes(t));
                await ctx.shopifyFns.setProductTags(product.id, newTags);
                product.tags = newTags;
                ctx.entry.counters.tagsRetirados += tagsToRemove.length;
            }
            for (const m of metafieldsToDelete) {
                await ctx.shopifyFns.deleteMetafield({ ownerId: product.id, namespace: 'custom', key: m.key });
            }
            const deletedIds = metafieldsToDelete.map(m => m.id);
            product.metafields.nodes = product.metafields.nodes.filter(m => !deletedIds.includes(m.id));
            ctx.entry.counters.ventanasExpiradas += metafieldsToDelete.length;
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

            if (!shopifyProduct) {
                if (typeof adapter.uploadNewProduct !== 'function') {
                    ctx.report.logError(ctx.entry, `newProducts ${v.code}`, new Error(`Adapter no implementa uploadNewProduct`));
                    continue;
                }
                const created = await adapter.uploadNewProduct(v, ctx);
                ctx.entry.counters.nuevos++;
                // continue; // Descomentar para subir artículos por primera vez
                if (created && created.id) {
                    await ctx.shopifyFns.tagsAdd(created.id, ['nuevo']);
                    await ctx.shopifyFns.setMetafields([
                        buildWindowMetafieldInput(created.id, 'nuevo', freshUntilDate(WINDOW_DAYS))
                    ]);
                }
                continue;
            }

            const windowDate = getWindowDate(shopifyProduct, 'nuevo');
            const windowActive = windowDate && windowDate.getTime() >= today.getTime();
            if (windowActive) continue;

            if (!hasNewField) continue;

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

                await ctx.shopifyFns.setMetafields([
                    buildWindowMetafieldInput(shopifyProduct.id, 'oferta', freshUntilDate(WINDOW_DAYS))
                ]);
                if (!shopifyProduct.tags.includes('oferta')) {
                    await ctx.shopifyFns.tagsAdd(shopifyProduct.id, ['oferta']);
                    shopifyProduct.tags = [...shopifyProduct.tags, 'oferta'];
                    ctx.entry.counters.tagsAgregados++;
                }
            } else if (hasOfferField) {

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

                }
            }
        } catch (err) {
            ctx.report.logError(ctx.entry, `pricing ${v.code}`, err);
        }
    }
}

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

            const svByKey = indexShopifyVariantsByKey(shopifyProduct.variants.nodes, adapter, shop);
            const probe = adapter.expandVariantsForUpload(v, ctx, shopifyProduct);
            const hasNew = probe.some(e => !svByKey.has(e.key));
            if (!hasNew) continue;

            let mediaNodes = null;
            try {
                mediaNodes = await refreshProductMedia(shopifyProduct, v, ctx);
            } catch (err) {
                ctx.report.logError(ctx.entry, `mediaRefresh ${v.code}`, err);
            }

            const productResponse = mediaNodes
                ? { id: shopifyProduct.id, media: { nodes: mediaNodes } }
                : shopifyProduct;
            const expanded = adapter.expandVariantsForUpload(v, ctx, productResponse);

            const toCreate = expanded.filter(e => !svByKey.has(e.key));
            if (toCreate.length > 0) {
                if (typeof adapter.buildVariantPayloadForExisting !== 'function') {
                    throw new Error(`Adapter no implementa buildVariantPayloadForExisting`);
                }
                const payloads = toCreate.map(e => adapter.buildVariantPayloadForExisting(e, ctx));
                await ctx.shopifyFns.productVariantsBulkCreate(shopifyProduct.id, payloads, 'PRESERVE_STANDALONE_VARIANT');
                ctx.entry.counters.variantesAgregadas += toCreate.length;
            }

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

            await addNuevoColorTag(shopifyProduct, ctx);
            ctx.entry.counters.coloresNuevos++;
        } catch (err) {
            ctx.report.logError(ctx.entry, `variants ${v.code}`, err);
        }
    }
}

async function reconcileMetafields(vendorProducts, shopifyByCode, ctx, opts = {}) {
    const mode = opts.mode === 'keep' ? 'keep' : 'clear';
    const adapter = ctx.adapter;
    if (typeof adapter.buildMetafieldsForUpdate !== 'function') {
        ctx.report.logError(ctx.entry, 'metafields', new Error(`Adapter ${ctx.vendor.adapter} no implementa buildMetafieldsForUpdate`));
        return;
    }

    for (const v of vendorProducts) {
        const shopifyProduct = shopifyByCode.get(v.code);
        if (!shopifyProduct) continue;

        try {
            const built = adapter.buildMetafieldsForUpdate(v, ctx, ctx.metafieldKeys);
            const currentByKey = new Map(
                ((shopifyProduct.metafields && shopifyProduct.metafields.nodes) || []).map(m => [m.key, m])
            );

            const toSet = [];
            const toClear = [];
            for (const mf of built) {
                if (!mf) continue;
                const current = currentByKey.get(mf.key);
                const currentValue = current ? current.value : undefined;
                const newValue = mf.value == null ? '' : mf.value;

                if (newValue !== '') {
                    if (currentValue !== newValue) toSet.push({ ...mf, ownerId: shopifyProduct.id });
                } else if (mode === 'clear' && current && currentValue) {
                    toClear.push({ ownerId: shopifyProduct.id, namespace: mf.namespace || 'custom', key: mf.key });
                }
            }

            if (toSet.length > 0) {
                await ctx.shopifyFns.setMetafields(toSet);
                ctx.entry.counters.metafieldsActualizados += toSet.length;
            }
            for (const identifier of toClear) {
                await ctx.shopifyFns.deleteMetafield(identifier);
                ctx.entry.counters.metafieldsVaciados += 1;
            }
        } catch (err) {
            ctx.report.logError(ctx.entry, `metafields ${v.code}`, err);
        }
    }
}

module.exports = {
    expireTagWindows,
    reconcileNewProducts,
    reconcileDiscontinued,
    reconcilePricing,
    reconcileVariants,
    reconcileMetafields,
};
