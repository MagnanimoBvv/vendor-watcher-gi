// El precio destino se calcula dividiendo el precio del proveedor entre un
// divisor (decimal < 1) configurado por tienda — igual que en los proyectos
// upload-(vendor)-products (p.ej. precio / 0.67). El divisor puede variar entre
// tiendas y, opcionalmente, por proveedor dentro de una misma tienda (byVendor).
// Algunos proveedores requieren un factor intrínseco a sus datos (p.ej. IVA),
// declarado en vendors.json como rules.pricing.factor.

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

function getFactor(vendor) {
    const f = vendor.rules && vendor.rules.pricing && vendor.rules.pricing.factor;
    return f != null ? Number(f) : 1;
}

function computeTargetPrice(rawPrice, shop, vendor) {
    const raw = Number(rawPrice);
    if (!Number.isFinite(raw)) {
        throw new Error(`computeTargetPrice: rawPrice no numérico (${rawPrice})`);
    }
    const divisor = getDivisor(shop, vendor.abbr);
    if (!divisor) {
        throw new Error(`shops.json: priceDivisor inválido (0) para ${shop.shop}/${vendor.abbr}`);
    }
    return (raw * getFactor(vendor)) / divisor;
}

function priceDiffers(a, b) {
    return Math.abs(Number(a) - Number(b)) > 0.01;
}

module.exports = { computeTargetPrice, getDivisor, priceDiffers };
