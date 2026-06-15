function slug(s) {
    return String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function buildHandle(shop, vendor, code, name) {
    if (shop.handleFormat === 'standard') {
        return slug(`${vendor.abbr}-${code}`);
    }
    return slug(`${name} ${code}`);
}

function parseHandle(handle, shop, shopifyProduct) {
    if (shop.handleFormat === 'standard') {
        const m = handle.match(/^([a-z0-9]{1,4})-(.+)$/);
        if (!m) return null;
        const abbr = m[1];
        if (!shop.vendors.includes(abbr)) return null;
        return { abbr, code: m[2] };
    }

    const vendorName = shopifyProduct && shopifyProduct.vendor;
    if (!vendorName) return null;
    const abbr = shop.vendorNameToAbbr && shop.vendorNameToAbbr[vendorName];
    if (!abbr || !shop.vendors.includes(abbr)) return null;

    const parts = handle.split('-');
    const code = parts[parts.length - 1];
    if (!code) return null;
    return { abbr, code };
}

module.exports = { slug, buildHandle, parseHandle };
