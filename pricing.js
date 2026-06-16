// El precio destino se calcula dividiendo el precio del proveedor entre un
// divisor (decimal < 1) configurado por tienda — igual que en los proyectos
// upload-(vendor)-products (p.ej. precio / 0.67). El divisor (margen de tienda)
// puede variar entre tiendas y, opcionalmente, por proveedor (byVendor).
//
// Antes de aplicar el margen, el precio del proveedor se ajusta con dos campos
// explícitos declarados en vendors.json bajo rules.pricing:
//   - descuento: descuento de compra que el proveedor le aplica al distribuidor
//                al momento de comprar (p.ej. 0.25 = 25%). Sólo algunos lo tienen.
//   - iva:       IVA que se agrega sobre el precio (p.ej. 0.16 = 16%).
// El factor resultante es (1 - descuento) * (1 + iva). Mantener ambos campos
// separados los hace explícitos, en vez de un único `factor` precalculado.
//
// El descuento puede estar condicionado por variante: si rules.pricing declara
// `descuentoExcept` = { field, values }, las variantes cuyo valor en `field`
// coincida con alguno de `values` quedan EXENTAS del descuento (sólo IVA +
// margen). Cubre, p.ej., PromoOpción, donde los precios "Unico"/"Outlet" ya no
// admiten descuento. Adaptable a cualquier proveedor con un caso similar.

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

// Determina si una variante está sujeta al descuento de compra. Por defecto sí.
// Si el proveedor declara rules.pricing.descuentoExcept = { field, values } y el
// valor de `field` en la variante cruda coincide con alguno de `values`, la
// variante queda exenta (no se le aplica descuento, sólo IVA + margen).
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
