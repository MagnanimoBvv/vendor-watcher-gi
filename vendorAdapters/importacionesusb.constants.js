const normalizedSurfaces = {
    'RUBER': 'RUBBER',
};

const printingTechniques = {
    'serigrafia':     { normalized: 'SERIGRAFÍA',     display: 'Serigrafía' },
    'grabado laser':  { normalized: 'GRABADO LÁSER',  display: 'Grabado Láser' },
    'gota de resina': { normalized: 'GOTA DE RESINA', display: 'Gota de Resina' },
    'full color':     { normalized: 'FULL COLOR',     display: 'Full Color' },
    'tampografia':    { normalized: 'SERIGRAFÍA',     display: 'Tampografía' },
};

const secondaryOptions = [
    { match: /^\d+GB$/i, option: 'Capacidad' },
    { match: /^GDE$/i,   option: 'Tamaño', label: 'Grande' },
    { match: /^MED$/i,   option: 'Tamaño', label: 'Mediana' },
];

const primaryCategories = [
    { any: ['Bocinas', 'Audífonos', 'Audio'], tags: 'tecnologia,audifonos y bocinas' },
    { any: ['Power Bank'], tags: 'tecnologia,power banks' },
    { any: ['Memorias USB', 'Tecnología', 'Cargadores Inalámbricos'], tags: 'tecnologia,accesorios de tecnologia' },
    { all: ['Complementos', 'Accesorios'], tags: 'tecnologia,accesorios de tecnologia' },
    {
        any: ['Bebibles'],
        field: 'nombre',
        cases: [
            [/termo/, 'bebidas,termos'],
            [/vaso/, 'bebidas,vasos'],
            [/tarro|taza/, 'bebidas,tazas'],
        ],
        tags: 'bebidas',
    },
    { any: ['Libretas'], tags: 'oficina,libretas y carpetas' },
    {
        any: ['Bolígrafos'],
        field: 'material',
        cases: [[/metal/, 'oficina,boligrafos de metal']],
        tags: 'oficina,boligrafos de plastico',
    },
    { any: ['Oficina', 'WAFF', 'Accesorios de Empaque'], tags: 'oficina,accesorios de oficina' },
];

const extraCategories = [
    { all: ['Memorias USB', 'Bolígrafos'], tags: 'oficina,boligrafos multifuncionales' },
    { any: ['Llaveros'], tags: 'tiempo libre,llaveros' },
    { any: ['Ecológicas'], tags: 'ecologicos,oficina ecologica' },
];

module.exports = {
    normalizedSurfaces,
    printingTechniques,
    secondaryOptions,
    primaryCategories,
    extraCategories,
};
