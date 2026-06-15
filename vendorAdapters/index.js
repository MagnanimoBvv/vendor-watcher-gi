const REGISTRY = {
    '4promo':      () => require('./4promo'),
    'innova':      () => require('./innova'),
    'promoopcion': () => require('./promoopcion'),
    'g4':          () => require('./g4'),
    'doblevela':   () => require('./doblevela'),
    'cdo':         () => require('./cdo'),
    'preslow':     () => require('./preslow'),
    'impressline': () => require('./impressline'),
    'dkps':        () => require('./dkps'),
};

function getAdapter(name) {
    const loader = REGISTRY[name];
    if (!loader) {
        throw new Error(`vendorAdapter no registrado: ${name}. Disponibles: ${Object.keys(REGISTRY).join(', ')}`);
    }
    try {
        return loader();
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            throw new Error(`vendorAdapter "${name}" no implementado todavía (falta vendorAdapters/${name}.js)`);
        }
        throw err;
    }
}

module.exports = { getAdapter };
