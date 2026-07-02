function getDivisor(shop, vendorAbbr) {
    const pd = shop.priceDivisor;
    if (pd && pd.byVendor && pd.byVendor[vendorAbbr] != null) {
        return pd.byVendor[vendorAbbr];
    }
    if (pd && pd.default != null) {
        return pd.default;
    }
    throw new Error(`shops.json: tienda ${shop.shop} no define priceDivisor.default`);
}

function pricingRules(vendor) {
    return (vendor.rules && vendor.rules.pricing) || {};
}

function discountApplies(vendor, rawVariant) {
    const except = pricingRules(vendor).descuentoExcept;
    if (!except || !except.field || !rawVariant) return true;
    const values = Array.isArray(except.values) ? except.values : [];
    return !values.includes(rawVariant[except.field]);
}

function getFactor(vendor, { applyDiscount = true } = {}) {
    const p = pricingRules(vendor);
    const descuento = (applyDiscount && p.descuento != null) ? Number(p.descuento) : 0;
    const iva = p.iva != null ? Number(p.iva) : 0;
    return (1 - descuento) * (1 + iva);
}

function computeTargetPrice(rawPrice, shop, vendor, rawVariant) {
    const raw = Number(rawPrice);
    if (!Number.isFinite(raw)) {
        throw new Error(`computeTargetPrice: rawPrice no numérico (${rawPrice})`);
    }
    const divisor = getDivisor(shop, vendor.abbr);
    if (!divisor) {
        throw new Error(`shops.json: priceDivisor inválido (0) para ${shop.shop}/${vendor.abbr}`);
    }
    const applyDiscount = discountApplies(vendor, rawVariant);
    return (raw * getFactor(vendor, { applyDiscount })) / divisor;
}

function priceDiffers(a, b) {
    return Math.abs(Number(a) - Number(b)) > 0.01;
}

module.exports = { computeTargetPrice, getDivisor, priceDiffers };
