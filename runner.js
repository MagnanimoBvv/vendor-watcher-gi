const { makeShopifyClient } = require('./shopifyClient');
const { makeShopifyFunctions } = require('./shopifyFunctions');
const { getAdapter } = require('./vendorAdapters');
const { parseHandle } = require('./handleParser');
const { computeTargetPrice } = require('./pricing');
const {
    expireTagWindows,
    reconcileNewProducts,
    reconcileDiscontinued,
    reconcilePricing,
    reconcileVariants,
} = require('./reconcilers');

async function runShopVendor(shop, vendor, opts, report) {
    const entry = report.start(shop, vendor);
    console.log(`\n=== ${shop.shop} / ${vendor.name} ${opts.dryRun ? '[DRY-RUN]' : ''} ===`);

    const token = process.env[shop.tokenEnv];
    const graphqlUrl = process.env[shop.graphqlUrlEnv];
    if (!token || !graphqlUrl) {
        report.logError(entry, 'config', new Error(`Faltan env vars: ${shop.tokenEnv} / ${shop.graphqlUrlEnv}`));
        return;
    }

    const client = makeShopifyClient({ graphqlUrl, token, dryRun: opts.dryRun });
    const shopifyFns = makeShopifyFunctions(client);
    const adapter = getAdapter(vendor.adapter);

    let vendorProducts;
    try {
        vendorProducts = await adapter.fetchCatalog({ vendor, env: process.env });
        console.log(`  vendor: ${vendorProducts.length} productos`);
    } catch (err) {
        report.logError(entry, 'fetchCatalog', err);
        return;
    }

    let shopifyProducts;
    try {
        shopifyProducts = await shopifyFns.getProductsByVendor(vendor.name);
        console.log(`  shopify (vendor:${vendor.name}): ${shopifyProducts.length} productos`);
    } catch (err) {
        report.logError(entry, 'getProductsByVendor', err);
        return;
    }

    const shopifyByCode = new Map();
    for (const p of shopifyProducts) {
        const parsed = parseHandle(p.handle, shop, p);
        if (!parsed) {
            console.warn(`  [skip] handle no parseable: ${p.handle}`);
            continue;
        }
        if (parsed.abbr !== vendor.abbr) continue;
        shopifyByCode.set(parsed.code, p);
    }
    console.log(`  cruzados por handle: ${shopifyByCode.size}`);

    let locationId, publications;
    try {
        locationId = await shopifyFns.getLocationId();
        publications = await shopifyFns.getPublications();
    } catch (err) {
        report.logError(entry, 'bootstrap', err);
        return;
    }

    const ctx = {
        shop,
        vendor,
        adapter,
        shopifyFns,
        locationId,
        publications,
        report,
        entry,
        computeTargetPrice: (raw, rawVariant) => computeTargetPrice(raw, shop, vendor, rawVariant),
    };

    await expireTagWindows(shopifyProducts, ctx);
    await reconcileDiscontinued(vendorProducts, shopifyByCode, ctx);
    await reconcileNewProducts(vendorProducts, shopifyByCode, ctx);
    await reconcileVariants(vendorProducts, shopifyByCode, ctx);
    await reconcilePricing(vendorProducts, shopifyByCode, ctx);
}

module.exports = { runShopVendor };
